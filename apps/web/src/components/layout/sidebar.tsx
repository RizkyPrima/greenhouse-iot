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
  Sprout,
  Layers,
  X,
} from 'lucide-react';

const navigationItems = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Greenhouses', href: '/greenhouses', icon: Warehouse },
  { name: 'Devices', href: '/devices', icon: Cpu },
  { name: 'Realtime Feed', href: '/realtime', icon: Activity, badge: 'LIVE' },
  { name: 'Historical Data', href: '/history', icon: History },
  { name: 'Plant Catalog', href: '/plant-catalog', icon: Leaf },
  { name: 'Plant Profiles', href: '/plant-profiles', icon: Sprout },
  { name: 'Zone Plant Setup', href: '/plant-assignments', icon: Layers },
  { name: 'Settings & Access', href: '/settings', icon: Settings },
];

export function Sidebar({ isOpen = false, onClose = () => {} }: { isOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {isOpen && <button type="button" aria-label="Tutup menu" onClick={onClose} className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm md:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-shrink-0 flex-col border-r border-slate-800/80 bg-slate-950 transition-transform duration-200 md:sticky md:top-0 md:z-30 md:w-64 md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
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
        <button type="button" aria-label="Tutup menu" onClick={onClose} className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-900 md:hidden">
          <X className="h-5 w-5" />
        </button>
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
              onClick={onClose}
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
      <div className="py-3 px-4 pl-12 border-t border-slate-800/80 bg-slate-950/60 text-[11px] text-slate-400">
        <div className="flex items-center justify-between font-mono">
          <span>Engine Status</span>
          <span className="text-emerald-400">NORMAL</span>
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
          EMQX · NestJS · Redis · PG
        </div>
      </div>
    </aside>
    </>
  );
}
