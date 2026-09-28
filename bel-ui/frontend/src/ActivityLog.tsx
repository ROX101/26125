import { LogEntry } from './api';

interface Props {
  entries: LogEntry[];
}

export default function ActivityLog({ entries }: Props) {
  if (entries.length === 0) {
    return <p className="dim">No actions attempted yet. Try one above.</p>;
  }
  return (
    <ul className="activity-log">
      {entries.map((e, i) => (
        <li key={i} className={e.ok ? 'log-entry log-ok' : 'log-entry log-denied'}>
          <span className="log-role">{e.role}</span>
          <span className="mono log-message">{e.message}</span>
        </li>
      ))}
    </ul>
  );
}
