import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { Role, RoleAssignment } from './types';
import { PERMISSIONS } from './permissions';

// Fixed by the problem statement text - do not add or rename these.
const ROLE_NAMES = ['ADMIN', 'MANAGER', 'AUDITOR', 'USER'];

function roleKey(ctx: Context, roleId: string) {
  return ctx.stub.createCompositeKey('ROLE', [roleId]);
}
function assignmentKey(ctx: Context, did: string, roleId: string, orgScope: string) {
  return ctx.stub.createCompositeKey('ROLEASSIGN', [did, roleId, orgScope]);
}

/**
 * Core enforcement function. Every other contract (Asset Registry, DID
 * Registry) calls this before doing anything sensitive. Throws if the
 * caller's DID isn't currently ACTIVE, or if they don't hold the
 * permission in the given org scope - so a suspended/deactivated
 * identity's still-unexpired role grant can never be exercised.
 */
export async function requirePermission(
  ctx: Context,
  callerDID: string,
  permission: string,
  orgScope: string,
): Promise<void> {
  const { DIDRegistryContract } = await import('./didRegistry');
  if (!(await DIDRegistryContract.isActiveDID(ctx, callerDID))) {
    throw new Error(`DID ${callerDID} is not active`);
  }

  const iterator = await ctx.stub.getStateByPartialCompositeKey('ROLEASSIGN', [callerDID]);
  let allowed = false;
  let result = await iterator.next();
  while (!result.done) {
    const assignment: RoleAssignment = JSON.parse(result.value.value.toString());
    const inScope = assignment.orgScope === orgScope || assignment.orgScope === '*';
    const notExpired = !assignment.expiresAt || Date.parse(assignment.expiresAt) > Date.now();
    if (inScope && notExpired) {
      const roleData = await ctx.stub.getState(roleKey(ctx, assignment.roleId));
      if (roleData && roleData.length > 0) {
        const role: Role = JSON.parse(roleData.toString());
        if (role.permissions.includes(permission)) {
          allowed = true;
          break;
        }
      }
    }
    result = await iterator.next();
  }
  await iterator.close();

  if (!allowed) {
    throw new Error(`DID ${callerDID} lacks permission ${permission} in scope ${orgScope}`);
  }
}

/** Non-throwing counterpart, for read paths (e.g. AssetRegistryContract
 * deciding whether to include an asset in "my assets") that need a yes/no
 * answer rather than an exception. */
export async function hasPermission(
  ctx: Context,
  callerDID: string,
  permission: string,
  orgScope: string,
): Promise<boolean> {
  try {
    await requirePermission(ctx, callerDID, permission, orgScope);
    return true;
  } catch {
    return false;
  }
}

@Info({ title: 'RBACEngine', description: 'Role and permission management, grounded in BEL real duty categories' })
export class RBACEngineContract extends Contract {
  constructor() {
    super('RBACEngineContract');
  }

  /**
   * One-time system bootstrap. Only succeeds while ZERO role assignments
   * exist anywhere on the ledger - the instant any assignment exists
   * (including the one this call creates), it permanently locks itself out.
   * This is the fix for the DID/RBAC chicken-and-egg problem: DefineRole
   * and GrantRole both require MANAGE_ROLE, but the very first permission
   * on the network can't have been granted by anyone. Call this once,
   * right after InitAdmin, from the same identity.
   */
  @Transaction()
  public async BootstrapAdmin(ctx: Context): Promise<void> {
    const { deriveDID, DIDRegistryContract } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    if (!(await DIDRegistryContract.isActiveDID(ctx, callerDID))) {
      throw new Error(`DID ${callerDID} is not active - call InitAdmin first`);
    }

    const iterator = await ctx.stub.getStateByPartialCompositeKey('ROLEASSIGN', []);
    const first = await iterator.next();
    await iterator.close();
    if (!first.done) {
      throw new Error('Bootstrap already completed - use GrantRole instead');
    }

    const adminPermissions = ['MANAGE_IDENTITY', 'MANAGE_ROLE', 'MINT_ASSET'];
    const role: Role = { roleId: 'ADMIN', name: 'Admin', permissions: adminPermissions, orgScope: '*' };
    await ctx.stub.putState(roleKey(ctx, 'ADMIN'), Buffer.from(JSON.stringify(role)));

    const assignment: RoleAssignment = {
      did: callerDID,
      roleId: 'ADMIN',
      orgScope: '*',
      expiresAt: null,
      assignedBy: callerDID,
      assignedAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
    };
    await ctx.stub.putState(
      assignmentKey(ctx, callerDID, 'ADMIN', '*'),
      Buffer.from(JSON.stringify(assignment)),
    );
    ctx.stub.setEvent('RoleGranted', Buffer.from(JSON.stringify(assignment)));
    await recordAudit(ctx, callerDID, 'BOOTSTRAP_ADMIN', callerDID);
  }

