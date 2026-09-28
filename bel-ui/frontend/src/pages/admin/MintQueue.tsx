import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { fetchPendingMints, mintAsset } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function MintQueue() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchPendingMints(role), [role]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  async function mint(assetId: string) {
    setBusy(assetId);
    setNotice(null);
    try {
      await mintAsset(role, assetId);
      setNotice({ ok: true, message: `${assetId} minted.` });
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Mint Queue" subtitle="Assets that have cleared approval and are ready to become active on-chain records." />
      {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="Nothing waiting to be minted.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'orgScope', label: 'Org Scope' },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'approvedBy', label: 'Approved by', mono: true, render: (a) => (a.approvedBy || '').replace('did:fabric:', '') },
            {
              key: 'actions',
              label: 'Actions',
              render: (a) => (
                <Button disabled={busy === a.assetId} onClick={() => mint(a.assetId)}>
                  {busy === a.assetId ? 'Minting…' : 'Mint'}
                </Button>
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
