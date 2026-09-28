import { useOutletContext } from 'react-router-dom';
import { fetchMyAssets, fetchMyDelegations } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role } = useOutletContext<PortalContext>();
  const assets = useLoader(() => fetchMyAssets(role), [role]);
  const delegations = useLoader(() => fetchMyDelegations(role), [role]);

  const loading = assets.loading || delegations.loading;
  const error = assets.error || delegations.error;
  const active = (assets.data || []).filter((a) => a.status === 'ACTIVE').length;
  const pendingDelegations = (delegations.data || []).filter((d) => d.status === 'PENDING').length;

  return (
    <div>
      <PageHeader title="My Dashboard" subtitle="Assets you've uploaded or been granted access to, and your delegation requests." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="My assets" value={(assets.data || []).length} />
          <Card title="Active" value={active} />
          <Card title="Pending delegation requests" value={pendingDelegations} />
        </div>
      </AsyncSection>
    </div>
  );
}
