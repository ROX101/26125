import { useOutletContext } from 'react-router-dom';
import { activateIdentity, deactivateIdentity, DIDDocument, fetchIdentities, suspendIdentity } from '../../api';
import { AsyncSection, Button, Column, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';
import { useState } from 'react';

export default function Directory() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchIdentities(role), [role]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, did: string) {
    setBusy(did);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<DIDDocument>[] = [
    { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
    { key: 'orgUnit', label: 'Org Unit' },
    { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
    { key: 'createdAt', label: 'Created' },
    {
      key: 'actions',
      label: 'Actions',
      render: (d) => (
        <div className="row-actions">
          {(d.status === 'PENDING' || d.status === 'SUSPENDED') && (
            <Button variant="ghost" disabled={busy === d.did} onClick={() => run(() => activateIdentity(role, d.did), d.did)}>
              Activate
            </Button>
          )}
          {d.status === 'ACTIVE' && (
            <Button variant="ghost" disabled={busy === d.did} onClick={() => run(() => suspendIdentity(role, d.did), d.did)}>
              Suspend
            </Button>
          )}
          {d.status !== 'DEACTIVATED' && (
            <Button variant="danger" disabled={busy === d.did} onClick={() => run(() => deactivateIdentity(role, d.did), d.did)}>
              Deactivate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Identity Directory" subtitle="Every DID ever onboarded to this ledger, with its current lifecycle state." />
      {actionError && <div className="notice notice-bad">{actionError}</div>}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No identities on the ledger yet.">
        <DataTable columns={columns} rows={data || []} rowKey={(d) => d.did} />
      </AsyncSection>
    </div>
  );
}
