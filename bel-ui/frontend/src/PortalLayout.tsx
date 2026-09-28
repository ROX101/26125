import { CSSProperties, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { ConfigResponse, fetchConfig, RoleConfig, RoleName } from './api';
import { clearActiveRole, getActiveRole, ROLE_ACCENT } from './session';
import { NAV_CONFIG, PORTAL_TITLE } from './navConfig';
import Icon from './components/Icon';
import belLogo from './assets/bel-logo.png';

export interface PortalContext {
  role: RoleName;
  roleConfig: RoleConfig;
  permissionCatalog: string[];
}

export default function PortalLayout({ role }: { role: RoleName }) {
  const active = getActiveRole();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchConfig().then(setConfig).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (!active) return <Navigate to="/login" replace />;
  if (active !== role) return <Navigate to="/login" replace />;

  function switchIdentity() {
    clearActiveRole();
    navigate('/login');
  }

  if (error) {
    return (
      <div className="app-error">
        <p>Could not reach the backend API.</p>
        <p className="mono dim">{error}</p>
        <p className="dim">Make sure the backend is running (npm start in bel-ui/backend).</p>
      </div>
    );
  }
  if (!config) return <div className="app-loading">Connecting…</div>;

  const roleConfig = config.roles[role];
  const nav = NAV_CONFIG[role];
  const accent = ROLE_ACCENT[role];

  return (
    <div className="portal-shell" style={{ '--role-accent': accent } as CSSProperties}>
      <nav className="portal-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo-chip">
            <img src={belLogo} alt="Bharat Electronics Limited" />
          </div>
          <div>
            <span className="sidebar-brand-main">{PORTAL_TITLE[role]}</span>
            <br />
            <span className="sidebar-brand-sub">{roleConfig.orgUnit}</span>
          </div>
        </div>
        <ul className="sidebar-nav">
          {nav.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link')}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <button className="sidebar-link sidebar-switch" onClick={switchIdentity}>
          <Icon name="logout" />
          <span>Switch identity</span>
        </button>
      </nav>

      <div className="portal-main">
        <header className="portal-topbar">
          <div>
            <h1>{roleConfig.displayName}</h1>
            <p className="dim">{roleConfig.description}</p>
          </div>
          <div className="topbar-identity">
            <span className="mono">{roleConfig.did}</span>
            <span className="dim">{roleConfig.orgScope === '*' ? 'All units' : roleConfig.orgScope}</span>
          </div>
        </header>
        <main className="portal-content">
          <Outlet context={{ role, roleConfig, permissionCatalog: config.permissionCatalog } satisfies PortalContext} />
        </main>
      </div>
    </div>
  );
}
