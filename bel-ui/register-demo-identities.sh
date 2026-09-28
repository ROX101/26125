#!/bin/bash
# Registers three new Fabric identities (Manager, Auditor, User demo
# accounts), has each discover its own DID via WhoAmI, then uses the
# existing Admin identity to onboard and activate those exact DIDs before
# granting roles.
#
# Run this from inside fabric-samples/test-network, AFTER the network is
# up, Org3 is added, and belid is deployed with roles ADMIN/MANAGER/
# AUDITOR/USER already defined (Parts 6-9 of the setup guide).
#
# Produces: identities.json in this directory - the backend reads this to
# know which wallet/DID belongs to which role.

set -e

ORG1_DOMAIN="organizations/peerOrganizations/org1.example.com"
CA_CERT="${PWD}/organizations/fabric-ca/org1/ca-cert.pem"
ORDERER_CAFILE="${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
PEER1_TLS="${PWD}/${ORG1_DOMAIN}/peers/peer0.org1.example.com/tls/ca.crt"
PEER2_TLS="${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
ORDERER="-o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls --cafile ${ORDERER_CAFILE}"
ENDORSE="--peerAddresses localhost:7051 --tlsRootCertFiles ${PEER1_TLS} --peerAddresses localhost:9051 --tlsRootCertFiles ${PEER2_TLS}"

export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config

declare -A ROLE_PW=( ["manager-demo"]="managerpw" ["auditor-demo"]="auditorpw" ["user-demo"]="userpw" )
declare -A ROLE_ID=( ["manager-demo"]="MANAGER" ["auditor-demo"]="AUDITOR" ["user-demo"]="USER" )
# Each identity's own org unit (used for their DID document / onboarding record).
declare -A ROLE_ORGUNIT=( ["manager-demo"]="Bangalore Complex" ["auditor-demo"]="Corporate Office" ["user-demo"]="Ghaziabad" )
# Each role's RBAC GRANT scope - NOT necessarily the same as the identity's
# own org unit. MANAGER and USER act within their own unit, but AUDITOR
# ("Audit Committee tier - read-only access to the full immutable trail")
# is deliberately granted "*" so it can see across every org unit, not
# just the one its own identity happens to belong to.
declare -A ROLE_GRANTSCOPE=( ["manager-demo"]="Bangalore Complex" ["auditor-demo"]="*" ["user-demo"]="Ghaziabad" )

echo "== Step 1: Register and enroll three new identities via Org1's CA =="
export FABRIC_CA_CLIENT_HOME=${PWD}/${ORG1_DOMAIN}

for name in manager-demo auditor-demo user-demo; do
  pw=${ROLE_PW[$name]}
  msp_dir="${PWD}/${ORG1_DOMAIN}/users/${name}@org1.example.com/msp"

  fabric-ca-client register --caname ca-org1 \
    --id.name "$name" --id.secret "$pw" --id.type client \
    --tls.certfiles "${CA_CERT}" || echo "(already registered, continuing)"

  fabric-ca-client enroll -u "https://${name}:${pw}@localhost:7054" \
    --caname ca-org1 -M "${msp_dir}" \
    --tls.certfiles "${CA_CERT}"

  cp "${PWD}/${ORG1_DOMAIN}/msp/config.yaml" "${msp_dir}/config.yaml"

  echo "  -> ${name} enrolled at ${msp_dir}"
done

echo ""
echo "== Step 2: Each new identity discovers its own DID via WhoAmI =="

declare -A ROLE_DID

for name in manager-demo auditor-demo user-demo; do
  msp_dir="${PWD}/${ORG1_DOMAIN}/users/${name}@org1.example.com/msp"

  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID=Org1MSP
  export CORE_PEER_TLS_ROOTCERT_FILE=${PEER1_TLS}
  export CORE_PEER_MSPCONFIGPATH=${msp_dir}
  export CORE_PEER_ADDRESS=localhost:7051

  did=$(peer chaincode query -C belchannel -n belid -c '{"function":"DIDRegistryContract:WhoAmI","Args":[]}')
  did=$(echo "$did" | tr -d '"')
  ROLE_DID[$name]=$did
  echo "  -> ${name} is ${did}"