  @Transaction()
  public async DefineRole(
    ctx: Context,
    roleId: string,
    name: string,
    permissionsCSV: string,
    orgScope: string,
  ): Promise<void> {
    if (!ROLE_NAMES.includes(roleId)) {
      throw new Error(`roleId must be one of ${ROLE_NAMES.join(', ')} (fixed by the problem statement)`);
    }
    const { deriveDID } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_ROLE', orgScope);

    const permissions = permissionsCSV.split(',').map((p) => p.trim()).filter(Boolean);
    for (const p of permissions) {
      if (!PERMISSIONS[p]) throw new Error(`Unknown permission: ${p}`);
    }
    const role: Role = { roleId, name, permissions, orgScope };
    await ctx.stub.putState(roleKey(ctx, roleId), Buffer.from(JSON.stringify(role)));
    await recordAudit(ctx, callerDID, 'DEFINE_ROLE', roleId, permissionsCSV);
  }

  @Transaction()
  public async GrantRole(
    ctx: Context,
    subjectDID: string,
    roleId: string,
    orgScope: string,
    expiresAt: string, // pass "" for no expiry
  ): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_ROLE', orgScope);

    const roleData = await ctx.stub.getState(roleKey(ctx, roleId));
    if (!roleData || roleData.length === 0) {
      throw new Error(`Role ${roleId} is not defined - call DefineRole first`);
    }
    const assignment: RoleAssignment = {
      did: subjectDID,
      roleId,
      orgScope,
      expiresAt: expiresAt || null,
      assignedBy: callerDID,
      assignedAt: ctx.stub.getTxTimestamp().seconds.low.toString(),
    };
    await ctx.stub.putState(
      assignmentKey(ctx, subjectDID, roleId, orgScope),
      Buffer.from(JSON.stringify(assignment)),
    );
    ctx.stub.setEvent('RoleGranted', Buffer.from(JSON.stringify(assignment)));
    await recordAudit(ctx, callerDID, 'GRANT_ROLE', subjectDID, `${roleId}@${orgScope}`);
  }

  @Transaction()
  public async RevokeRole(ctx: Context, subjectDID: string, roleId: string, orgScope: string): Promise<void> {
    const { deriveDID } = await import('./didRegistry');
    const { recordAudit } = await import('./audit');
    const callerDID = deriveDID(ctx);
    await requirePermission(ctx, callerDID, 'MANAGE_ROLE', orgScope);

    const key = assignmentKey(ctx, subjectDID, roleId, orgScope);
    const existing = await ctx.stub.getState(key);
    if (!existing || existing.length === 0) {
      throw new Error(`No such role assignment for ${subjectDID}`);
    }
    await ctx.stub.deleteState(key);
    ctx.stub.setEvent(
      'RoleRevoked',
      Buffer.from(JSON.stringify({ did: subjectDID, roleId, orgScope, revokedBy: callerDID })),
    );
    await recordAudit(ctx, callerDID, 'REVOKE_ROLE', subjectDID, `${roleId}@${orgScope}`);
  }

  /** Read-only check, useful for a UI to decide what buttons to show. */
  @Transaction(false)
  @Returns('boolean')
  public async HasPermission(ctx: Context, did: string, permission: string, orgScope: string): Promise<boolean> {
    return hasPermission(ctx, did, permission, orgScope);
  }

  /** Admin's Roles & Policies page - the (at most 4) role definitions that exist. */
  @Transaction(false)
  @Returns('string')
  public async ListRoles(ctx: Context): Promise<string> {
    const roles: Role[] = [];
    for (const roleId of ROLE_NAMES) {
      const data = await ctx.stub.getState(roleKey(ctx, roleId));
      if (data && data.length > 0) {
        roles.push(JSON.parse(data.toString()));
      }
    }
    return JSON.stringify(roles);
  }
}
