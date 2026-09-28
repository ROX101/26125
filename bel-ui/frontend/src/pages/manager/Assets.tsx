import { useOutletContext } from 'react-router-dom';
import { fetchAssets } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Assets() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAssets(role), [role]);
  const rows = (data || []).filter((a) => roleConfig.orgScope === '*' || a.orgScope === roleConfig.orgScope);

  return (
    <div>
      <PageHeader title="Assets" subtitle={`Assets scoped to ${roleConfig.orgUnit}.`} />
      <AsyncSection loading={loading} error={error} empty={rows.length === 0} emptyLabel="No assets in this org unit yet.">
        <DataTable
          columns={[
            { key: 'assetId', label: 'Asset ID', mono: true },
            { key: 'fileName', label: 'File' },
            { key: 'status', label: 'Status', render: (a) => <StatusPill status={a.status} /> },
            { key: 'uploadedBy', label: 'Uploaded by', mono: true, render: (a) => a.uploadedBy.replace('did:fabric:', '') },
            { key: 'createdAt', label: 'Created' },
          ]}
          rows={rows}
          rowKey={(a) => a.assetId}
        />
      </AsyncSection>
    </div>
  );
}
