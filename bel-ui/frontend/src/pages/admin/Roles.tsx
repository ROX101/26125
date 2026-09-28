import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { defineRole, fetchRoles, grantRole, revokeRole } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

function useNotice() {
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  return { notice, setNotice };
}

export default function Roles() {
  const { role, permissionCatalog } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchRoles(role), [role]);

  return (
    <div>
      <PageHeader title="Roles & Policies" subtitle="The four fixed role bundles, and the identities they're granted to." />

      <section className="panel-section">
        <h2>Defined roles</h2>
        <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No roles defined yet.">
          <DataTable
            columns={[
              { key: 'roleId', label: 'Role ID', mono: true },
              { key: 'name', label: 'Name' },
              { key: 'orgScope', label: 'Scope' },
              { key: 'permissions', label: 'Permissions', render: (r) => r.permissions.join(', ') },
            ]}
            rows={data || []}
            rowKey={(r) => r.roleId}
          />
        </AsyncSection>
      </section>

      <DefineRoleForm role={role} permissionCatalog={permissionCatalog} onDone={reload} />
      <GrantRevokeForm role={role} roles={data || []} onDone={reload} />
    </div>
  );
}

function DefineRoleForm({ role, permissionCatalog, onDone }: {
  role: PortalContext['role'];
  permissionCatalog: string[];
  onDone: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [name, setName] = useState('');
  const [orgScope, setOrgScope] = useState('*');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const { notice, setNotice } = useNotice();

  function togglePerm(p: string) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await defineRole(role, roleId.trim(), name.trim(), Array.from(perms).join(','), orgScope.trim());
      setNotice({ ok: true, message: `Role ${roleId} defined.` });
      setRoleId('');
      setName('');
      setPerms(new Set());
      onDone();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-section">
      <h2>Define a role</h2>
      <form className="stacked-form" onSubmit={submit}>
        <div className="form-row">
          <input className="text-input" placeholder="Role ID (e.g. ADMIN)" value={roleId} onChange={(e) => setRoleId(e.target.value)} required />
          <input className="text-input" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="text-input" placeholder="Org scope (or *)" value={orgScope} onChange={(e) => setOrgScope(e.target.value)} required />
        </div>
        <div className="permission-checks">
          {permissionCatalog.map((p) => (
            <label key={p} className="checkbox-label">
              <input type="checkbox" checked={perms.has(p)} onChange={() => togglePerm(p)} />
              {p}
            </label>
          ))}
        </div>
        <Button type="submit" disabled={submitting}>{submitting ? 'Defining…' : 'Define role'}</Button>
      </form>
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
    </section>
  );
}

function GrantRevokeForm({ role, roles, onDone }: {
  role: PortalContext['role'];
  roles: { roleId: string }[];
  onDone: () => void;
}) {
  const [subjectDID, setSubjectDID] = useState('');
  const [roleId, setRoleId] = useState('');
  const [orgScope, setOrgScope] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState<'grant' | 'revoke' | null>(null);
  const { notice, setNotice } = useNotice();

  async function grant() {
    setSubmitting('grant');
    setNotice(null);
    try {
      await grantRole(role, subjectDID.trim(), roleId.trim(), orgScope.trim(), expiresAt.trim() || undefined);
      setNotice({ ok: true, message: `Granted ${roleId} to ${subjectDID}.` });
      onDone();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(null);
    }
  }

  async function revoke() {
    setSubmitting('revoke');
    setNotice(null);
    try {
      await revokeRole(role, subjectDID.trim(), roleId.trim(), orgScope.trim());
      setNotice({ ok: true, message: `Revoked ${roleId} from ${subjectDID}.` });
      onDone();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="panel-section">
      <h2>Grant / revoke a role</h2>
      <div className="stacked-form">
        <div className="form-row">
          <input className="text-input mono" placeholder="Subject DID" value={subjectDID} onChange={(e) => setSubjectDID(e.target.value)} />
          <input className="text-input" list="role-ids" placeholder="Role ID" value={roleId} onChange={(e) => setRoleId(e.target.value)} />
          <datalist id="role-ids">
            {roles.map((r) => <option key={r.roleId} value={r.roleId} />)}
          </datalist>
          <input className="text-input" placeholder="Org scope (or *)" value={orgScope} onChange={(e) => setOrgScope(e.target.value)} />
          <input className="text-input" placeholder="Expires at (optional)" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div className="row-actions">
          <Button disabled={submitting !== null} onClick={grant}>{submitting === 'grant' ? 'Granting…' : 'Grant'}</Button>
          <Button variant="danger" disabled={submitting !== null} onClick={revoke}>{submitting === 'revoke' ? 'Revoking…' : 'Revoke'}</Button>
        </div>
      </div>
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
    </section>
  );
}
