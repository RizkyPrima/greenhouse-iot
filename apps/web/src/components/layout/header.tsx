'use client';

import React from 'react';
import { useAuth } from '@/context/auth-context';
import { useSocket } from '@/context/socket-context';
import { ConnectionBadge, RoleBadge } from '@/components/common/status-badge';
import { Building2, LogOut, ChevronDown, Moon, Sun, Menu } from 'lucide-react';
import { useTheme } from '@/context/theme-context';

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user, currentOrg, currentRole, organizations, setCurrentOrgId, logout } = useAuth();
  const { status } = useSocket();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <header className="min-h-16 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-3 sm:px-6 py-2 flex items-center justify-between gap-2 sticky top-0 z-20">
      {/* Left: Organization context */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <button type="button" aria-label="Buka menu navigasi" onClick={onMenuClick} className="shrink-0 rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-900 md:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 sm:px-3">
          <Building2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              Organization
            </span>
            {organizations.length > 1 ? (
              <div className="relative inline-flex max-w-full items-center">
                <select
                  value={currentOrg?.id || ''}
                  onChange={(e) => setCurrentOrgId(e.target.value)}
                  className="max-w-[34vw] truncate bg-transparent pr-5 text-xs font-semibold text-slate-100 appearance-none focus:outline-none cursor-pointer sm:max-w-[28vw] md:max-w-[320px]"
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
              <span className="max-w-[34vw] truncate text-xs font-semibold text-slate-100 sm:max-w-[28vw] md:max-w-[320px]">
                {currentOrg?.name || 'No Organization'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Realtime status, User profile, Logout */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-1.5 sm:gap-2" title={theme === 'system' ? 'Tema mengikuti pengaturan perangkat; klik untuk memilih mode manual.' : 'Klik untuk mengganti mode terang/gelap.'}>
          <Sun aria-hidden="true" className={`hidden h-4 w-4 sm:block ${!isDark ? 'text-amber-500' : 'text-slate-500'}`} />
          <button
            type="button"
            role="switch"
            aria-label={`Tema ${isDark ? 'gelap' : 'terang'}; klik untuk mengganti tema`}
            aria-checked={isDark}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={`theme-switch relative inline-flex h-8 w-[58px] shrink-0 items-center rounded-full border border-slate-600 px-1 shadow-inner transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${isDark ? 'bg-slate-800' : 'bg-slate-300'}`}
          >
            <span className="sr-only">Ubah tema tampilan</span>
            <span
              aria-hidden="true"
              className={`theme-switch-knob absolute left-1 h-6 w-6 rounded-full bg-white shadow-md ring-1 ring-slate-400/70 transition-transform duration-200 ${isDark ? 'translate-x-[26px]' : 'translate-x-0'}`}
            />
          </button>
          <Moon aria-hidden="true" className={`hidden h-4 w-4 sm:block ${isDark ? 'text-indigo-400' : 'text-slate-500'}`} />
        </div>

        {/* Realtime WebSocket status */}
        <div className="hidden sm:block">
          <ConnectionBadge status={status} labelPrefix="WS" />
        </div>

        {/* User Info & Role */}
        {user && (
          <div className="flex items-center gap-2 border-l border-slate-800/80 pl-2 sm:gap-3 sm:pl-4">
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
