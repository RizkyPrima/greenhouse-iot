'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';
import { RoleBadge, GreenhouseStatusBadge } from '@/components/common/status-badge';
import { UserRole, OrganizationMember, Greenhouse } from '@/types';
import {
  Settings as SettingsIcon,
  User as UserIcon,
  Building2,
  Users,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Warehouse,
  Check,
  AlertCircle,
  Copy,
  Search,
  CheckCircle2,
  Globe,
  Sliders,
  ChevronDown,
} from 'lucide-react';

type TabType = 'members' | 'facilities' | 'organization' | 'permissions';

export default function SettingsPage() {
  const { user, currentOrg, currentRole, organizations, setCurrentOrgId, hasRole, refreshUser } = useAuth();

  const isOwner = hasRole('OWNER');
  const isAdminOrOwner = hasRole('OWNER', 'ADMIN');

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<TabType>('members');

  // Members list query
  const {
    data: members = [],
    isLoading: isLoadingMembers,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: ['org-members', currentOrg?.id],
    queryFn: () => (currentOrg ? apiClient.getOrganizationMembers(currentOrg.id) : Promise.resolve([])),
    enabled: !!currentOrg,
  });

  // Greenhouses list query
  const {
    data: greenhouses = [],
    isLoading: isLoadingGH,
    refetch: refetchGH,
  } = useQuery({
    queryKey: ['greenhouses', currentOrg?.id],
    queryFn: () => apiClient.getGreenhouses(currentOrg?.id),
    enabled: !!currentOrg,
  });

  // Filter & Search states
  const [memberSearch, setMemberSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  // Add Member State
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<UserRole>('VIEWER');
  const [isSubmittingMember, setIsSubmittingMember] = useState(false);
  const [memberActionStatus, setMemberActionStatus] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);

  // New Greenhouse State
  const [ghName, setGhName] = useState('');
  const [ghCode, setGhCode] = useState('');
  const [ghLocation, setGhLocation] = useState('');
  const [ghTimezone, setGhTimezone] = useState('Asia/Jakarta');
  const [isSubmittingGH, setIsSubmittingGH] = useState(false);
  const [ghStatus, setGhStatus] = useState<string | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);

  // Copy-to-clipboard state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !newMemberEmail.trim()) return;

    setMemberError(null);
    setMemberActionStatus(null);
    setIsSubmittingMember(true);
    try {
      await apiClient.addMember(currentOrg.id, {
        email: newMemberEmail.trim().toLowerCase(),
        role: newMemberRole,
      });
      setMemberActionStatus(`Successfully added ${newMemberEmail.trim()} as ${newMemberRole}.`);
      setNewMemberEmail('');
      setShowAddMemberModal(false);
      void refetchMembers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add member';
      setMemberError(msg);
    } finally {
      setIsSubmittingMember(false);
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
    if (!currentOrg || !ghName.trim() || !ghCode.trim()) return;

    setGhError(null);
    setGhStatus(null);
    setIsSubmittingGH(true);
    try {
      await apiClient.createGreenhouse({
        organizationId: currentOrg.id,
        name: ghName.trim(),
        code: ghCode.trim().toUpperCase(),
        location: ghLocation.trim() || undefined,
        timezone: ghTimezone || 'Asia/Jakarta',
      });
      setGhStatus(`Greenhouse facility "${ghName.trim()}" created successfully.`);
      setGhName('');
      setGhCode('');
      setGhLocation('');
      void refetchGH();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create greenhouse';
      setGhError(msg);
    } finally {
      setIsSubmittingGH(false);
    }
  };

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members.filter((m: OrganizationMember) => {
      const matchesSearch =
        (m.user?.name || '').toLowerCase().includes(memberSearch.toLowerCase()) ||
        (m.user?.email || '').toLowerCase().includes(memberSearch.toLowerCase());
      const matchesRole = roleFilter === 'ALL' || m.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [members, memberSearch, roleFilter]);

  // Breakdown of members by role
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {
      OWNER: 0,
      ADMIN: 0,
      OPERATOR: 0,
      VIEWER: 0,
    };
    members.forEach((m) => {
      if (counts[m.role] !== undefined) {
        counts[m.role]++;
      }
    });
    return counts;
  }, [members]);

  const tabs = [
    {
      id: 'members' as TabType,
      label: 'Team & Access Control',
      icon: Users,
      badge: members.length,
    },
    {
      id: 'facilities' as TabType,
      label: 'Greenhouse Facilities',
      icon: Warehouse,
      badge: greenhouses.length,
    },
    {
      id: 'organization' as TabType,
      label: 'Organization & Profile',
      icon: Building2,
    },
    {
      id: 'permissions' as TabType,
      label: 'RBAC Permissions Matrix',
      icon: ShieldCheck,
    },
  ];

  return (
    <DashboardLayout>
      <div className="w-full space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600/30 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/40">
                <SettingsIcon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  <span>Settings & Access Control</span>
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Enterprise organization governance, user profiles, facilities, and RBAC team permissions
                </p>
              </div>
            </div>
          </div>

          {/* Quick Context Chips */}
          <div className="flex items-center flex-wrap gap-2.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
              <span className="text-slate-400 font-mono text-[11px]">ORG:</span>
              <span className="font-semibold text-slate-200">{currentOrg?.name || 'No Org'}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
              <span className="text-slate-400 font-mono text-[11px]">ROLE:</span>
              {currentRole ? <RoleBadge role={currentRole} /> : <span className="text-slate-400">N/A</span>}
            </div>
          </div>
        </div>

        {/* Global Summary KPI Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">Active Org</span>
              <Building2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-base font-bold text-white truncate" title={currentOrg?.name}>
              {currentOrg?.name || '--'}
            </div>
            <div className="text-[11px] font-mono text-emerald-400/90 mt-1 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Slug: {currentOrg?.slug || 'default'}</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">Your Authority</span>
              <ShieldCheck className="h-4 w-4 text-purple-400" />
            </div>
            <div className="text-base font-bold text-white">
              {currentRole || 'UNKNOWN'}
            </div>
            <div className="text-[11px] font-mono text-purple-400/90 mt-1">
              {isOwner ? 'Full administrative control' : isAdminOrOwner ? 'Facility & device manager' : 'Telemetry operator access'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">Team Roster</span>
              <Users className="h-4 w-4 text-blue-400" />
            </div>
            <div className="text-base font-bold text-white flex items-baseline gap-2">
              <span>{members.length}</span>
              <span className="text-xs text-slate-400 font-normal">Registered Operators</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-1">
              {roleCounts.OWNER} Owner · {roleCounts.ADMIN} Admin · {roleCounts.OPERATOR} Op
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">Facilities</span>
              <Warehouse className="h-4 w-4 text-teal-400" />
            </div>
            <div className="text-base font-bold text-white flex items-baseline gap-2">
              <span>{greenhouses.length}</span>
              <span className="text-xs text-slate-400 font-normal">Active Units</span>
            </div>
            <div className="text-[11px] font-mono text-teal-400/90 mt-1">
              Smart IoT greenhouses monitored
            </div>
          </div>
        </div>

        {/* Tab Navigation Navigation Bar */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80 border border-transparent'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {typeof tab.badge !== 'undefined' && (
                  <span
                    className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full ${
                      isActive
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: MEMBERS & RBAC ACCESS */}
        {/* ========================================================================= */}
        {activeTab === 'members' && (
          <div className="space-y-6">
            {/* Feedback Notifications */}
            {memberActionStatus && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>{memberActionStatus}</span>
                </div>
                <button
                  onClick={() => setMemberActionStatus(null)}
                  className="text-emerald-400 hover:text-emerald-200 font-mono text-[11px]"
                >
                  Dismiss
                </button>
              </div>
            )}
            {memberError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2.5">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{memberError}</span>
                </div>
                <button
                  onClick={() => setMemberError(null)}
                  className="text-rose-400 hover:text-rose-200 font-mono text-[11px]"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Invite Member Section (Owner only) */}
            {isOwner && (
              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur-md">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      <UserPlus className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">Invite New Team Member</h3>
                      <p className="text-xs text-slate-400">
                        Grant role-based authorization to collaborate in {currentOrg?.name}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowAddMemberModal(!showAddMemberModal)}
                    className="px-3.5 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors self-start sm:self-auto cursor-pointer"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>{showAddMemberModal ? 'Collapse Form' : 'New Invitation'}</span>
                  </button>
                </div>

                {showAddMemberModal && (
                  <form onSubmit={handleAddMember} className="mt-4 p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4 text-xs animate-in fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-slate-300 mb-1.5 font-mono uppercase text-[11px]">
                          User Email Address
                        </label>
                        <input
                          type="email"
                          value={newMemberEmail}
                          onChange={(e) => setNewMemberEmail(e.target.value)}
                          placeholder="e.g. agronomist@greenhouse.com"
                          required
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 mb-1.5 font-mono uppercase text-[11px]">
                          Assign RBAC Role
                        </label>
                        <select
                          value={newMemberRole}
                          onChange={(e) => setNewMemberRole(e.target.value as UserRole)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-purple-500 font-mono text-xs"
                        >
                          <option value="VIEWER">VIEWER (Read-Only)</option>
                          <option value="OPERATOR">OPERATOR (Control Actuators)</option>
                          <option value="ADMIN">ADMIN (Manage Devices/Facilities)</option>
                          <option value="OWNER">OWNER (Full Co-Ownership)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                      <span className="text-[11px] text-slate-400">
                        The invited member will automatically receive access based on their assigned role.
                      </span>
                      <button
                        type="submit"
                        disabled={isSubmittingMember || !newMemberEmail.trim()}
                        className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        {isSubmittingMember ? (
                          <>
                            <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                            <span>Adding...</span>
                          </>
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Send Invitation</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Members Roster Table */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-800/80">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Users className="h-4 w-4 text-emerald-400" />
                    <span>Organization Members Roster</span>
                  </h2>
                  <span className="text-xs text-slate-400">
                    Active team operators and granted access privileges in this boundary
                  </span>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search name or email..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 w-48 sm:w-56"
                    />
                  </div>

                  <div className="relative">
                    <select
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value)}
                      className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300 text-xs font-mono focus:outline-none focus:border-emerald-500 pr-7 appearance-none cursor-pointer"
                    >
                      <option value="ALL">All Roles</option>
                      <option value="OWNER">Owner</option>
                      <option value="ADMIN">Admin</option>
                      <option value="OPERATOR">Operator</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <ChevronDown className="h-3 w-3 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </div>

              {isLoadingMembers ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-12 bg-slate-800/40 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                  <Users className="h-8 w-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-300 font-medium">No team members match your filter</p>
                  <p className="text-[11px] text-slate-500">
                    Try adjusting your search query or role filter above
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[700px]">
                    <thead>
                      <tr className="border-b border-slate-800/80 text-slate-400 font-mono text-[11px]">
                        <th className="pb-3 font-medium">MEMBER</th>
                        <th className="pb-3 font-medium">EMAIL</th>
                        <th className="pb-3 font-medium">CURRENT ROLE</th>
                        <th className="pb-3 font-medium">DATE JOINED</th>
                        {isOwner && <th className="pb-3 font-medium text-right">CHANGE ROLE</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filteredMembers.map((m: OrganizationMember) => {
                        const isSelf = user?.id === m.userId;
                        const initials = (m.user?.name || m.user?.email || '?')
                          .split(' ')
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase();

                        return (
                          <tr key={m.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-slate-800 border border-slate-700/60 flex items-center justify-center font-bold font-mono text-[11px] text-emerald-400 shrink-0">
                                  {initials}
                                </div>
                                <div>
                                  <div className="font-semibold text-slate-200 flex items-center gap-2">
                                    <span>{m.user?.name || 'Operator'}</span>
                                    {isSelf && (
                                      <span className="text-[9px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                                        YOU
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 font-mono">
                                    UID: {m.userId.slice(0, 8)}...
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 font-mono text-slate-300">
                              <div className="flex items-center gap-2">
                                <span>{m.user?.email}</span>
                                <button
                                  onClick={() => copyToClipboard(m.user?.email, `email-${m.id}`)}
                                  title="Copy email"
                                  className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                                >
                                  {copiedKey === `email-${m.id}` ? (
                                    <Check className="h-3 w-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3.5">
                              <RoleBadge role={m.role} />
                            </td>
                            <td className="py-3.5 font-mono text-slate-400">
                              {new Date(m.createdAt).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </td>
                            {isOwner && (
                              <td className="py-3.5 text-right">
                                {isSelf ? (
                                  <span className="text-[11px] font-mono text-slate-500 italic">
                                    Primary Owner
                                  </span>
                                ) : (
                                  <select
                                    value={m.role}
                                    onChange={(e) => void handleRoleChange(m.id, e.target.value)}
                                    className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-purple-500 cursor-pointer"
                                  >
                                    <option value="VIEWER">VIEWER</option>
                                    <option value="OPERATOR">OPERATOR</option>
                                    <option value="ADMIN">ADMIN</option>
                                    <option value="OWNER">OWNER</option>
                                  </select>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: GREENHOUSE FACILITIES */}
        {/* ========================================================================= */}
        {activeTab === 'facilities' && (
          <div className="space-y-6">
            {/* Feedback Notifications */}
            {ghStatus && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>{ghStatus}</span>
                </div>
                <button
                  onClick={() => setGhStatus(null)}
                  className="text-emerald-400 hover:text-emerald-200 font-mono text-[11px]"
                >
                  Dismiss
                </button>
              </div>
            )}
            {ghError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2.5">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{ghError}</span>
                </div>
                <button
                  onClick={() => setGhError(null)}
                  className="text-rose-400 hover:text-rose-200 font-mono text-[11px]"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Add Facility Section (Owner/Admin only) */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-md">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-800/80">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Warehouse className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Create Greenhouse Facility</h2>
                  <span className="text-xs text-slate-400">
                    Register a new physical production facility or smart greenhouse cluster
                  </span>
                </div>
              </div>

              {isAdminOrOwner ? (
                <form onSubmit={handleCreateGreenhouse} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-slate-300 mb-1.5 font-mono uppercase text-[11px]">
                        Facility Name *
                      </label>
                      <input
                        type="text"
                        value={ghName}
                        onChange={(e) => setGhName(e.target.value)}
                        placeholder="e.g. North Hydroponic Bay"
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1.5 font-mono uppercase text-[11px]">
                        Facility Code (Unique) *
                      </label>
                      <input
                        type="text"
                        value={ghCode}
                        onChange={(e) => setGhCode(e.target.value)}
                        placeholder="e.g. GH-BAY-03"
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1.5 font-mono uppercase text-[11px]">
                        Location (Optional)
                      </label>
                      <input
                        type="text"
                        value={ghLocation}
                        onChange={(e) => setGhLocation(e.target.value)}
                        placeholder="e.g. Building B, Roof Level"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 mb-1.5 font-mono uppercase text-[11px]">
                        Timezone
                      </label>
                      <select
                        value={ghTimezone}
                        onChange={(e) => setGhTimezone(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono text-xs"
                      >
                        <option value="Asia/Jakarta">Asia/Jakarta (WIB)</option>
                        <option value="Asia/Makassar">Asia/Makassar (WITA)</option>
                        <option value="Asia/Jayapura">Asia/Jayapura (WIT)</option>
                        <option value="UTC">UTC (Universal Time)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isSubmittingGH || !ghName.trim() || !ghCode.trim()}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      {isSubmittingGH ? (
                        <>
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                          <span>Creating Facility...</span>
                        </>
                      ) : (
                        <>
                          <Warehouse className="h-4 w-4" />
                          <span>Register Facility</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 text-xs text-slate-400 flex items-center gap-3">
                  <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0" />
                  <span>
                    Greenhouse facility creation requires <strong>OWNER</strong> or <strong>ADMIN</strong> permissions.
                    Your current role is <strong className="text-slate-200">{currentRole}</strong>.
                  </span>
                </div>
              )}
            </div>

            {/* Existing Facilities Roster */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-md">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800/80">
                <div>
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-emerald-400" />
                    <span>Registered Greenhouse Facilities ({greenhouses.length})</span>
                  </h2>
                  <span className="text-xs text-slate-400">
                    Existing greenhouse infrastructure under this organization
                  </span>
                </div>
              </div>

              {isLoadingGH ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-28 bg-slate-800/40 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : greenhouses.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                  <Warehouse className="h-8 w-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-300 font-medium">No greenhouses registered yet</p>
                  <p className="text-[11px] text-slate-500">
                    Use the form above to configure your first smart greenhouse facility.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {greenhouses.map((gh: Greenhouse) => (
                    <div
                      key={gh.id}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="font-semibold text-slate-100 text-sm group-hover:text-emerald-400 transition-colors">
                          {gh.name}
                        </div>
                        <GreenhouseStatusBadge status={gh.status} />
                      </div>
                      <div className="space-y-1.5 text-[11px] font-mono text-slate-400">
                        <div className="flex items-center justify-between">
                          <span>CODE:</span>
                          <span className="text-slate-200 font-semibold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
                            {gh.code}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>LOCATION:</span>
                          <span className="text-slate-300 truncate max-w-[150px]">{gh.location || 'Not Specified'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>TIMEZONE:</span>
                          <span className="text-slate-400">{gh.timezone || 'Asia/Jakarta'}</span>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-slate-900">
                          <span>FACILITY ID:</span>
                          <span className="text-slate-500 truncate max-w-[120px]">{gh.id.slice(0, 10)}...</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: ORGANIZATION & PROFILE */}
        {/* ========================================================================= */}
        {activeTab === 'organization' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* User Account Profile */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-md flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5 pb-3 border-b border-slate-800/80">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <UserIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Authenticated Operator Profile</h2>
                    <span className="text-xs text-slate-400">Active session credentials & identity</span>
                  </div>
                </div>

                <div className="space-y-3.5 text-xs font-mono">
                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">Operator Full Name</span>
                      <span className="text-slate-100 font-semibold text-sm font-sans">{user?.name || '--'}</span>
                    </div>
                    <div className="h-9 w-9 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
                      {(user?.name || 'U').charAt(0).toUpperCase()}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">Email Address</span>
                      <span className="text-slate-100 font-semibold">{user?.email || '--'}</span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(user?.email || '', 'user-email')}
                      className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors cursor-pointer"
                      title="Copy Email"
                    >
                      {copiedKey === 'user-email' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">Current Role in Active Org</span>
                      <div className="mt-1">
                        {currentRole ? <RoleBadge role={currentRole} /> : <span className="text-slate-400">N/A</span>}
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {isOwner ? 'Full Admin Rights' : 'Restricted Rights'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">User Account ID</span>
                      <span className="text-slate-400 text-[11px] truncate block max-w-[220px]">{user?.id || '--'}</span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(user?.id || '', 'user-id')}
                      className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors cursor-pointer"
                      title="Copy User ID"
                    >
                      {copiedKey === 'user-id' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Session Active</span>
                </span>
                <span className="font-mono text-[11px] text-slate-500">JWT Bearer Authenticated</span>
              </div>
            </div>

            {/* Organization Identity */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-md flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-5 pb-3 border-b border-slate-800/80">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">Organization Boundary & Metadata</h2>
                    <span className="text-xs text-slate-400">Multi-tenant boundary for telemetries & devices</span>
                  </div>
                </div>

                <div className="space-y-3.5 text-xs font-mono">
                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">Organization Name</span>
                      <span className="text-slate-100 font-semibold text-sm font-sans">{currentOrg?.name || '--'}</span>
                    </div>
                    {organizations.length > 1 && (
                      <div className="flex items-center gap-1">
                        <select
                          value={currentOrg?.id || ''}
                          onChange={(e) => setCurrentOrgId(e.target.value)}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-slate-200 cursor-pointer"
                        >
                          {organizations.map((org) => (
                            <option key={org.id} value={org.id}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">Slug Identifier</span>
                      <span className="text-slate-100 font-semibold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px]">
                        {currentOrg?.slug || '--'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">Used in API routes</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">Organization UUID</span>
                      <span className="text-slate-400 text-[11px] truncate block max-w-[220px]">
                        {currentOrg?.id || '--'}
                      </span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(currentOrg?.id || '', 'org-id')}
                      className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors cursor-pointer"
                      title="Copy Organization ID"
                    >
                      {copiedKey === 'org-id' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase">Organization Description</span>
                      <span className="text-slate-300 font-sans text-xs">
                        {currentOrg?.description || 'Standard IoT greenhouse monitoring environment.'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Isolation: Tenant Scope</span>
                </span>
                <span className="font-mono text-[11px] text-slate-500">PostgreSQL Schema RBAC</span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: RBAC PERMISSIONS MATRIX */}
        {/* ========================================================================= */}
        {activeTab === 'permissions' && (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Role-Based Access Control (RBAC) Permissions Matrix</span>
                </h2>
                <span className="text-xs text-slate-400">
                  Comprehensive breakdown of platform capabilities and privilege boundaries
                </span>
              </div>
              <div className="text-xs font-mono text-slate-400">
                Current Role: <RoleBadge role={currentRole || 'VIEWER'} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[650px]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                    <th className="pb-3 font-medium">CAPABILITY / OPERATION</th>
                    <th className="pb-3 font-medium text-center">OWNER</th>
                    <th className="pb-3 font-medium text-center">ADMIN</th>
                    <th className="pb-3 font-medium text-center">OPERATOR</th>
                    <th className="pb-3 font-medium text-center">VIEWER</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-medium">
                      <div>Manage Organization & Settings</div>
                      <div className="text-[11px] text-slate-500 font-normal">Change org metadata, delete organization</div>
                    </td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-medium">
                      <div>Invite Members & Modify Roles</div>
                      <div className="text-[11px] text-slate-500 font-normal">Grant and revoke team RBAC memberships</div>
                    </td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-medium">
                      <div>Create & Configure Greenhouse Facilities</div>
                      <div className="text-[11px] text-slate-500 font-normal">Add greenhouses, zones, and floor plans</div>
                    </td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-medium">
                      <div>Register & Provision IoT Edge Devices</div>
                      <div className="text-[11px] text-slate-500 font-normal">Provision ESP32 microcontrollers, MQTT credentials</div>
                    </td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-medium">
                      <div>Control Actuators (Pumps, Fans, Valves)</div>
                      <div className="text-[11px] text-slate-500 font-normal">Send manual override and schedule commands</div>
                    </td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-slate-600">—</td>
                  </tr>
                  <tr className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 font-medium">
                      <div>Telemetry Monitoring & Historical Charts</div>
                      <div className="text-[11px] text-slate-500 font-normal">Inspect sensor feeds, alerts, and time-series</div>
                    </td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Full</td>
                    <td className="py-3 text-center text-emerald-400 font-bold">✓ Read</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
