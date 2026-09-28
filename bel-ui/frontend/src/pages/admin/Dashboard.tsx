import { useOutletContext } from 'react-router-dom';
import { fetchIdentities, fetchPendingOnboarding, fetchPendingMints, fetchRoles } from '../../api';
import { useLoader, Card, PageHeader, AsyncSection } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Dashboard() {
  const { role } = useOutletContext<PortalContext>();
  const identities = useLoader(() => fetchIdentities(role), [role]);
  const pending = useLoader(() => fetchPendingOnboarding(role), [role]);
  const mints = useLoader(() => fetchPendingMints(role), [role]);
  const roles = useLoader(() => fetchRoles(role), [role]);

  const loading = identities.loading || pending.loading || mints.loading || roles.loading;
  const error = identities.error || pending.error || mints.error || roles.error;

  const activeCount = (identities.data || []).filter((d) => d.status === 'ACTIVE').length;

  return (
    <div>
      <PageHeader title="Admin Dashboard" subtitle="Identity, role and asset oversight across the whole ledger." />
      <AsyncSection loading={loading} error={error}>
        <div className="stat-grid">
          <Card title="Active identities" value={activeCount} hint={`${(identities.data || []).length} total`} />
          <Card title="Pending onboarding" value={(pending.data || []).length} hint="awaiting activation" />
          <Card title="Pending mints" value={(mints.data || []).length} hint="approved, not yet minted" />
          <Card title="Defined roles" value={(roles.data || []).length} hint="ADMIN / MANAGER / AUDITOR / USER" />
        </div>
      </AsyncSection>
    </div>
  );
}
