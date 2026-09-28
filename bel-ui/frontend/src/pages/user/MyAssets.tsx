import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { AssetDocument, downloadAssetUrl, fetchMyAssets, requestDelegation, viewAsset } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, Modal, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function MyAssets() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchMyAssets(role), [role]);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [delegateFor, setDelegateFor] = useState<AssetDocument | null>(null);

  async function view(a: AssetDocument) {
    setNotice(null);
    try {
      await viewAsset(role, a.assetId);
      setNotice({ ok: true, message: `Access confirmed. Metadata: ${a.fileName} (${a.sha256Hash.slice(0, 16)}…)` });
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  function download(a: AssetDocument) {
    window.open(downloadAssetUrl(role, a.assetId), '_blank');
  }

  return (
    <div>
      <PageHeader title="My Assets" subtitle="Assets you uploaded, plus anything explicitly shared with you." />
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="You don't have any assets yet — try Upload.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'permissions', label: 'Your access', render: (a) => (a.permissions || []).join(', ') || '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (a) => (
                <div className="row-actions">
                  <Button variant="ghost" onClick={() => view(a)}>View</Button>
                  <Button variant="ghost" onClick={() => download(a)}>Download</Button>
                  <Button variant="ghost" onClick={() => setDelegateFor(a)}>Share…</Button>
                </div>
              ),
            },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>

      {delegateFor && (
        <DelegateModal
          role={role}
          asset={delegateFor}
          onClose={() => setDelegateFor(null)}
          onDone={() => {
            setDelegateFor(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DelegateModal({ role, asset, onClose, onDone }: {
  role: PortalContext['role'];
  asset: AssetDocument;
  onClose: () => void;
  onDone: () => void;
}) {
  const [targetDID, setTargetDID] = useState('');
  const [permissions, setPermissions] = useState<Set<string>>(new Set(['VIEW']));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(p: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestDelegation(role, asset.assetId, targetDID.trim(), Array.from(permissions).join(','));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Request access delegation — ${asset.assetId}`} onClose={onClose}>
      <form className="stacked-form" onSubmit={submit}>
        <input className="text-input mono" placeholder="Target DID" value={targetDID} onChange={(e) => setTargetDID(e.target.value)} required />
        <div className="permission-checks">
          {['VIEW', 'DOWNLOAD'].map((p) => (
            <label key={p} className="checkbox-label">
              <input type="checkbox" checked={permissions.has(p)} onChange={() => toggle(p)} />
              {p}
            </label>
          ))}
        </div>
        {error && <InlineNotice ok={false} message={error} />}
        <div className="row-actions">
          <Button type="submit" disabled={submitting}>{submitting ? 'Requesting…' : 'Request delegation'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
