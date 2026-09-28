import { useOutletContext } from 'react-router-dom';
import { useState } from 'react';
import { fetchAuditEvents } from '../../api';
import { PageHeader, useLoader } from '../../components/common';
import AuditTable from '../../components/AuditTable';
import { PortalContext } from '../../PortalLayout';

export default function AuditEvents() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error } = useLoader(() => fetchAuditEvents(role), [role]);
  const [q, setQ] = useState('');

  const filter = (e: { actor: string; action: string; target: string }) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return e.actor.toLowerCase().includes(needle) || e.action.toLowerCase().includes(needle) || e.target.toLowerCase().includes(needle);
  };

  return (
    <div>
      <PageHeader
        title="Audit Events"
        subtitle="Every SUCCESS-recorded state change on the ledger, newest first."
        action={<input className="text-input" placeholder="Filter by actor, action or target…" value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      <AuditTable events={data} loading={loading} error={error} filter={filter} />
    </div>
  );
}
