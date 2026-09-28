/**
 * Shared types for the BEL DID Registry, RBAC Engine, Asset Registry, and
 * Audit Log chaincode.
 *
 * Design notes (from the research pass before this code was written):
 * - DID documents are DELIBERATELY minimal (public-key binding + status +
 *   org scope only) per India's DPDP Act 2023 / DPDP Rules 2025 guidance:
 *   regulators expect avoidance of personal data on an immutable ledger
 *   where it isn't technically necessary. No name, no contact info, no
 *   documents live here - those stay off-chain.
 * - The DID itself is derived from the submitter's Fabric client identity
 *   (see didRegistry.ts -> deriveDID()), not a separately generated key
 *   pair. This is the lightweight option from the DID research: it is
 *   cryptographically backed by Fabric's own MSP/TLS layer today. A bridge
 *   to a full W3C DID Core 1.0 document (via Hyperledger Aries/Identus) is
 *   a documented Phase 2 stretch goal, not something faked here.
 *
 * DIDStatus is a 4-state onboarding lifecycle (see didRegistry.ts):
 *   PENDING -> ACTIVE -> SUSPENDED -> ACTIVE (reversible) or DEACTIVATED
 *   (terminal). Only ACTIVE identities pass RBAC checks.
 *
 * Assets are DELIBERATELY metadata-only on-chain: the actual file bytes
 * live off-chain (see bel-ui/backend's local disk storage), and only a
 * SHA-256 integrity hash + lifecycle status is recorded here. This keeps
 * the ledger light and matches the DPDP-minimization principle above.
 */

export enum DIDStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export interface DIDDocument {
  did: string;          // e.g. did:fabric:<hash of the Fabric client identity>
  orgUnit: string;       // a real BEL unit, e.g. "Bangalore Complex", "Ghaziabad"
  status: DIDStatus;
  createdAt: string;     // tx timestamp (ledger time, not client clock)
  createdBy: string;     // DID of whoever filed the onboarding request (or self, for genesis)
}

export interface Role {
  roleId: string;         // one of ADMIN | MANAGER | AUDITOR | USER - fixed by the PS text
  name: string;           // display name, can vary per dept, e.g. "R&D Manager"
  permissions: string[];  // keys from the permission catalog, see permissions.ts
  orgScope: string;       // which BEL unit this role definition applies to ("*" = all units)
}

export interface RoleAssignment {
  did: string;
  roleId: string;
  orgScope: string;          // must match (or be covered by) the role's own orgScope
  expiresAt: string | null;  // ISO timestamp, or null = no expiry
  assignedBy: string;        // DID of the Admin who granted this
  assignedAt: string;
}

/**
 * Asset lifecycle: PENDING_APPROVAL (just uploaded) -> PENDING_MINT
 * (Manager approved, awaiting Admin) -> ACTIVE (Admin minted). REJECTED is
 * a terminal dead-end from PENDING_APPROVAL if a Manager declines it.
 */
export enum AssetStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PENDING_MINT = 'PENDING_MINT',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
}

export interface AssetDocument {
  assetId: string;          // e.g. AST-XXXXXXXX
  fileName: string;
  sha256Hash: string;       // integrity hash of the off-chain file bytes
  orgScope: string;         // BEL unit this asset belongs to
  status: AssetStatus;
  uploadedBy: string;       // DID
  createdAt: string;
  approvedBy: string | null;  // DID of the Manager who approved/rejected it
  approvedAt: string | null;
  rejectionReason: string | null;
  mintedBy: string | null;    // DID of the Admin who minted it
  mintedAt: string | null;
}

/** Per-asset access grant, on top of whatever a caller's RBAC role gives
 * them in that org scope - lets a Manager (or an approved delegation
 * request) hand one specific DID VIEW/DOWNLOAD on one specific asset. */
export interface AssetAccessGrant {
  assetId: string;
  did: string;
  permissions: string[];   // subset of VIEW / DOWNLOAD
  grantedBy: string;
  grantedAt: string;
}

export enum DelegationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface DelegationRequest {
  requestId: string;
  assetId: string;
  requestedBy: string;      // DID that wants someone else granted access
  targetDID: string;        // DID that would receive access
  permissionsCSV: string;   // requested permissions, e.g. "VIEW,DOWNLOAD"
  status: DelegationStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export type AuditResult = 'SUCCESS' | 'FAILURE';

export interface AuditEvent {
  id: string;
  actor: string;      // DID that performed the action
  action: string;      // e.g. "MINT_ASSET", "AUTHENTICATE"
  target: string;      // whatever the action was performed on (DID, asset ID, role ID, or "")
  result: AuditResult;
  message?: string;
  timestamp: string;
}
