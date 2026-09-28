// Set VITE_API_BASE at build time (see .env.production) to point this at
// the deployed backend instead of your local machine. An explicitly empty
// value means "same origin" - used when the backend serves this built
// frontend itself.
const envApiBase = (import.meta as any).env?.VITE_API_BASE;
const API_BASE = envApiBase !== undefined ? envApiBase : 'http://localhost:4000';

export type RoleName = 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'USER';

export interface RoleConfig {
  displayName: string;
  description: string;
  did: string;
  orgUnit: string;
  orgScope: string;
}

export interface ConfigResponse {
  roles: Record<RoleName, RoleConfig>;
  permissionCatalog: string[];
}

export type DIDStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface DIDDocument {
  did: string;
  orgUnit: string;
  status: DIDStatus;
  createdAt: string;
  createdBy: string;
}

export interface Role {
  roleId: string;
  name: string;
  permissions: string[];
  orgScope: string;
}

export type AssetStatus = 'PENDING_APPROVAL' | 'PENDING_MINT' | 'ACTIVE' | 'REJECTED';

export interface AssetDocument {
  assetId: string;
  fileName: string;
  sha256Hash: string;
  orgScope: string;
  status: AssetStatus;
  uploadedBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  mintedBy?: string;
  mintedAt?: string;
  permissions?: string[];
}

export type DelegationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DelegationRequest {
  requestId: string;
  assetId: string;
  requestedBy: string;
  targetDID: string;
  permissionsCSV: string;
  status: DelegationStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  result: 'SUCCESS' | 'FAILURE';
  message?: string;
  timestamp: string;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: opts.body instanceof FormData ? opts.headers : { 'Content-Type': 'application/json', ...opts.headers },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || `${res.status} ${res.statusText}`);
  }
  return data as T;
}

function withRole(path: string, role: RoleName): string {
  return `${path}${path.includes('?') ? '&' : '?'}role=${role}`;
}

// ---- Config / session ----------------------------------------------------

export function fetchConfig(): Promise<ConfigResponse> {
  return req('/api/config');
}

export function login(role: RoleName): Promise<{ ok: boolean; did: string }> {
  return req('/api/login', { method: 'POST', body: JSON.stringify({ role }) });
}

export async function fetchPermissions(role: RoleName): Promise<Record<string, boolean>> {
  const data = await req<{ permissions: Record<string, boolean> }>(`/api/permissions/${role}`);
  return data.permissions;
}

// ---- Identity --------------------------------------------------------------

export async function fetchIdentities(role: RoleName): Promise<DIDDocument[]> {
  const data = await req<{ identities: DIDDocument[] }>(withRole('/api/identities', role));
  return data.identities;
}

export async function fetchIdentitiesByOrgUnit(role: RoleName, orgUnit: string): Promise<DIDDocument[]> {
  const data = await req<{ identities: DIDDocument[] }>(withRole(`/api/identities/by-org/${encodeURIComponent(orgUnit)}`, role));
  return data.identities;
}

export async function fetchPendingOnboarding(role: RoleName): Promise<DIDDocument[]> {
  const data = await req<{ pending: DIDDocument[] }>(withRole('/api/identities/pending', role));
  return data.pending;
}

export function requestOnboarding(role: RoleName, subjectDID: string, orgUnit: string) {
  return req<{ ok: boolean }>('/api/identities/request-onboarding', {
    method: 'POST',
    body: JSON.stringify({ role, subjectDID, orgUnit }),
  });
}

export function activateIdentity(role: RoleName, did: string) {
  return req<{ ok: boolean }>(withRole(`/api/identities/${encodeURIComponent(did)}/activate`, role), { method: 'POST' });
}

export function suspendIdentity(role: RoleName, did: string) {
  return req<{ ok: boolean }>(withRole(`/api/identities/${encodeURIComponent(did)}/suspend`, role), { method: 'POST' });
}

export function deactivateIdentity(role: RoleName, did: string) {
  return req<{ ok: boolean }>(withRole(`/api/identities/${encodeURIComponent(did)}/deactivate`, role), { method: 'POST' });
}

// ---- Roles & policies -------------------------------------------------------

