import { useState } from 'react';
import { ActionResult } from './api';

const ACTIONS = [
  { key: 'requestOnboarding', label: 'Request onboarding', description: 'File a PENDING onboarding request for a new identity' },
  { key: 'activateIdentity', label: 'Activate identity', description: 'Activate the sandbox identity (PENDING/SUSPENDED -> ACTIVE)' },
  { key: 'suspendIdentity', label: 'Suspend identity', description: 'Temporarily suspend the sandbox identity' },
  { key: 'deactivateIdentity', label: 'Deactivate identity', description: 'Permanently deactivate the sandbox identity' },
  { key: 'defineRole', label: 'Define a role', description: 'Re-define the User role' },
  { key: 'grantRole', label: 'Grant a role', description: 'Grant User to the sandbox identity' },
  { key: 'revokeRole', label: 'Revoke a role', description: 'Remove that grant again' },
];

interface Props {
  onAction: (key: string) => Promise<ActionResult>;
}

export default function ActionPanel({ onAction }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ key: string; result: ActionResult } | null>(null);

  async function handleClick(key: string) {
    setPending(key);
    setLastResult(null);
    const result = await onAction(key);
    setLastResult({ key, result });
    setPending(null);
  }

  return (
    <div>
      <div className="action-buttons">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            className="action-button"
            disabled={pending !== null}
            onClick={() => handleClick(a.key)}
          >
            <span>{a.label}</span>
            <span className="action-description">{a.description}</span>
          </button>
        ))}
      </div>
      {lastResult && (
        <div className={lastResult.result.ok ? 'result-banner result-ok' : 'result-banner result-denied'}>
          {lastResult.result.ok ? lastResult.result.message : lastResult.result.error}
        </div>
      )}
    </div>
  );
}
