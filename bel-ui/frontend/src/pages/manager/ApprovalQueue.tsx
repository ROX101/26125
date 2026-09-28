import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { approveAsset, fetchPendingApprovals, rejectAsset } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function ApprovalQueue() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchPendingApprovals(role), [role]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function approve(assetId: string) {
    setBusy(assetId);
    setNotice(null);
    try {
      await approveAsset(role, assetId);
      setNotice({ ok: true, message: `${assetId} approved.` });
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function reject(assetId: string) {
    setBusy(assetId);
    setNotice(null);
    try {
      await rejectAsset(role, assetId, reason);
      setNotice({ ok: true, message: `${assetId} rejected.` });
      setReasonFor(null);
      setReason('');
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Approval Queue" subtitle="Assets uploaded by your team, awaiting your sign-off before they can be minted." />
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="Nothing awaiting approval.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'orgScope', label: 'Org Scope' },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'createdAt', label: 'Uploaded' },
            {
              key: 'actions',
              label: 'Actions',
              render: (a) =>
                reasonFor === a.assetId ? (
                  <div className="row-actions">
                    <input className="text-input" placeholder="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <Button variant="danger" disabled={busy === a.assetId} onClick={() => reject(a.assetId)}>Confirm reject</Button>
                    <Button variant="ghost" onClick={() => setReasonFor(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="row-actions">
                    <Button disabled={busy === a.assetId} onClick={() => approve(a.assetId)}>
                      {busy === a.assetId ? 'Working…' : 'Approve'}
                    </Button>
                    <Button variant="danger" onClick={() => { setReasonFor(a.assetId); setReason(''); }}>Reject</Button>
                  </div>
                ),
            },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
