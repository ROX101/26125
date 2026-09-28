import { useOutletContext } from 'react-router-dom';
import { fetchAssets } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function AssetRegistry() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAssets(role), [role]);

  return (
    <div>
      <PageHeader title="Asset Registry" subtitle="Every asset ever uploaded, across every org unit and lifecycle stage." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No assets have been uploaded yet.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'orgScope', label: 'Org Scope' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'sha256Hash', label: 'SHA-256', mono: true, render: (a) => `${a.sha256Hash.slice(0, 16)}…` },
            { key: 'createdAt', label: 'Created' },
          ]}
          rows={data || []}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
