'use client';

import React from 'react';
import { useAuth } from '@/context/auth-context';
import { useSocket } from '@/context/socket-context';
import { ConnectionBadge, RoleBadge } from '@/components/common/status-badge';
import { Building2, LogOut, ChevronDown } from 'lucide-react';

export function Header() {
  const { user, currentOrg, currentRole, organizations, setCurrentOrgId, logout } = useAuth();
  const { status } = useSocket();

  return (
    <header className="h-16 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Left: Organization context */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60">
          <Building2 className="h-4 w-4 text-emerald-400" />
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              Organization
            </span>
            {organizations.length > 1 ? (
              <div className="relative inline-flex items-center">
                <select
                  value={currentOrg?.id || ''}
                  onChange={(e) => setCurrentOrgId(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-100 pr-5 appearance-none focus:outline-none cursor-pointer"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id} className="bg-slate-900 text-slate-100">
                      {org.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="h-3 w-3 text-slate-400 absolute right-0 pointer-events-none" />
              </div>
            ) : (
              <span className="text-xs font-semibold text-slate-100">
                {currentOrg?.name || 'No Organization'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Realtime status, User profile, Logout */}
      <div className="flex items-center gap-4">
        {/* Realtime WebSocket status */}
        <div className="hidden sm:block">
          <ConnectionBadge status={status} />
        </div>

        {/* User Info & Role */}
        {user && (
          <div className="flex items-center gap-3 border-l border-slate-800/80 pl-4">
            <div className="text-right hidden md:block">
              <span className="text-xs font-semibold text-slate-200 block">
                {user.name}
              </span>
              <span className="text-[11px] text-slate-400 font-mono block">
                {user.email}
              </span>
            </div>
            {currentRole && <RoleBadge role={currentRole} />}

            <button
              onClick={() => void logout()}
              title="Logout"
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 border border-slate-800 hover:border-rose-800/40 transition-colors ml-1"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
