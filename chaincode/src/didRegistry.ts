import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import * as crypto from 'crypto';
import { DIDDocument, DIDStatus } from './types';

const DID_PREFIX = 'did:fabric:';

/**
 * Derive a DID deterministically from the submitter's Fabric client
 * identity. This is what makes "proving it's you" free: Fabric's MSP/TLS
 * layer already verified the signature before the transaction reached
 * chaincode. We are not reinventing signature verification here - we are
 * binding our DID namespace to Fabric's existing one.
 */
export function deriveDID(ctx: Context): string {
  const rawId = ctx.clientIdentity.getID(); // unique per-identity string from the x.509 cert
  const hash = crypto.createHash('sha256').update(rawId).digest('hex').slice(0, 32);
  return `${DID_PREFIX}${hash}`;
}

function didKey(ctx: Context, did: string) {
  return ctx.stub.createCompositeKey('DID', [did]);
}

async function listAllDIDs(ctx: Context): Promise<DIDDocument[]> {
  const docs: DIDDocument[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('DID', []);
  let result = await iterator.next();
  while (!result.done) {
    docs.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  return docs;
}

@Info({ title: 'DIDRegistry', description: 'On-chain DID registry with a 4-state onboarding lifecycle (DPDP-minimized schema)' })
export class DIDRegistryContract extends Contract {
  constructor() {
    super('DIDRegistryContract');
  }

  /**
   * One-time genesis bootstrap: creates the first Admin identity, already
   * ACTIVE (self-issued, so it can't go through its own onboarding queue).
   * Guarded so it can only succeed once per calling identity. Run this
   * immediately after chaincode instantiation, from the founding org's
   * admin identity, then use RBACEngineContract.GrantRole to give it the
   * ADMIN role.
   */
  @Transaction()
  public async InitAdmin(ctx: Context, orgUnit: string): Promise<string> {
    const { recordAudit } = await import('./audit');
    const did = deriveDID(ctx);
    const existing = await ctx.stub.getState(didKey(ctx, did));
    if (existing && existing.length > 0) {
      throw new Error(`DID ${did} is already registered - InitAdmin can only run once per identity`);
    }
    const doc: DIDDocument = {
      did,
      orgUnit,
      status: DIDStatus.ACTIVE,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      createdBy: did, // self-issued genesis identity
    };
    await ctx.stub.putState(didKey(ctx, did), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentityCreated', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, did, 'INIT_ADMIN', did, orgUnit);
    return did;
  }

  /**
   * Onboarding step 1 of 2. Deliberately open (no permission gate) and
   * keeps the same (subjectDID, orgUnit) signature the old IssueDID used,
   * so a subject can discover its own DID via WhoAmI and hand it to an
   * Admin out of band, or an Admin can file the request directly. Filing a
   * request only creates a PENDING record - it grants no access by itself.
   * A fresh request is allowed again once a prior identity for this DID
   * has reached DEACTIVATED.
   */
  @Transaction()
  public async RequestOnboarding(ctx: Context, subjectDID: string, orgUnit: string): Promise<void> {
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    const existing = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (existing && existing.length > 0) {
      const doc: DIDDocument = JSON.parse(existing.toString());
      if (doc.status !== DIDStatus.DEACTIVATED) {
        throw new Error(`DID ${subjectDID} already has an onboarding record (status: ${doc.status})`);
      }
    }
    const doc: DIDDocument = {
      did: subjectDID,
      orgUnit,
      status: DIDStatus.PENDING,
      createdAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
      createdBy: callerDID,
    };
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('OnboardingRequested', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'REQUEST_ONBOARDING', subjectDID, orgUnit);
  }

  /**
   * Onboarding step 2 of 2 (also used to reverse a Suspend). Caller must
   * hold MANAGE_IDENTITY for the target's org unit (checked via the RBAC
   * engine, called directly since both contracts ship in one chaincode
   * package - no cross-chaincode invoke overhead). Moves PENDING or
   * SUSPENDED -> ACTIVE. This is the direct replacement for the old
   * IssueDID's "grant access now" behavior.
   */
  @Transaction()
  public async ActivateIdentity(ctx: Context, subjectDID: string): Promise<void> {
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (!data || data.length === 0) {
      throw new Error(`DID ${subjectDID} not found - call RequestOnboarding first`);
    }
    const doc: DIDDocument = JSON.parse(data.toString());
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', doc.orgUnit);

    if (doc.status !== DIDStatus.PENDING && doc.status !== DIDStatus.SUSPENDED) {
      throw new Error(`DID ${subjectDID} cannot be activated from status ${doc.status}`);
    }
    doc.status = DIDStatus.ACTIVE;
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentityActivated', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'ACTIVATE_IDENTITY', subjectDID);
  }

  /**
   * Temporary hold: an ACTIVE identity is parked as SUSPENDED and fails
   * every RBAC check until re-activated via ActivateIdentity. Unlike
   * DeactivateIdentity, this is reversible.
   */
  @Transaction()
  public async SuspendIdentity(ctx: Context, subjectDID: string): Promise<void> {
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (!data || data.length === 0) {
      throw new Error(`DID ${subjectDID} not found`);
    }
    const doc: DIDDocument = JSON.parse(data.toString());
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', doc.orgUnit);

    if (doc.status !== DIDStatus.ACTIVE) {
      throw new Error(`DID ${subjectDID} cannot be suspended from status ${doc.status}`);
    }
    doc.status = DIDStatus.SUSPENDED;
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentitySuspended', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'SUSPEND_IDENTITY', subjectDID);
  }

  /**
   * Terminal state - the direct replacement for the old RevokeDID. Once
   * DEACTIVATED, every RBAC check rejects this DID regardless of any role
   * still technically attached to it, and it can never be re-activated -
   * a fresh RequestOnboarding is required to reuse the identifier.
   */
  @Transaction()
  public async DeactivateIdentity(ctx: Context, subjectDID: string): Promise<void> {
    const { requirePermission } = await import('./rbac');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);

    const data = await ctx.stub.getState(didKey(ctx, subjectDID));
    if (!data || data.length === 0) {
      throw new Error(`DID ${subjectDID} not found`);
    }
    const doc: DIDDocument = JSON.parse(data.toString());
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', doc.orgUnit);

    if (doc.status === DIDStatus.DEACTIVATED) {
      throw new Error(`DID ${subjectDID} is already deactivated`);
    }
    doc.status = DIDStatus.DEACTIVATED;
    await ctx.stub.putState(didKey(ctx, subjectDID), Buffer.from(JSON.stringify(doc)));
    ctx.stub.setEvent('IdentityDeactivated', Buffer.from(JSON.stringify(doc)));
    await recordAudit(ctx, callerDID, 'DEACTIVATE_IDENTITY', subjectDID);
  }

  /**
   * Lets any Fabric identity discover its own derived DID - needed so a
   * new identity can compute their DID once and hand it to an Admin (or
   * request their own onboarding with it directly).
   */
  @Transaction(false)
  @Returns('string')
  public async WhoAmI(ctx: Context): Promise<string> {
    return deriveDID(ctx);
  }

  @Transaction(false)
  @Returns('string')
  public async GetDID(ctx: Context, did: string): Promise<string> {
    const data = await ctx.stub.getState(didKey(ctx, did));
    if (!data || data.length === 0) {
      throw new Error(`DID ${did} not found`);
    }
    return data.toString();
  }

  /**
   * Admin's Identity Directory page - every DID on the ledger, any status.
   * Readable by anyone holding MANAGE_IDENTITY (can also act on identities)
   * OR VIEW_AUDIT (read-only oversight, e.g. the Auditor's Identity History
   * page) - both scoped '*'. Either is sufficient; neither is required if
   * you hold the other, so an Auditor doesn't need identity-management
   * write access just to see who's on the ledger.
   */
  @Transaction(false)
  @Returns('string')
  public async ListIdentities(ctx: Context): Promise<string> {
    const { hasPermission } = await import('./rbac');
    const callerDID = deriveDID(ctx);
    const allowed = (await hasPermission(ctx, callerDID, 'MANAGE_IDENTITY', '*'))
      || (await hasPermission(ctx, callerDID, 'VIEW_AUDIT', '*'));
    if (!allowed) {
      throw new Error(`DID ${callerDID} lacks MANAGE_IDENTITY or VIEW_AUDIT in scope *`);
    }
    return JSON.stringify(await listAllDIDs(ctx));
  }

  /**
   * Manager's Team Members page - identities registered under one org
   * unit. Deliberately ungated (like AssetRegistry's browsing queries):
   * it only ever returns names already scoped to the org unit the caller
   * asks for, so it doesn't need a separate "manage this org" permission
   * check to be safe to expose.
   */
  @Transaction(false)
  @Returns('string')
  public async ListIdentitiesByOrgUnit(ctx: Context, orgUnit: string): Promise<string> {
    const docs = await listAllDIDs(ctx);
    return JSON.stringify(docs.filter((d) => d.orgUnit === orgUnit));
  }

  /** Admin's Verification queue - just the PENDING ones awaiting ActivateIdentity. */
  @Transaction(false)
  @Returns('string')
  public async ListPendingOnboarding(ctx: Context): Promise<string> {
    const { requirePermission } = await import('./rbac');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_IDENTITY', '*');
    const docs = await listAllDIDs(ctx);
    return JSON.stringify(docs.filter((d) => d.status === DIDStatus.PENDING));
  }

  /**
   * Writes an AUTHENTICATE audit event for the caller. WhoAmI can't do
   * this itself (it's a query, so nothing it writes ever commits) - the
   * UI calls this once per session/role-switch so the Admin's Audit Trail
   * page has a real on-chain record of who logged in and when.
   */
  @Transaction()
  @Returns('string')
  public async RecordLogin(ctx: Context): Promise<string> {
    const { recordAudit } = await import('./audit');
    const did = deriveDID(ctx);
    await recordAudit(ctx, did, 'AUTHENTICATE', '');
    return did;
  }

  /**
   * Exported helper other contracts (RBAC, and the Asset Registry) call
   * to confirm a DID is real and currently ACTIVE (not pending, suspended,
   * or deactivated) before honoring any action from it.
   */
  public static async isActiveDID(ctx: Context, did: string): Promise<boolean> {
    const data = await ctx.stub.getState(didKey(ctx, did));
    if (!data || data.length === 0) return false;
    const doc: DIDDocument = JSON.parse(data.toString());
    return doc.status === DIDStatus.ACTIVE;
  }
}
