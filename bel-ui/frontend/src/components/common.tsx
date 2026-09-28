import { ReactNode, useCallback, useEffect, useState } from 'react';

// ---- Async data loading -----------------------------------------------------

export function useLoader<T>(loadFn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    loadFn()
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

export function AsyncSection({ loading, error, empty, emptyLabel, children }: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  emptyLabel?: string;
  children: ReactNode;
}) {
  if (loading) return <div className="state-msg dim">Loading…</div>;
  if (error) return <div className="state-msg error-msg">{error}</div>;
  if (empty) return <div className="state-msg dim">{emptyLabel || 'Nothing here yet.'}</div>;
  return <>{children}</>;
}

// ---- Layout primitives -------------------------------------------------------

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}

export function Card({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-title">{title}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint dim">{hint}</span>}
    </div>
  );
}

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel-section">
      {title && (
        <div className="section-header">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ---- Table --------------------------------------------------------------------

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  mono?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.mono ? 'mono' : undefined}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Status pills ---------------------------------------------------------------

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'pill-good',
  APPROVED: 'pill-good',
  SUCCESS: 'pill-good',
  PENDING: 'pill-wait',
  PENDING_APPROVAL: 'pill-wait',
  PENDING_MINT: 'pill-wait',
  SUSPENDED: 'pill-warn',
  REJECTED: 'pill-bad',
  DEACTIVATED: 'pill-bad',
  FAILURE: 'pill-bad',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_CLASS[status] || 'pill-wait'}`}>{status.replace(/_/g, ' ')}</span>;
}

// ---- Buttons + forms --------------------------------------------------------------

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button' }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function InlineNotice({ ok, message }: { ok: boolean; message: string }) {
  return <div className={ok ? 'notice notice-ok' : 'notice notice-bad'}>{message}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
