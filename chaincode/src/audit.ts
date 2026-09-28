import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { AuditEvent, AuditResult } from './types';

/**
 * On-chain audit log. Only SUCCESS events are recorded: a chaincode
 * function that throws aborts its entire transaction (nothing it wrote,
 * including an audit entry, would ever commit), so there is no way to
 * durably log a FAILURE from inside the same invocation that failed.
 * Every mutating function across DIDRegistry, RBACEngine, and
 * AssetRegistry calls recordAudit() as its last step, once it knows the
 * action actually succeeded.
 */

function auditKey(ctx: Context, id: string) {
  return ctx.stub.createCompositeKey('AUDIT', [id]);
}

export async function recordAudit(
  ctx: Context,
  actor: string,
  action: string,
  target: string,
  message?: string,
  result: AuditResult = 'SUCCESS',
): Promise<void> {
  const seconds = ctx.stub.getTxTimestamp().seconds.low.toString();
  const id = `${seconds}-${ctx.stub.getTxID().slice(0, 12)}`;
  const event: AuditEvent = {
    id,
    actor,
    action,
    target,
    result,
    message,
    timestamp: seconds,
  };
  await ctx.stub.putState(auditKey(ctx, id), Buffer.from(JSON.stringify(event)));
}

async function listAllEvents(ctx: Context): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  const iterator = await ctx.stub.getStateByPartialCompositeKey('AUDIT', []);
  let result = await iterator.next();
  while (!result.done) {
    events.push(JSON.parse(result.value.value.toString()));
    result = await iterator.next();
  }
  await iterator.close();
  events.sort((a, b) => Number(b.timestamp) - Number(a.timestamp) || b.id.localeCompare(a.id));
  return events;
}

@Info({ title: 'Audit', description: 'Read-only access to the on-chain audit trail' })
export class AuditContract extends Contract {
  constructor() {
    super('AuditContract');
  }

  /**
   * Lists all recorded audit events, newest first. Gated by VIEW_AUDIT -
   * only the Auditor (and anyone else a role grants it to) can read this.
   * Filtering by actor/action/date is left to the caller (the UI does it
   * client-side); LevelDB's key-value model doesn't support server-side
   * rich queries the way CouchDB would.
   */
  @Transaction(false)
  @Returns('string')
  public async ListEvents(ctx: Context): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const { requirePermission } = await import('./rbac');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'VIEW_AUDIT', '*');
    return JSON.stringify(await listAllEvents(ctx));
  }

  /**
   * Self-scoped, ungated: always resolves the caller's own DID from their
   * Fabric identity (never a caller-supplied one), so a User with no
   * VIEW_AUDIT permission can still see their own "Recent Activity"
   * without being able to read anyone else's. Mirrors the
   * ListMyAssets / ListMyDelegationRequests pattern in AssetRegistry.
   */
  @Transaction(false)
  @Returns('string')
  public async ListMyEvents(ctx: Context): Promise<string> {
    const { deriveDID } = await import('./didRegistry');
    const callerDID = deriveDID(ctx);
    const events = await listAllEvents(ctx);
    return JSON.stringify(events.filter((e) => e.actor === callerDID));
  }
}
