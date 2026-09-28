import { IconName } from './components/Icon';
import { RoleName } from './api';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

export const NAV_CONFIG: Record<RoleName, NavItem[]> = {
  ADMIN: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'directory', label: 'Directory', icon: 'directory' },
    { to: 'verification', label: 'Verification', icon: 'verify' },
    { to: 'mint-queue', label: 'Mint Queue', icon: 'mint' },
    { to: 'assets', label: 'Asset Registry', icon: 'asset' },
    { to: 'roles', label: 'Roles & Policies', icon: 'roles' },
    { to: 'audit', label: 'Audit Trail', icon: 'audit' },
    { to: 'network', label: 'Network', icon: 'network' },
  ],
  MANAGER: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'approvals', label: 'Approval Queue', icon: 'approve' },
    { to: 'assets', label: 'Assets', icon: 'asset' },
    { to: 'team', label: 'Team Members', icon: 'team' },
    { to: 'audit', label: 'Audit Log', icon: 'audit' },
  ],
  AUDITOR: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'audit-events', label: 'Audit Events', icon: 'audit' },
    { to: 'asset-history', label: 'Asset History', icon: 'asset' },
    { to: 'identity-history', label: 'Identity History', icon: 'directory' },
  ],
  USER: [
    { to: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: 'my-assets', label: 'My Assets', icon: 'asset' },
    { to: 'upload', label: 'Upload', icon: 'upload' },
    { to: 'delegations', label: 'Delegation Requests', icon: 'delegation' },
    { to: 'activity', label: 'Recent Activity', icon: 'activity' },
  ],
};

export const PORTAL_TITLE: Record<RoleName, string> = {
  ADMIN: 'BEL Admin',
  MANAGER: 'BEL Manager Portal',
  AUDITOR: 'BEL Auditor',
  USER: 'BEL User Portal',
};
