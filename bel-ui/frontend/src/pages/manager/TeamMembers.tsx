import { useOutletContext } from 'react-router-dom';
import { fetchIdentitiesByOrgUnit } from '../../api';
import { AsyncSection, DataTable, PageHeader, StatusPill, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function TeamMembers() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchIdentitiesByOrgUnit(role, roleConfig.orgUnit), [role, roleConfig.orgUnit]);

  return (
    <div>
      <PageHeader title="Team Members" subtitle={`Identities registered under ${roleConfig.orgUnit}.`} />
      <AsyncSection
        loading={loading}
        error={error}
        empty={(data || []).length === 0}
        emptyLabel="No identities found for this org unit."
      >
        <DataTable
          columns={[
            { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
            { key: 'status', label: 'Status', render: (d) => <StatusPill status={d.status} /> },
            { key: 'createdAt', label: 'Onboarded' },
          ]}
          rows={data || []}
          rowKey={(d) => d.did}
        />
      </AsyncSection>
    </div>
  );
}
