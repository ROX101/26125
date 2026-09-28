import { ConfigResponse, RoleName } from './api';

interface Props {
  roles: RoleName[];
  config: ConfigResponse;
  activeRole: RoleName;
  onSelect: (role: RoleName) => void;
}

export default function IdentityRail({ roles, config, activeRole, onSelect }: Props) {
  return (
    <nav className="identity-rail">
      <div className="rail-title">
        <span className="rail-title-main">BEL Identity Console</span>
        <span className="rail-title-sub">Four real Fabric identities, one ledger</span>
      </div>
      <ul>
        {roles.map((role) => {
          const info = config.roles[role];
          const active = role === activeRole;
          return (
            <li key={role}>
              <button
                className={active ? 'identity-item identity-item-active' : 'identity-item'}
                onClick={() => onSelect(role)}
              >
                <span className="identity-name">{info.displayName}</span>
                <span className="identity-did mono">{info.did.replace('did:fabric:', '')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
