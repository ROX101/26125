import cors from 'cors';
import express from 'express';
import multer from 'multer';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getAllRoleInfo, getConnection, getRoleInfo, loadConfig, RoleName } from './gateway';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const IDENTITIES_PATH = process.env.IDENTITIES_PATH || path.join(__dirname, '..', '..', 'identities.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

const ROLE_META: Record<RoleName, { displayName: string; description: string }> = {
  ADMIN: {
    displayName: 'Admin',
    description: 'CMD / Functional Director tier — manages identities, defines roles, and mints approved assets',
  },
  MANAGER: {
    displayName: 'Manager',
    description: 'Executive Director / GM / Divisional Head tier — approves assets and access delegations within their unit',
  },
  AUDITOR: {
    displayName: 'Auditor',
    description: 'Audit Committee tier — read-only access to the full immutable trail, across every unit',
  },
  USER: {
    displayName: 'User',
    description: 'Departmental Head tier — uploads assets and requests access delegation',
  },
};

const PERMISSION_CATALOG = [
  'MANAGE_IDENTITY', 'MANAGE_ROLE', 'MINT_ASSET', 'APPROVE_ASSET',
  'GRANT_ACCESS', 'REVOKE_ACCESS', 'APPROVE_DELEGATION', 'VIEW_AUDIT',
  'VIEW', 'DOWNLOAD', 'UPLOAD_ASSET', 'REQUEST_ACCESS_DELEGATION',
];

const ROLE_NAMES: RoleName[] = ['ADMIN', 'MANAGER', 'AUDITOR', 'USER'];

/** Fabric Gateway errors often wrap the real chaincode message inside a
 * longer gRPC error string. Best-effort extraction of the readable part;
 * falls back to the full message if the pattern doesn't match. The raw
 * error is always logged server-side too. */
function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/message:\s*"?([^"\n]+)"?/) || raw.match(/Error:\s*(.+)/);
  return match ? match[1].trim() : raw;
}

function parseRole(req: express.Request): RoleName | null {
  const role = (req.query.role || req.body?.role) as string | undefined;
  return role && ROLE_NAMES.includes(role as RoleName) ? (role as RoleName) : null;
}

/** Every locally-stored file is named "<assetId>__<original file name>" so
 * a download handler can find it by assetId alone without needing a
 * separate on-chain "storage path" field (the ledger only ever sees the
 * hash + metadata, never a filesystem path). */
function uploadedFilePath(assetId: string): string | null {
  const prefix = `${assetId}__`;
  const match = fs.readdirSync(UPLOADS_DIR).find((f) => f.startsWith(prefix));
  return match ? path.join(UPLOADS_DIR, match) : null;
}