export async function fetchRoles(role: RoleName): Promise<Role[]> {
  const data = await req<{ roles: Role[] }>(withRole('/api/roles', role));
  return data.roles;
}

export function defineRole(role: RoleName, roleId: string, name: string, permissionsCSV: string, orgScope: string) {
  return req<{ ok: boolean }>('/api/roles/define', {
    method: 'POST',
    body: JSON.stringify({ role, roleId, name, permissionsCSV, orgScope }),
  });
}

export function grantRole(role: RoleName, subjectDID: string, roleId: string, orgScope: string, expiresAt?: string) {
  return req<{ ok: boolean }>('/api/roles/grant', {
    method: 'POST',
    body: JSON.stringify({ role, subjectDID, roleId, orgScope, expiresAt }),
  });
}

export function revokeRole(role: RoleName, subjectDID: string, roleId: string, orgScope: string) {
  return req<{ ok: boolean }>('/api/roles/revoke', {
    method: 'POST',
    body: JSON.stringify({ role, subjectDID, roleId, orgScope }),
  });
}

// ---- Assets ------------------------------------------------------------------

export async function uploadAsset(role: RoleName, file: File, orgScope: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('role', role);
  form.append('orgScope', orgScope);
  return req<{ ok: boolean; assetId: string; sha256Hash: string }>('/api/assets/upload', {
    method: 'POST',
    body: form,
  });
}

export async function fetchAssets(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets', role));
  return data.assets;
}

export async function fetchMyAssets(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets/mine', role));
  return data.assets;
}

export async function fetchPendingApprovals(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets/pending-approval', role));
  return data.assets;
}

export async function fetchPendingMints(role: RoleName): Promise<AssetDocument[]> {
  const data = await req<{ assets: AssetDocument[] }>(withRole('/api/assets/pending-mint', role));
  return data.assets;
}

export function approveAsset(role: RoleName, id: string) {
  return req<{ ok: boolean }>(withRole(`/api/assets/${id}/approve`, role), { method: 'POST' });
}

export function rejectAsset(role: RoleName, id: string, reason: string) {
  return req<{ ok: boolean }>(withRole(`/api/assets/${id}/reject`, role), {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function mintAsset(role: RoleName, id: string) {
  return req<{ ok: boolean }>(withRole(`/api/assets/${id}/mint`, role), { method: 'POST' });
}

export function viewAsset(role: RoleName, id: string) {
  return req<{ asset: AssetDocument }>(withRole(`/api/assets/${id}/view`, role));
}

export function downloadAssetUrl(role: RoleName, id: string): string {
  return `${API_BASE}${withRole(`/api/assets/${id}/download`, role)}`;
}

// ---- Delegations -------------------------------------------------------------

export function requestDelegation(role: RoleName, assetId: string, targetDID: string, permissionsCSV: string) {
  return req<{ ok: boolean; requestId: string }>('/api/delegations/request', {
    method: 'POST',
    body: JSON.stringify({ role, assetId, targetDID, permissionsCSV }),
  });
}

export async function fetchDelegations(role: RoleName): Promise<DelegationRequest[]> {
  const data = await req<{ delegations: DelegationRequest[] }>(withRole('/api/delegations', role));
  return data.delegations;
}

export async function fetchMyDelegations(role: RoleName): Promise<DelegationRequest[]> {
  const data = await req<{ delegations: DelegationRequest[] }>(withRole('/api/delegations/mine', role));
  return data.delegations;
}

export function approveDelegation(role: RoleName, id: string) {
  return req<{ ok: boolean }>(withRole(`/api/delegations/${id}/approve`, role), { method: 'POST' });
}

export function rejectDelegation(role: RoleName, id: string, reason: string) {
  return req<{ ok: boolean }>(withRole(`/api/delegations/${id}/reject`, role), {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ---- Audit ---------------------------------------------------------------------

export async function fetchAuditEvents(role: RoleName): Promise<AuditEvent[]> {
  const data = await req<{ events: AuditEvent[] }>(withRole('/api/audit', role));
  return data.events;
}

export async function fetchMyAuditEvents(role: RoleName): Promise<AuditEvent[]> {
  const data = await req<{ events: AuditEvent[] }>(withRole('/api/audit/mine', role));
  return data.events;
}