done

echo ""
echo "== Step 3: Switch to Admin and onboard + activate + grant roles to those exact DIDs =="

export $(./setOrgEnv.sh Org1 | xargs)

for name in manager-demo auditor-demo user-demo; do
  did=${ROLE_DID[$name]}
  role=${ROLE_ID[$name]}
  orgunit=${ROLE_ORGUNIT[$name]}
  grantscope=${ROLE_GRANTSCOPE[$name]}

  echo "  -> Requesting onboarding for ${name} (${did}), org unit: ${orgunit}"
  peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
    -c "{\"function\":\"DIDRegistryContract:RequestOnboarding\",\"Args\":[\"${did}\",\"${orgunit}\"]}" >/dev/null 2>&1 \
    || echo "     (already requested, continuing)"
  sleep 2

  echo "  -> Activating ${name} (${did})"
  peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
    -c "{\"function\":\"DIDRegistryContract:ActivateIdentity\",\"Args\":[\"${did}\"]}" >/dev/null 2>&1 \
    || echo "     (already active, continuing)"
  sleep 2

  echo "  -> Granting ${role} to ${did}, scope: ${grantscope}"
  peer chaincode invoke $ORDERER -C belchannel -n belid $ENDORSE \
    -c "{\"function\":\"RBACEngineContract:GrantRole\",\"Args\":[\"${did}\",\"${role}\",\"${grantscope}\",\"\"]}" >/dev/null 2>&1
  sleep 2
done

echo ""
echo "== Step 4: Write identities.json for the backend =="

admin_msp="${PWD}/${ORG1_DOMAIN}/users/Admin@org1.example.com/msp"

cat > identities.json << JSONEOF
{
  "ADMIN": {
    "did": "REPLACE_WITH_YOUR_GENESIS_DID",
    "orgUnit": "Corporate Office",
    "orgScope": "*",
    "mspId": "Org1MSP",
    "certPath": "${admin_msp}/signcerts/cert.pem",
    "keyPath": "${admin_msp}/keystore/priv_sk"
  },
  "MANAGER": {
    "did": "${ROLE_DID[manager-demo]}",
    "orgUnit": "${ROLE_ORGUNIT[manager-demo]}",
    "orgScope": "${ROLE_GRANTSCOPE[manager-demo]}",
    "mspId": "Org1MSP",
    "certPath": "${PWD}/${ORG1_DOMAIN}/users/manager-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "${PWD}/${ORG1_DOMAIN}/users/manager-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "AUDITOR": {
    "did": "${ROLE_DID[auditor-demo]}",
    "orgUnit": "${ROLE_ORGUNIT[auditor-demo]}",
    "orgScope": "${ROLE_GRANTSCOPE[auditor-demo]}",
    "mspId": "Org1MSP",
    "certPath": "${PWD}/${ORG1_DOMAIN}/users/auditor-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "${PWD}/${ORG1_DOMAIN}/users/auditor-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "USER": {
    "did": "${ROLE_DID[user-demo]}",
    "orgUnit": "${ROLE_ORGUNIT[user-demo]}",
    "orgScope": "${ROLE_GRANTSCOPE[user-demo]}",
    "mspId": "Org1MSP",
    "certPath": "${PWD}/${ORG1_DOMAIN}/users/user-demo@org1.example.com/msp/signcerts/cert.pem",
    "keyPath": "${PWD}/${ORG1_DOMAIN}/users/user-demo@org1.example.com/msp/keystore/priv_sk"
  },
  "network": {
    "peerEndpoint": "localhost:7051",
    "peerHostAlias": "peer0.org1.example.com",
    "tlsCertPath": "${PEER1_TLS}",
    "mspId": "Org1MSP",
    "channelName": "belchannel",
    "chaincodeName": "belid"
  }
}
JSONEOF

echo ""
echo "Done. Wrote identities.json"
echo ""
echo "IMPORTANT: open identities.json and replace ADMIN.did with your"
echo "actual genesis DID (the one InitAdmin returned back in Part 9 -"
echo "the value starting did:fabric:...). This script does not know it,"
echo "since it was generated before this script ran."
