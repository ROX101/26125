import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import {
  AssetAccessGrant,
  AssetDocument,
  AssetStatus,
  DelegationRequest,
  DelegationStatus,
} from './types';

/**
 * Asset Registry + Approval Workflow, the Step 4 / Step 5 contracts that
 * permissions.ts declared MINT_ASSET / APPROVE_ASSET / UPLOAD_ASSET /
 * VIEW / DOWNLOAD / GRANT_ACCESS / REVOKE_ACCESS / APPROVE_DELEGATION /
 * REQUEST_ACCESS_DELEGATION for ahead of time. Imports requirePermission
 * from rbac.ts exactly the way didRegistry.ts does - no new pattern.
 *
 * Files themselves are DELIBERATELY not stored here - only a SHA-256
 * integrity hash and lifecycle metadata. The actual bytes live off-chain
 * (see bel-ui/backend's local disk storage).
 *
 * Lifecycle: PENDING_APPROVAL -[Manager]-> PENDING_MINT -[Admin]-> ACTIVE
 *                            \-[Manager]-> REJECTED (terminal)
 */

function assetKey(ctx: Context, assetId: string) {
  return ctx.stub.createCompositeKey('ASSET', [assetId]);
}
function accessKey(ctx: Context, assetId: string, did: string) {
  return ctx.stub.createCompositeKey('ASSETACCESS', [assetId, did]);
}
function delegationKey(ctx: Context, requestId: string) {
  return ctx.stub.createCompositeKey('DELEGATION', [requestId]);
}

async function getAssetOrThrow(ctx: Context, assetId: string): Promise<AssetDocument> {
  const data = await ctx.stub.getState(assetKey(ctx, assetId));
  if (!data || data.length === 0) {
    throw new Error(`Asset ${assetId} not found`);
  }
  return JSON.parse(data.toString());
}

