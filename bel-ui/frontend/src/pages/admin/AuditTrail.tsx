import { useOutletContext } from 'react-router-dom';
import { fetchAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function AuditTrail() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAuditEvents(role), [role]);

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="The full, explicit on-chain audit log — every state-changing call, in order." />
      <AuditTable events={data} loading={loading} error={error} />
    </div>
  );
}
