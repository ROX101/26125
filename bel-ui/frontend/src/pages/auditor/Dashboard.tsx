import { useOutletContext } from 'react-router-dom';
import { fetchAssets, fetchAuditEvents } from '../../api';
import { AsyncSection, Card, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role } = useOutletContext<PortalContext>();
  const events = useLoader(() => fetchAuditEvents(role), [role]);
  const assets = useLoader(() => fetchAssets(role), [role]);

  const loading = events.loading || assets.loading;
  const error = events.error || assets.error;
  const failures = (events.data || []).filter((e) => e.result === 'FAILURE').length;

  return (
    <div>
      <PageHeader title="Auditor Dashboard" subtitle="Read-only oversight of the full immutable trail, across every unit." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Total audit events" value={(events.data || []).length} />
          <Card title="Recorded failures" value={failures} hint="failed calls never commit, so this is usually 0" />
          <Card title="Total assets tracked" value={(assets.data || []).length} />
        </div>
      </AsyncSection>
    </div>
  );
}
