/**
 * Permission catalog, grounded in BEL's own 11 documented duty categories
 * (HR, Legal, Medical, Finance, Marketing, Licensing, Vigilance, R&D,
 * Production, Quality Management, Supply Chain) from BEL's real
 * "Powers & Duties" document. Each permission is tagged with the duty
 * category it belongs to, so a Role is composed as "grant this DID
 * MINT_ASSET, scoped to R&D" rather than a vague generic grant.
 *
 * This is the current catalog (replaces the earlier ISSUE_DID/REVOKE_DID/
 * DEFINE_ROLE/GRANT_ROLE/REVOKE_ROLE/... catalog): identity and role
 * administration are each consolidated into a single permission
 * (MANAGE_IDENTITY, MANAGE_ROLE), and the asset-side permissions are
 * declared now - CREATE_ASSET's replacements (MINT_ASSET, APPROVE_ASSET,
 * UPLOAD_ASSET) and the access-delegation permissions - so RBAC role
 * definitions can reference them before the Asset Registry / Approval
 * Workflow contracts exist.
 */

export interface PermissionDef {
  key: string;
  category: string; // one of BEL's 11 real duty categories
  description: string;
}

export const PERMISSIONS: Record<string, PermissionDef> = {
  MANAGE_IDENTITY:           { key: 'MANAGE_IDENTITY',           category: 'HR',                  description: 'Onboard, activate, suspend, and deactivate DIDs' },
  MANAGE_ROLE:               { key: 'MANAGE_ROLE',               category: 'HR',                  description: 'Define roles and grant/revoke role assignments' },
  MINT_ASSET:                { key: 'MINT_ASSET',                category: 'Production',          description: 'Mint a new asset token (Step 4)' },
  APPROVE_ASSET:             { key: 'APPROVE_ASSET',             category: 'Production',          description: 'Approve a pending asset action, e.g. a transfer (Step 5)' },
  GRANT_ACCESS:              { key: 'GRANT_ACCESS',              category: 'Legal',               description: 'Grant another DID access to an asset (Step 5)' },
  REVOKE_ACCESS:             { key: 'REVOKE_ACCESS',             category: 'Legal',               description: 'Revoke a previously-granted asset access (Step 5)' },
  APPROVE_DELEGATION:        { key: 'APPROVE_DELEGATION',        category: 'Legal',               description: 'Approve a pending access-delegation request (Step 5)' },
  VIEW_AUDIT:                { key: 'VIEW_AUDIT',                category: 'Vigilance',           description: 'Read-only access to the full immutable event trail' },
  VIEW:                      { key: 'VIEW',                      category: 'Quality Management',  description: "View an asset's metadata (Step 4)" },
  DOWNLOAD:                  { key: 'DOWNLOAD',                  category: 'Quality Management',  description: "Download an asset's underlying file/content (Step 4)" },
  UPLOAD_ASSET:              { key: 'UPLOAD_ASSET',              category: 'Supply Chain',        description: 'Upload a new asset for later minting/approval (Step 4)' },
  REQUEST_ACCESS_DELEGATION: { key: 'REQUEST_ACCESS_DELEGATION', category: 'Supply Chain',        description: 'Request that another DID be delegated access to an asset (Step 5)' },
};
