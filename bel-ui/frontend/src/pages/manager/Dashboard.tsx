import { useOutletContext } from 'react-router-dom';
import { fetchAssets, fetchPendingApprovals } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const approvals = useLoader(() => fetchPendingApprovals(role), [role]);
  const assets = useLoader(() => fetchAssets(role), [role]);

  const loading = approvals.loading || assets.loading;
  const error = approvals.error || assets.error;
  const myOrgAssets = (assets.data || []).filter((a) => a.orgScope === roleConfig.orgScope || roleConfig.orgScope === '*');
  const activeInOrg = myOrgAssets.filter((a) => a.status === 'ACTIVE').length;

  return (
    <div>
      <PageHeader title="Manager Dashboard" subtitle={`Approvals and asset activity for ${roleConfig.orgUnit}.`} />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Pending approvals" value={(approvals.data || []).length} />
          <Card title="Assets in my unit" value={myOrgAssets.length} />
          <Card title="Active in my unit" value={activeInOrg} />
        </div>
      </AsyncSection>
    </div>
  );
}
