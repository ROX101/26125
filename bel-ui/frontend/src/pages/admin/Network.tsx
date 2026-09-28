import { useOutletContext } from 'react-router-dom';
import { fetchIdentities } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Network() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchIdentities(role), [role]);

  const orgUnits = new Set((data || []).map((d) => d.orgUnit));

  return (
    <div>
      <PageHeader title="Network" subtitle="Channel and org-unit topology, derived from the identities registered on-chain." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Channel" value="belchannel" />
          <Card title="Chaincode" value="belid" />
          <Card title="Org units represented" value={orgUnits.size} />
          <Card title="Total identities" value={(data || []).length} />
        </div>
        <p className="dim page-note">
          This view reflects org units seen in the identity registry ({roleConfig.orgUnit} included). Live Fabric
          peer/orderer telemetry (block height, endorsing peers, org MSPs) isn't wired up yet — that would need a
          separate monitoring endpoint on top of the Gateway connection.
        </p>
      </AsyncSection>
    </div>
  );
}
