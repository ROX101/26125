import { useOutletContext } from 'react-router-dom';
import { fetchMyDelegations } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Delegations() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchMyDelegations(role), [role]);

  return (
    <div>
      <PageHeader title="Delegation Requests" subtitle="Access-sharing requests you've made for your own assets." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="You haven't requested any delegations yet.">
        <DataTable
          columns={[
            { key: 'requestId', label: 'Request ID', mono: true },
            { key: 'assetId', label: 'Asset', mono: true },
            { key: 'targetDID', label: 'Shared with', mono: true, render: (d) => d.targetDID.replace('did:fabric:', '') },
            { key: 'permissionsCSV', label: 'Permissions' },
            { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
            { key: 'createdAt', label: 'Requested' },
          ]}
          rows={data || []}
          rowKey={(d) => d.requestId}
        />
      </AsyncSection>
    </div>
  );
}
