import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './Login';
import PortalLayout from './PortalLayout';

import AdminDashboard from './pages/admin/Dashboard';
import Directory from './pages/admin/Directory';
import Verification from './pages/admin/Verification';
import MintQueue from './pages/admin/MintQueue';
import AdminAssetRegistry from './pages/admin/AssetRegistry';
import Roles from './pages/admin/Roles';
import AdminAuditTrail from './pages/admin/AuditTrail';
import Network from './pages/admin/Network';

import ManagerDashboard from './pages/manager/Dashboard';
import ApprovalQueue from './pages/manager/ApprovalQueue';
import ManagerAssets from './pages/manager/Assets';
import TeamMembers from './pages/manager/TeamMembers';
import ManagerAuditLog from './pages/manager/AuditLog';

import AuditorDashboard from './pages/auditor/Dashboard';
import AuditEvents from './pages/auditor/AuditEvents';
import AssetHistory from './pages/auditor/AssetHistory';
import IdentityHistory from './pages/auditor/IdentityHistory';

import UserDashboard from './pages/user/Dashboard';
import MyAssets from './pages/user/MyAssets';
import Upload from './pages/user/Upload';
import Delegations from './pages/user/Delegations';
import RecentActivity from './pages/user/RecentActivity';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />

        <Route path="/admin" element={<PortalLayout role="ADMIN" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="directory" element={<Directory />} />
          <Route path="verification" element={<Verification />} />
          <Route path="mint-queue" element={<MintQueue />} />
          <Route path="assets" element={<AdminAssetRegistry />} />
          <Route path="roles" element={<Roles />} />
          <Route path="audit" element={<AdminAuditTrail />} />
          <Route path="network" element={<Network />} />
        </Route>

        <Route path="/manager" element={<PortalLayout role="MANAGER" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<ManagerDashboard />} />
          <Route path="approvals" element={<ApprovalQueue />} />
          <Route path="assets" element={<ManagerAssets />} />
          <Route path="team" element={<TeamMembers />} />
          <Route path="audit" element={<ManagerAuditLog />} />
        </Route>

        <Route path="/auditor" element={<PortalLayout role="AUDITOR" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AuditorDashboard />} />
          <Route path="audit-events" element={<AuditEvents />} />
          <Route path="asset-history" element={<AssetHistory />} />
          <Route path="identity-history" element={<IdentityHistory />} />
        </Route>

        <Route path="/user" element={<PortalLayout role="USER" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<UserDashboard />} />
          <Route path="my-assets" element={<MyAssets />} />
          <Route path="upload" element={<Upload />} />
          <Route path="delegations" element={<Delegations />} />
          <Route path="activity" element={<RecentActivity />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
