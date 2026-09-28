import { AuditEvent } from '../api';
import { AsyncSection, Column, DataTable, StatusPill } from './common';

function fmtTime(seconds: string): string {
  const n = Number(seconds);
  if (!n) return seconds;
  return new Date(n * 1000).toLocaleString();
}

const COLUMNS: Column<AuditEvent>[] = [
  { key: 'timestamp', label: 'Time', render: (e) => fmtTime(e.timestamp) },
  { key: 'actor', label: 'Actor', mono: true, render: (e) => e.actor.replace('did:fabric:', '') },
  { key: 'action', label: 'Action' },
  { key: 'target', label: 'Target', mono: true, render: (e) => e.target.replace('did:fabric:', '') },
  { key: 'result', label: 'Result', render: (e) => <StatusPill status={e.result} /> },
  { key: 'message', label: 'Detail', render: (e) => e.message || '—' },
];

export default function AuditTable({ events, loading, error, filter }: {
  events: AuditEvent[] | null;
  loading: boolean;
  error: string | null;
  filter?: (e: AuditEvent) => boolean;
}) {
  const rows = (events || []).filter(filter || (() => true)).slice().sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  return (
    <AsyncSection loading={loading} error={error} empty={rows.length === 0} emptyLabel="No audit events recorded yet.">
      <DataTable columns={COLUMNS} rows={rows} rowKey={(e) => e.id} />
    </AsyncSection>
  );
}