async function main() {
  loadConfig(IDENTITIES_PATH);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const app = express();
  const frontendOrigin = process.env.FRONTEND_ORIGIN || '*';
  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ---- Config / session -----------------------------------------------

  app.get('/api/config', (_req, res) => {
    const allRoles = getAllRoleInfo();
    const roles = ROLE_NAMES.reduce((acc, r) => {
      const info = allRoles[r];
      acc[r] = { ...ROLE_META[r], did: info.did, orgUnit: info.orgUnit, orgScope: info.orgScope };
      return acc;
    }, {} as Record<string, unknown>);
    res.json({ roles, permissionCatalog: PERMISSION_CATALOG });
  });

  /** Writes an AUTHENTICATE audit event and returns the role's DID. Call
   * this once whenever the UI switches to acting as a given role. */
  app.post('/api/login', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.submitTransaction('RecordLogin');
      res.json({ ok: true, did: Buffer.from(bytes).toString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/permissions/:role', async (req, res) => {
    const roleName = req.params.role as RoleName;
    if (!ROLE_NAMES.includes(roleName)) return res.status(400).json({ error: 'unknown role' });
    const info = getRoleInfo(roleName);
    try {
      const conn = await getConnection(roleName);
      const result: Record<string, boolean> = {};
      for (const perm of PERMISSION_CATALOG) {
        const bytes = await conn.rbacContract.evaluateTransaction('HasPermission', info.did, perm, info.orgScope);
        result[perm] = Buffer.from(bytes).toString() === 'true';
      }
      res.json({ permissions: result });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  // ---- Identity (Admin: Directory / Verification) ----------------------

  app.get('/api/identities', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.evaluateTransaction('ListIdentities');
      res.json({ identities: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/identities/by-org/:orgUnit', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.evaluateTransaction('ListIdentitiesByOrgUnit', req.params.orgUnit);
      res.json({ identities: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/identities/pending', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.didContract.evaluateTransaction('ListPendingOnboarding');
      res.json({ pending: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/identities/request-onboarding', async (req, res) => {
    const role = parseRole(req);
    const { subjectDID, orgUnit } = req.body as { subjectDID: string; orgUnit: string };
    if (!role || !subjectDID || !orgUnit) return res.status(400).json({ error: 'role, subjectDID, orgUnit required' });
    try {
      const conn = await getConnection(role);
      await conn.didContract.submitTransaction('RequestOnboarding', subjectDID, orgUnit);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  for (const [action, fn] of [
    ['activate', 'ActivateIdentity'],
    ['suspend', 'SuspendIdentity'],
    ['deactivate', 'DeactivateIdentity'],
  ] as const) {
    app.post(`/api/identities/:did/${action}`, async (req, res) => {
      const role = parseRole(req);
      if (!role) return res.status(400).json({ error: 'unknown role' });
      try {
        const conn = await getConnection(role);
        await conn.didContract.submitTransaction(fn, req.params.did);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ ok: false, error: cleanError(err) });
      }
    });
  }

  // ---- Roles & Policies (Admin) ----------------------------------------

  app.get('/api/roles', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.rbacContract.evaluateTransaction('ListRoles');
      res.json({ roles: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/roles/define', async (req, res) => {
    const role = parseRole(req);
    const { roleId, name, permissionsCSV, orgScope } = req.body as Record<string, string>;
    if (!role || !roleId || !name || !permissionsCSV || !orgScope) {
      return res.status(400).json({ error: 'role, roleId, name, permissionsCSV, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      await conn.rbacContract.submitTransaction('DefineRole', roleId, name, permissionsCSV, orgScope);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/roles/grant', async (req, res) => {
    const role = parseRole(req);
    const { subjectDID, roleId, orgScope, expiresAt } = req.body as Record<string, string>;
    if (!role || !subjectDID || !roleId || !orgScope) {
      return res.status(400).json({ error: 'role, subjectDID, roleId, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      await conn.rbacContract.submitTransaction('GrantRole', subjectDID, roleId, orgScope, expiresAt || '');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/roles/revoke', async (req, res) => {
    const role = parseRole(req);
    const { subjectDID, roleId, orgScope } = req.body as Record<string, string>;
    if (!role || !subjectDID || !roleId || !orgScope) {
      return res.status(400).json({ error: 'role, subjectDID, roleId, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      await conn.rbacContract.submitTransaction('RevokeRole', subjectDID, roleId, orgScope);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  // ---- Assets ------------------------------------------------------------

  /** Multipart upload: the file's bytes never touch the chain. We hash them,
   * submit the hash + metadata to AssetRegistryContract.UploadAsset, and
   * only once we have the resulting assetId do we write the file to local
   * disk (named "<assetId>__<originalname>") - see uploadedFilePath(). */
  app.post('/api/assets/upload', upload.single('file'), async (req, res) => {
    const role = parseRole(req);
    const orgScope = req.body?.orgScope as string | undefined;
    if (!role || !req.file || !orgScope) {
      return res.status(400).json({ error: 'role, file, orgScope required' });
    }
    try {
      const conn = await getConnection(role);
      const sha256Hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const bytes = await conn.assetContract.submitTransaction(
        'UploadAsset', req.file.originalname, sha256Hash, orgScope,
      );
      const assetId = Buffer.from(bytes).toString();
      fs.writeFileSync(path.join(UPLOADS_DIR, `${assetId}__${req.file.originalname}`), req.file.buffer);
      res.json({ ok: true, assetId, sha256Hash });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/assets', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListAssets');
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/mine', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const bytes = await conn.assetContract.evaluateTransaction('ListMyAssets', did);
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/pending-approval', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListPendingApprovals');
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/pending-mint', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListPendingMints');
      res.json({ assets: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/assets/:id/approve', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('ApproveAsset', req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/assets/:id/reject', async (req, res) => {
    const role = parseRole(req);
    const reason = (req.body?.reason as string) || '';
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('RejectAsset', req.params.id, reason);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/assets/:id/mint', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('MintAsset', req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/assets/:id/view', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const allowedBytes = await conn.assetContract.evaluateTransaction('HasAssetAccess', req.params.id, did, 'VIEW');
      if (Buffer.from(allowedBytes).toString() !== 'true') {
        return res.status(403).json({ error: `lacks VIEW access on ${req.params.id}` });
      }
      const bytes = await conn.assetContract.evaluateTransaction('GetAsset', req.params.id);
      res.json({ asset: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/assets/:id/download', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const allowedBytes = await conn.assetContract.evaluateTransaction('HasAssetAccess', req.params.id, did, 'DOWNLOAD');
      if (Buffer.from(allowedBytes).toString() !== 'true') {
        return res.status(403).json({ error: `lacks DOWNLOAD access on ${req.params.id}` });
      }
      const filePath = uploadedFilePath(req.params.id);
      if (!filePath) return res.status(404).json({ error: 'file not found on this server' });
      res.download(filePath, path.basename(filePath).split('__').slice(1).join('__'));
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  // ---- Access delegation ---------------------------------------------

  app.post('/api/delegations/request', async (req, res) => {
    const role = parseRole(req);
    const { assetId, targetDID, permissionsCSV } = req.body as Record<string, string>;
    if (!role || !assetId || !targetDID || !permissionsCSV) {
      return res.status(400).json({ error: 'role, assetId, targetDID, permissionsCSV required' });
    }
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.submitTransaction(
        'RequestAccessDelegation', assetId, targetDID, permissionsCSV,
      );
      res.json({ ok: true, requestId: Buffer.from(bytes).toString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.get('/api/delegations', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.assetContract.evaluateTransaction('ListDelegations');
      res.json({ delegations: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.get('/api/delegations/mine', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const did = getRoleInfo(role).did;
      const bytes = await conn.assetContract.evaluateTransaction('ListMyDelegationRequests', did);
      res.json({ delegations: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  app.post('/api/delegations/:id/approve', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('ApproveDelegation', req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  app.post('/api/delegations/:id/reject', async (req, res) => {
    const role = parseRole(req);
    const reason = (req.body?.reason as string) || '';
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      await conn.assetContract.submitTransaction('RejectDelegation', req.params.id, reason);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: cleanError(err) });
    }
  });

  // ---- Audit trail (Auditor, plus anyone else VIEW_AUDIT is granted to) --

  app.get('/api/audit', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.auditContract.evaluateTransaction('ListEvents');
      res.json({ events: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  /** Self-scoped: always the caller's own events, regardless of whether
   * they hold VIEW_AUDIT. Powers User's "Recent Activity" page. */
  app.get('/api/audit/mine', async (req, res) => {
    const role = parseRole(req);
    if (!role) return res.status(400).json({ error: 'unknown role' });
    try {
      const conn = await getConnection(role);
      const bytes = await conn.auditContract.evaluateTransaction('ListMyEvents');
      res.json({ events: JSON.parse(Buffer.from(bytes).toString()) });
    } catch (err) {
      res.status(500).json({ error: cleanError(err) });
    }
  });

  // Serves the built frontend (npm run build in frontend/) from this same
  // process, so a demo tunnel only ever needs to expose ONE port. Requests
  // become same-origin, sidestepping CORS entirely for this path.
  const frontendDist = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`BEL demo API listening on http://localhost:${PORT}`);
    console.log(`Reading identities from ${IDENTITIES_PATH}`);
    console.log(`Storing uploaded files in ${UPLOADS_DIR}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
