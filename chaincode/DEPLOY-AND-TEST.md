# Deploying and Testing the DID Registry + RBAC Engine

Assumes the network from the Step 1 guide is already up (`./network.sh up
createChannel -c belchannel -ca`, with Org3 added).

## 1. Build

```bash
cd chaincode
npm install
npm run build
```

## 2. Deploy in place of the placeholder `basic` contract

From `fabric-samples/test-network`:

```bash
./network.sh deployCC -ccn belid -ccp ../../chaincode -ccl typescript -c belchannel
```

## 3. Bootstrap the genesis Admin (run once, as Org1's identity)

```bash
peer chaincode invoke -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com --tls \
  --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C belchannel -n belid \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  -c '{"function":"DIDRegistryContract:InitAdmin","Args":["Corporate Office"]}'
```

Note the returned `did:fabric:...` value - you will need it for the next step.

## 4. Define the four PS-mandated roles

Repeat for MANAGER, AUDITOR, USER with the right permission list per Section 4
of the master context doc:

```bash
peer chaincode invoke ... -c '{"function":"RBACEngineContract:DefineRole","Args":["ADMIN","Admin","ISSUE_DID,REVOKE_DID,DEFINE_ROLE,GRANT_ROLE,REVOKE_ROLE","*"]}'
```

## 5. Grant the genesis identity the ADMIN role

```bash
peer chaincode invoke ... -c '{"function":"RBACEngineContract:GrantRole","Args":["<did:fabric:... from step 3>","ADMIN","*",""]}'
```

## 6. Sanity-check: issue a second DID and confirm permission enforcement

```bash
# Should succeed (caller now holds ADMIN):
peer chaincode invoke ... -c '{"function":"DIDRegistryContract:IssueDID","Args":["did:fabric:testuser1","Bangalore Complex"]}'

# Should fail with "lacks permission" - proving enforcement actually works:
peer chaincode query ... -c '{"function":"RBACEngineContract:HasPermission","Args":["did:fabric:testuser1","ISSUE_DID","Bangalore Complex"]}'
```

That last failing check is your demo moment - it's the concrete proof that
RBAC is enforced in code, not just asserted in a slide.

## What's next (Step 3 continuation / Step 4)

- Add `REQUEST_TRANSFER` / `APPROVE_TRANSFER` / `FINANCE_SIGNOFF` enforcement
  once the Approval Workflow contract exists (Step 5).
- Asset Registry (Step 4) will import `requirePermission` from `./rbac.ts`
  exactly the way `didRegistry.ts` does - no new pattern needed.
