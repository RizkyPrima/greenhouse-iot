'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Warehouse,
  Cpu,
  Activity,
  History,
  Settings,
  Leaf,
} from 'lucide-react';

const navigationItems = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Greenhouses', href: '/greenhouses', icon: Warehouse },
  { name: 'Devices', href: '/devices', icon: Cpu },
  { name: 'Realtime Feed', href: '/realtime', icon: Activity, badge: 'LIVE' },
  { name: 'Historical Data', href: '/history', icon: History },
  { name: 'Settings & Access', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 flex-shrink-0 border-r border-slate-800/80 bg-slate-950 flex flex-col h-screen sticky top-0 z-30">
      {/* Brand Logo Header */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800/80 gap-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/50">
          <Leaf className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-sm font-bold tracking-tight text-white block">
            Greenhouse IoT
          </span>
          <span className="text-[10px] font-mono text-emerald-400 tracking-wider uppercase block">
            Phase 7 System
          </span>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
          Platform Menu
        </div>
        {navigationItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all group ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`h-4 w-4 transition-colors ${
                    isActive ? 'text-emerald-400' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Bottom Info Banner */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/60 text-[11px] text-slate-400">
        <div className="flex items-center justify-between font-mono">
          <span>Engine Status</span>
          <span className="text-emerald-400">NORMAL</span>
        </div>
        <div className="text-[10px] text-slate-400 mt-1 font-mono">
          EMQX · NestJS · Redis · PG
        </div>
      </div>
    </aside>
  );
}
