import { CSSProperties, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfigResponse, fetchConfig, login, RoleName } from './api';
import { ROLE_ACCENT, ROLE_HOME, setActiveRole } from './session';
import belLogo from './assets/bel-logo.png';

const ROLE_ORDER: RoleName[] = ['ADMIN', 'MANAGER', 'AUDITOR', 'USER'];

const FEATURES = [
  'DID Registry with a 4-state identity lifecycle',
  'RBAC Engine enforced on every state-changing call',
  'Asset Registry backed by on-chain SHA-256 hashes',
  'Explicit, immutable on-chain audit trail',
];

export default function Login() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState<RoleName | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchConfig().then(setConfig).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function enter(role: RoleName) {
    setEntering(role);
    try {
      await login(role);
      setActiveRole(role);
      navigate(ROLE_HOME[role]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntering(null);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        <div className="login-logo-chip">
          <img src={belLogo} alt="Bharat Electronics Limited" />
        </div>

        <div className="login-hero-copy">
          <span className="login-hero-eyebrow">SIH26125 · BEL</span>
          <h1 className="login-hero-title">Identity &amp; Asset Console</h1>
          <p className="login-hero-sub">
            A single console over a live Hyperledger Fabric ledger — decentralized identities, role-based access
            control, and an on-chain asset registry, all enforced by chaincode rather than application code.
          </p>
        </div>

        <div className="login-hero-features">
          {FEATURES.map((f) => (
            <div className="login-hero-feature" key={f}>
              <span className="dot" />
              {f}
            </div>
          ))}
        </div>

        <span className="login-hero-foot">Channel: belchannel · Chaincode: belid</span>
      </div>

      <div className="login-panel">
        <div className="login-panel-inner">
          <div className="login-panel-heading">
            <h1>Choose your identity</h1>
            <p>Each card is a real, distinct Fabric identity — entering logs an on-chain AUTHENTICATE event.</p>
          </div>

          {error && <div className="notice notice-bad login-error">{error}</div>}

          {!config ? (
            <div className="state-msg dim">Connecting to the backend…</div>
          ) : (
            <div className="login-grid">
              {ROLE_ORDER.map((role) => {
                const info = config.roles[role];
                return (
                  <button
                    key={role}
                    className="login-card"
                    style={{ '--role-accent': ROLE_ACCENT[role] } as CSSProperties}
                    onClick={() => enter(role)}
                    disabled={entering !== null}
                  >
                    <div className="login-card-top">
                      <span className="login-card-dot" />
                      <span className="login-card-role">{info.displayName}</span>
                    </div>
                    <span className="login-card-desc">{info.description}</span>
                    <span className="login-card-did mono dim">{info.did}</span>
                    <span className="login-card-cta">{entering === role ? 'Entering…' : 'Enter portal →'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
