import { useOutletContext } from 'react-router-dom';
import { fetchAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function AuditLog() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAuditEvents(role), [role]);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="On-chain activity relevant to approvals, minting and access decisions." />
      <AuditTable events={data} loading={loading} error={error} />
    </div>
  );
}
