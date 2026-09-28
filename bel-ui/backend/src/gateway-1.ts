import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Gateway, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs';

export interface RoleIdentity {
  did: string;
  orgUnit: string;
  orgScope: string;
  mspId: string;
  certPath: string;
  keyPath: string;
}

export interface NetworkConfig {
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  mspId: string;
  channelName: string;
  chaincodeName: string;
}

export interface IdentitiesFile {
  ADMIN: RoleIdentity;
  MANAGER: RoleIdentity;
  AUDITOR: RoleIdentity;
  USER: RoleIdentity;
  network: NetworkConfig;
}

export type RoleName = 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'USER';

interface RoleConnection {
  gateway: Gateway;
  client: grpc.Client;
  didContract: Contract;
  rbacContract: Contract;
  assetContract: Contract;
  auditContract: Contract;
}

const connections = new Map<RoleName, RoleConnection>();
let config: IdentitiesFile;

export function loadConfig(identitiesPath: string): IdentitiesFile {
  config = JSON.parse(fs.readFileSync(identitiesPath, 'utf8'));
  return config;
}

function newGrpcConnection(net: NetworkConfig): grpc.Client {
  const tlsRootCert = fs.readFileSync(net.tlsCertPath);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(net.peerEndpoint, tlsCredentials, {
    'grpc.ssl_target_name_override': net.peerHostAlias,
  });
}

function newIdentity(role: RoleIdentity): Identity {
  const credentials = fs.readFileSync(role.certPath);
  return { mspId: role.mspId, credentials };
}

function newSigner(role: RoleIdentity): Signer {
  const privateKeyPem = fs.readFileSync(role.keyPath);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

/**
 * Returns (creating if needed) a Fabric Gateway connection acting as the
 * given role's own identity. Each role gets its own gRPC connection, its
 * own signing key, and its own view of the network - this is what makes
 * "acting as Manager" or "acting as User" a real cryptographic distinction
 * rather than a UI toggle.
 */
export async function getConnection(roleName: RoleName): Promise<RoleConnection> {
  const existing = connections.get(roleName);
  if (existing) return existing;

  const role = config[roleName];
  const net = config.network;

  const client = newGrpcConnection(net);
  const gateway = connect({
    client,
    identity: newIdentity(role),
    signer: newSigner(role),
    evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
  });

  const network = gateway.getNetwork(net.channelName);
  // All four contracts live in the same chaincode package - the second
  // argument picks which one, exactly like the ContractName:Function
  // syntax used on the CLI.
  const didContract = network.getContract(net.chaincodeName, 'DIDRegistryContract');
  const rbacContract = network.getContract(net.chaincodeName, 'RBACEngineContract');
  const assetContract = network.getContract(net.chaincodeName, 'AssetRegistryContract');
  const auditContract = network.getContract(net.chaincodeName, 'AuditContract');

  const conn: RoleConnection = { gateway, client, didContract, rbacContract, assetContract, auditContract };
  connections.set(roleName, conn);
  return conn;
}

export function getRoleInfo(roleName: RoleName): RoleIdentity {
  return config[roleName];
}

export function getAllRoleInfo(): Record<RoleName, RoleIdentity> {
  return { ADMIN: config.ADMIN, MANAGER: config.MANAGER, AUDITOR: config.AUDITOR, USER: config.USER };
}

export function closeAll(): void {
  for (const conn of connections.values()) {
    conn.gateway.close();
    conn.client.close();
  }
}
