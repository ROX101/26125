interface Props {
  catalog: string[];
  permissions: Record<string, boolean>;
  loading: boolean;
}

export default function PermissionGrid({ catalog, permissions, loading }: Props) {
  return (
    <div className="permission-grid">
      {catalog.map((perm) => {
        const granted = permissions[perm];
        return (
          <div key={perm} className="permission-item">
            <span className={granted ? 'signal signal-on' : 'signal signal-off'} />
            <span className="mono permission-label">{perm}</span>
          </div>
        );
      })}
      {loading && <p className="dim">Checking…</p>}
    </div>
  );
}
