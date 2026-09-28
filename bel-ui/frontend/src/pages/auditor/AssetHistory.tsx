import { useOutletContext } from 'react-router-dom';
import { fetchAssets } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function AssetHistory() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAssets(role), [role]);

  return (
    <div>
      <PageHeader title="Asset History" subtitle="Full lifecycle timeline for every asset — upload, approval, mint or rejection." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No assets on the ledger yet.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'createdAt', label: 'Uploaded' },
            { key: 'approvedAt', label: 'Approved', render: (a) => a.approvedAt || '—' },
            { key: 'mintedAt', label: 'Minted', render: (a) => a.mintedAt || '—' },
            { key: 'rejectionReason', label: 'Rejected', render: (a) => a.rejectionReason || '—' },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
