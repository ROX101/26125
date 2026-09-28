import { RoleName } from './api';

const KEY = 'bel.activeRole';

// Which identity the UI is currently acting as. There's no password login -
// each role IS a real, distinct Fabric identity (see identities.json) - this
// just remembers which one the browser tab is currently using, the same way
// a real SSO session cookie would, so a refresh doesn't drop you back to the
// role picker.
export function getActiveRole(): RoleName | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'ADMIN' || v === 'MANAGER' || v === 'AUDITOR' || v === 'USER' ? v : null;
  } catch {
    return null;
  }
}

export function setActiveRole(role: RoleName): void {
  try {
    window.localStorage.setItem(KEY, role);
  } catch {
    /* ignore */
  }
}

export function clearActiveRole(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const ROLE_HOME: Record<RoleName, string> = {
  ADMIN: '/admin/dashboard',
  MANAGER: '/manager/dashboard',
  AUDITOR: '/auditor/dashboard',
  USER: '/user/dashboard',
};

// Harmonized with the BEL brand blue (#00adef / navy #0a2e4d) - each role
// gets a distinguishable but related hue rather than a clashing rainbow.
export const ROLE_ACCENT: Record<RoleName, string> = {
  ADMIN: '#0a2e4d',
  MANAGER: '#0f8a7a',
  AUDITOR: '#5b5fc7',
  USER: '#00adef',
};
