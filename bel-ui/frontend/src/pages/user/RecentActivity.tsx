import { useOutletContext } from 'react-router-dom';
import { fetchMyAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function RecentActivity() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchMyAuditEvents(role), [role]);

  return (
    <div>
      <PageHeader title="Recent Activity" subtitle="On-chain events where you were the actor." />
      <AuditTable events={data} loading={loading} error={error} />
    </div>
  );
}
