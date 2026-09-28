export type IconName =
  | 'dashboard' | 'directory' | 'verify' | 'mint' | 'asset' | 'roles'
  | 'audit' | 'network' | 'approve' | 'team' | 'upload' | 'delegation'
  | 'activity' | 'logout' | 'check' | 'cross' | 'download' | 'view';

const PATHS: Record<IconName, string> = {
  dashboard: 'M4 4h7v7H4V4zm9 0h7v4h-7V4zm0 7h7v9h-7v-9zM4 14h7v6H4v-6z',
  directory: 'M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z',
  verify: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3zM9 12l2 2 4-4',
  mint: 'M12 2l3 6 6 1-4.5 4.5L17.5 20 12 17l-5.5 3L7.5 13.5 3 9l6-1 3-6z',
  asset: 'M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 7v10l8 4 8-4V7',
  roles: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0',
  audit: 'M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 12h6M9 16h6M9 8h2',
  network: 'M12 3v4M12 17v4M4 12h4M16 12h4M6 6l2.5 2.5M17.5 15.5 20 18M18 6l-2.5 2.5M8.5 15.5 6 18M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  approve: 'M20 6L9 17l-5-5',
  team: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M15 14a6 6 0 0 1 7 6',
  upload: 'M12 16V4m0 0L7 9m5-5l5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  delegation: 'M17 8l4 4-4 4M3 12h18M7 4L3 8l4 4',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  check: 'M20 6L9 17l-5-5',
  cross: 'M18 6L6 18M6 6l12 12',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  view: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
