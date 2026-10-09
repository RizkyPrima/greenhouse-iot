'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { RoleBadge } from '@/components/common/status-badge';
import { UserRole, OrganizationMember } from '@/types';
import {
  Settings as SettingsIcon,
  User as UserIcon,
  Building2,
  Users,
  ShieldAlert,
  UserPlus,
  Warehouse,
  Check,
  AlertCircle,
} from 'lucide-react';

export default function SettingsPage() {
  const { user, currentOrg, currentRole, hasRole, refreshUser } = useAuth();

  const isOwner = hasRole('OWNER');
  const isAdminOrOwner = hasRole('OWNER', 'ADMIN');

  // Members list for the current organization
  const {
    data: members = [],
    isLoading: isLoadingMembers,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: ['org-members', currentOrg?.id],
    queryFn: () => (currentOrg ? apiClient.getOrganizationMembers(currentOrg.id) : Promise.resolve([])),
    enabled: !!currentOrg,
  });

  // Greenhouses list
  const { data: greenhouses = [], refetch: refetchGH } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(currentOrg?.id),
  });

  // Add Member State
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<UserRole>('VIEWER');
  const [memberActionStatus, setMemberActionStatus] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);

  // New Greenhouse State
  const [ghName, setGhName] = useState('');
  const [ghCode, setGhCode] = useState('');
  const [ghLocation, setGhLocation] = useState('');
  const [ghStatus, setGhStatus] = useState<string | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !newMemberEmail) return;

    setMemberError(null);
    setMemberActionStatus(null);
    try {
      await apiClient.addMember(currentOrg.id, {
        email: newMemberEmail.trim(),
        role: newMemberRole,
      });
      setMemberActionStatus('Member added successfully.');
      setNewMemberEmail('');
      void refetchMembers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add member';
      setMemberError(msg);
    }
  };

  const handleRoleChange = async (membershipId: string, role: string) => {
    if (!currentOrg || !isOwner) return;
    setMemberError(null);
    setMemberActionStatus(null);
    try {
      await apiClient.updateMemberRole(currentOrg.id, membershipId, role);
      setMemberActionStatus('Member role updated successfully.');
      void refetchMembers();
      void refreshUser();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update member role';
      setMemberError(msg);
    }
  };

  const handleCreateGreenhouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !ghName || !ghCode) return;

    setGhError(null);
    setGhStatus(null);
    try {
      await apiClient.createGreenhouse({
        organizationId: currentOrg.id,
        name: ghName.trim(),
        code: ghCode.trim().toUpperCase(),
        location: ghLocation.trim() || undefined,
        timezone: 'UTC',
      });
      setGhStatus('Greenhouse facility created successfully.');
      setGhName('');
      setGhCode('');
      setGhLocation('');
      void refetchGH();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create greenhouse';
      setGhError(msg);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-5xl">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-emerald-400" />
            <span>Settings & Access Control</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage your user account profile, organization parameters, facilities, and team access permissions
          </p>
        </div>

        {/* Section 1: User Profile Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-800/80">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <UserIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">User Profile Details</h2>
              <span className="text-xs text-slate-400">Authenticated operator account</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">FULL NAME</span>
              <span className="text-slate-100 font-semibold">{user?.name || '--'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">EMAIL ADDRESS</span>
              <span className="text-slate-100 font-semibold">{user?.email || '--'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">ASSIGNED ROLE</span>
              <div className="mt-0.5">
                {currentRole ? <RoleBadge role={currentRole} /> : <span className="text-slate-400">N/A</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Organization Profile */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-800/80">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Organization Identity</h2>
              <span className="text-xs text-slate-400">Enterprise boundary & metadata</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">ORGANIZATION NAME</span>
              <span className="text-slate-100 font-semibold">{currentOrg?.name || '--'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">SLUG IDENTIFIER</span>
              <span className="text-slate-100 font-semibold">{currentOrg?.slug || '--'}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">ORGANIZATION ID</span>
              <span className="text-slate-400 truncate block">{currentOrg?.id || '--'}</span>
            </div>
          </div>
        </div>

        {/* Section 3: Facilities / Greenhouse Configuration (Owner/Admin) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-800/80">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Greenhouse Facility Configuration</h2>
              <span className="text-xs text-slate-400">
                Register new smart greenhouse units (Requires OWNER or ADMIN)
              </span>
            </div>
          </div>

          {isAdminOrOwner ? (
            <form onSubmit={handleCreateGreenhouse} className="space-y-4 text-xs">
              {ghStatus && (
                <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  <span>{ghStatus}</span>
                </div>
              )}
              {ghError && (
                <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>{ghError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-mono uppercase">Facility Name</label>
                  <input
                    type="text"
                    value={ghName}
                    onChange={(e) => setGhName(e.target.value)}
                    placeholder="North Wing High-Tech Bay"
                    required
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1 font-mono uppercase">Code (Unique)</label>
                  <input
                    type="text"
                    value={ghCode}
                    onChange={(e) => setGhCode(e.target.value)}
                    placeholder="GH-BAY-03"
                    required
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1 font-mono uppercase">Location (Optional)</label>
                  <input
                    type="text"
                    value={ghLocation}
                    onChange={(e) => setGhLocation(e.target.value)}
                    placeholder="Building B, Roof"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
              >
                Create Greenhouse Facility
              </button>
            </form>
          ) : (
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 text-xs text-slate-400 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <span>
                Greenhouse configuration is restricted to organization Owners and Administrators. Your current role is{' '}
                <strong>{currentRole ?? 'not yet assigned'}</strong>.
              </span>
            </div>
          )}
        </div>

        {/* Section 4: Members & Roles Management */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-800/80">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Organization Members & RBAC Roles</h2>
              <span className="text-xs text-slate-400">
                {isOwner
                  ? 'Manage team members and grant roles'
                  : 'Active organization membership roster'}
              </span>
            </div>
          </div>

          {/* Add Member Form (OWNER only) */}
          {isOwner ? (
            <form onSubmit={handleAddMember} className="mb-6 p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3 text-xs">
              <span className="text-[11px] font-mono text-emerald-400 uppercase font-semibold flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                <span>Invite New Organization Member</span>
              </span>

              {memberActionStatus && (
                <div className="p-2.5 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 flex items-center gap-2">
                  <Check className="h-3.5 w-3.5" />
                  <span>{memberActionStatus}</span>
                </div>
              )}
              {memberError && (
                <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-rose-300 flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{memberError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  placeholder="collaborator@example.com"
                  required
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as UserRole)}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                >
                  <option value="VIEWER">VIEWER</option>
                  <option value="OPERATOR">OPERATOR</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="OWNER">OWNER</option>
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
                >
                  Add Member
                </button>
              </div>
            </form>
          ) : (
            <div className="mb-4 p-3 rounded-xl border border-slate-800 bg-slate-950/40 text-xs text-slate-400 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-slate-500" />
              <span>
                Role modifications and member invitation are strictly restricted to organization Owners.
              </span>
            </div>
          )}

          {/* Members Table */}
          {isLoadingMembers ? (
            <div className="space-y-2 mt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-800/40 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
              {currentOrg ? 'No members found in this organization.' : 'Select an organization to view members.'}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="pb-3 font-medium">NAME</th>
                  <th className="pb-3 font-medium">EMAIL</th>
                  <th className="pb-3 font-medium">ROLE</th>
                  <th className="pb-3 font-medium">JOINED</th>
                  {isOwner && <th className="pb-3 font-medium text-right">CHANGE ROLE</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {members.map((m: OrganizationMember) => (
                  <tr key={m.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-medium text-slate-200">{m.user?.name || '--'}</td>
                    <td className="py-3 font-mono text-slate-400">{m.user?.email}</td>
                    <td className="py-3">
                      <RoleBadge role={m.role} />
                    </td>
                    <td className="py-3 font-mono text-slate-400">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>
                    {isOwner && (
                      <td className="py-3 text-right">
                        <select
                          value={m.role}
                          onChange={(e) => void handleRoleChange(m.id, e.target.value)}
                          className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 font-mono text-[11px] focus:outline-none focus:border-purple-500"
                        >
                          <option value="VIEWER">VIEWER</option>
                          <option value="OPERATOR">OPERATOR</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="OWNER">OWNER</option>
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
