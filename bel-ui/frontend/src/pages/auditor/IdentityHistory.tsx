import { useOutletContext } from 'react-router-dom';
import { fetchIdentities } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function IdentityHistory() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchIdentities(role), [role]);

  return (
    <div>
      <PageHeader title="Identity History" subtitle="Every DID's onboarding origin and current lifecycle status." />
      <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No identities on the ledger yet.">
        <DataTable
          columns={[
            { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
            { key: 'orgUnit', label: 'Org Unit' },
            { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
            { key: 'createdBy', label: 'Created by', mono: true, render: (d) => d.createdBy.replace('did:fabric:', '') },
            { key: 'createdAt', label: 'Created' },
          ]}
          rows={data || []}
          rowKey={(d) => d.did}
        />
      </AsyncSection>
    </div>
  );
}