async function listAllAssets(ctx: Context): Promise<AssetDocument[]> {
  const assets: AssetDocument[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('ASSET', []);
  let result = await iterator.next();
  while (!result.done) {
    assets.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return assets;
}

async function listAllDelegations(ctx: Context): Promise<DelegationRequest[]> {
  const requests: DelegationRequest[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('DELEGATION', []);
  let result = await iterator.next();
  while (!result.done) {
    requests.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return requests;
}

async function listAccessGrantsForAsset(ctx: Context, assetId: string): Promise<AssetAccessGrant[]> {
  const grants: AssetAccessGrant[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('ASSETACCESS', [assetId]);
  let result = await iterator.next();
  while (!result.done) {
    grants.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return grants;
}

@Info({ title: 'AssetRegistry', description: 'Asset upload/approval/mint lifecycle and access delegation' })
export class AssetRegistryContract extends Contract {
  constructor() {
    super('AssetRegistryContract');
  }

  /** Step 1: any identity holding UPLOAD_ASSET files a new asset for review. */
  @Transaction()
  @Returns('string')
  public async UploadAsset(
    ctx: Context,
    fileName: string,
    sha256Hash: string,
    orgScope: string,
  ): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'UPLOAD_ASSET', orgScope);

    const assetId = `AST-${ctx.stub.getTxID().slice(0, 8).toUpperCase()}`;
    const asset: AssetDocument = {
      assetId,
      fileName,
      sha256Hash,
      orgScope,
      status: AssetStatus.PENDING_APPROVAL,
      uploadedBy: callerDID,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
      mintedBy: null,
      mintedAt: null,
    };
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetUploaded', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'UPLOAD_ASSET', assetId, fileName);
    return assetId;
  }

  /** Step 2: a Manager (APPROVE_ASSET) clears it to the Admin's mint queue. */
  @Transaction()
  public async ApproveAsset(ctx: Context, assetId: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_ASSET', asset.orgScope);

    if (asset.status !== AssetStatus.PENDING_APPROVAL) {
      throw new Error(`Asset ${assetId} cannot be approved from status ${asset.status}`);
    }
    asset.status = AssetStatus.PENDING_MINT;
    asset.approvedBy = callerDID;
    asset.approvedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetApproved', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'APPROVE_ASSET', assetId);
  }

  /** Manager decline path - terminal, matches ApproveAsset's permission. */
  @Transaction()
  public async RejectAsset(ctx: Context, assetId: string, reason: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_ASSET', asset.orgScope);

    if (asset.status !== AssetStatus.PENDING_APPROVAL) {
      throw new Error(`Asset ${assetId} cannot be rejected from status ${asset.status}`);
    }
    asset.status = AssetStatus.REJECTED;
    asset.approvedBy = callerDID;
    asset.approvedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    asset.rejectionReason = reason;
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetRejected', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'REJECT_ASSET', assetId, reason);
  }

  /** Step 3: an Admin (MINT_ASSET) finalizes it as ACTIVE. */
  @Transaction()
  public async MintAsset(ctx: Context, assetId: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'MINT_ASSET', asset.orgScope);

    if (asset.status !== AssetStatus.PENDING_MINT) {
      throw new Error(`Asset ${assetId} cannot be minted from status ${asset.status}`);
    }
    asset.status = AssetStatus.ACTIVE;
    asset.mintedBy = callerDID;
    asset.mintedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(assetKey(ctx, assetId), Buffer.from(JSON.stringify(asset)));
    ctx.stub.setEvent('AssetMinted', Buffer.from(JSON.stringify(asset)));
    await recordAudit(ctx, callerDID, 'MINT_ASSET', assetId);
  }

  /** Direct grant, e.g. a Manager (GRANT_ACCESS) handing a User VIEW/DOWNLOAD. */
  @Transaction()
  public async GrantAccess(ctx: Context, assetId: string, targetDID: string, permissionsCSV: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'GRANT_ACCESS', asset.orgScope);

    const permissions = permissionsCSV.split(',').map((p) => p.trim()).filter(Boolean);
    const grant: AssetAccessGrant = {
      assetId,
      did: targetDID,
      permissions,
      grantedBy: callerDID,
      grantedAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
    };
    await ctx.stub.putState(accessKey(ctx, assetId, targetDID), Buffer.from(JSON.stringify(grant)));
    ctx.stub.setEvent('AccessGranted', Buffer.from(JSON.stringify(grant)));
    await recordAudit(ctx, callerDID, 'GRANT_ACCESS', `${assetId}:${targetDID}`, permissionsCSV);
  }

  @Transaction()
  public async RevokeAccess(ctx: Context, assetId: string, targetDID: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'REVOKE_ACCESS', asset.orgScope);

    const key = accessKey(ctx, assetId, targetDID);
    const existing = await ctx.stub.getState(key);
    if (!existing || existing.length === 0) {
      throw new Error(`No access grant for ${targetDID} on ${assetId}`);
    }
    await ctx.stub.deleteState(key);
    ctx.stub.setEvent('AccessRevoked', Buffer.from(JSON.stringify({ assetId, targetDID, revokedBy: callerDID })));
    await recordAudit(ctx, callerDID, 'REVOKE_ACCESS', `${assetId}:${targetDID}`);
  }

  /** A User (REQUEST_ACCESS_DELEGATION) asks that someone else be granted access. */
  @Transaction()
  @Returns('string')
  public async RequestAccessDelegation(
    ctx: Context,
    assetId: string,
    targetDID: string,
    permissionsCSV: string,
  ): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const asset = await getAssetOrThrow(ctx, assetId);
    await requirePermission(ctx, callerDID, 'REQUEST_ACCESS_DELEGATION', asset.orgScope);

    const requestId = `DEL-${ctx.stub.getTxID().slice(0, 8).toUpperCase()}`;
    const request: DelegationRequest = {
      requestId,
      assetId,
      requestedBy: callerDID,
      targetDID,
      permissionsCSV,
      status: DelegationStatus.PENDING,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      decidedBy: null,
      decidedAt: null,
    };
    await ctx.stub.putState(delegationKey(ctx, requestId), Buffer.from(JSON.stringify(request)));
    ctx.stub.setEvent('DelegationRequested', Buffer.from(JSON.stringify(request)));
    await recordAudit(ctx, callerDID, 'REQUEST_ACCESS_DELEGATION', requestId, `${assetId} -> ${targetDID}`);
    return requestId;
  }

  /** A Manager (APPROVE_DELEGATION) approves it, which materializes the grant. */
  @Transaction()
  public async ApproveDelegation(ctx: Context, requestId: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(delegationKey(ctx, requestId));
    if (!data || data.length === 0) {
      throw new Error(`Delegation request ${requestId} not found`);
    }
    const request: DelegationRequest = JSON.parse(data.toString());
    const asset = await getAssetOrThrow(ctx, request.assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_DELEGATION', asset.orgScope);

    if (request.status !== DelegationStatus.PENDING) {
      throw new Error(`Delegation request ${requestId} is already ${request.status}`);
    }
    request.status = DelegationStatus.APPROVED;
    request.decidedBy = callerDID;
    request.decidedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(delegationKey(ctx, requestId), Buffer.from(JSON.stringify(request)));

    const permissions = request.permissionsCSV.split(',').map((p) => p.trim()).filter(Boolean);
    const grant: AssetAccessGrant = {
      assetId: request.assetId,
      did: request.targetDID,
      permissions,
      grantedBy: callerDID,
      grantedAt: request.decidedAt,
    };
    await ctx.stub.putState(accessKey(ctx, request.assetId, request.targetDID), Buffer.from(JSON.stringify(grant)));
    ctx.stub.setEvent('DelegationApproved', Buffer.from(JSON.stringify(request)));
    await recordAudit(ctx, callerDID, 'APPROVE_DELEGATION', requestId);
  }

  @Transaction()
  public async RejectDelegation(ctx: Context, requestId: string, reason: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(delegationKey(ctx, requestId));
    if (!data || data.length === 0) {
      throw new Error(`Delegation request ${requestId} not found`);
    }
    const request: DelegationRequest = JSON.parse(data.toString());
    const asset = await getAssetOrThrow(ctx, request.assetId);
    await requirePermission(ctx, callerDID, 'APPROVE_DELEGATION', asset.orgScope);

    if (request.status !== DelegationStatus.PENDING) {
      throw new Error(`Delegation request ${requestId} is already ${request.status}`);
    }
    request.status = DelegationStatus.REJECTED;
    request.decidedBy = callerDID;
    request.decidedAt = ctx.stub.getTxTimestamp().seconds.low.toString();
    await ctx.stub.putState(delegationKey(ctx, requestId), Buffer.from(JSON.stringify(request)));
    ctx.stub.setEvent('DelegationRejected', Buffer.from(JSON.stringify(request)));
    await recordAudit(ctx, callerDID, 'REJECT_DELEGATION', requestId, reason);
  }

  /** Manager's Delegation Requests queue - every request, any status; the
   * UI filters to PENDING client-side the same way it does for assets. */
  @Transaction(false)
  @Returns('string')
  public async ListDelegations(ctx: Context): Promise<string> {
    return JSON.stringify(await listAllDelegations(ctx));
  }

  /** A User's own outgoing delegation requests, whatever their status. */
  @Transaction(false)
  @Returns('string')
  public async ListMyDelegationRequests(ctx: Context, did: string): Promise<string> {
    const requests = await listAllDelegations(ctx);
    return JSON.stringify(requests.filter((r) => r.requestedBy === did));
  }

  /** Combines a caller's RBAC role permissions with any per-asset grant. */
  @Transaction(false)
  @Returns('boolean')
  public async HasAssetAccess(ctx: Context, assetId: string, did: string, permission: string): Promise<boolean> {
    const { hasPermission } = await import('./rbac');
    const asset = await getAssetOrThrow(ctx, assetId);

    if (asset.uploadedBy === did) return true;
    if (await hasPermission(ctx, did, permission, asset.orgScope)) return true;

    const data = await ctx.stub.getState(accessKey(ctx, assetId, did));
    if (!data || data.length === 0) return false;
    const grant: AssetAccessGrant = JSON.parse(data.toString());
    return grant.permissions.includes(permission);
  }

  @Transaction(false)
  @Returns('string')
  public async GetAsset(ctx: Context, assetId: string): Promise<string> {
    return JSON.stringify(await getAssetOrThrow(ctx, assetId));
  }

  /** Full registry listing - for the Admin's Asset Registry / Auditor's Asset History pages. */
  @Transaction(false)
  @Returns('string')
  public async ListAssets(ctx: Context): Promise<string> {
    return JSON.stringify(await listAllAssets(ctx));
  }

  @Transaction(false)
  @Returns('string')
  public async ListPendingApprovals(ctx: Context): Promise<string> {
    const assets = await listAllAssets(ctx);
    return JSON.stringify(assets.filter((a) => a.status === AssetStatus.PENDING_APPROVAL));
  }

  @Transaction(false)
  @Returns('string')
  public async ListPendingMints(ctx: Context): Promise<string> {
    const assets = await listAllAssets(ctx);
    return JSON.stringify(assets.filter((a) => a.status === AssetStatus.PENDING_MINT));
  }

  /** For the User portal's "My Assets": uploaded-by-me, or an explicit access grant. */
  @Transaction(false)
  @Returns('string')
  public async ListMyAssets(ctx: Context, did: string): Promise<string> {
    const assets = await listAllAssets(ctx);
    const mine: (AssetDocument & { permissions: string[] })[] = [];
    for (const asset of assets) {
      if (asset.uploadedBy === did) {
        mine.push({ ...asset, permissions: ['VIEW', 'DOWNLOAD', 'UPLOAD_ASSET'] });
        continue;
      }
      const grants = await listAccessGrantsForAsset(ctx, asset.assetId);
      const grant = grants.find((g) => g.did === did);
      if (grant) {
        mine.push({ ...asset, permissions: grant.permissions });
      }
    }
    return JSON.stringify(mine);
  }
}
