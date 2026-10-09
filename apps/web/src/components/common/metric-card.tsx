import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: LucideIcon;
  subtext?: string;
  color?: 'emerald' | 'cyan' | 'amber' | 'rose' | 'indigo' | 'slate';
  isLive?: boolean;
}

export function MetricCard({
  title,
  value,
  unit,
  icon: Icon,
  subtext,
  color = 'emerald',
  isLive = false,
}: MetricCardProps) {
  const colorStyles = {
    emerald: {
      border: 'border-emerald-500/20 hover:border-emerald-500/40',
      iconBg: 'bg-emerald-500/10 text-emerald-400',
      glow: 'shadow-emerald-950/20',
      text: 'text-emerald-400',
    },
    cyan: {
      border: 'border-cyan-500/20 hover:border-cyan-500/40',
      iconBg: 'bg-cyan-500/10 text-cyan-400',
      glow: 'shadow-cyan-950/20',
      text: 'text-cyan-400',
    },
    amber: {
      border: 'border-amber-500/20 hover:border-amber-500/40',
      iconBg: 'bg-amber-500/10 text-amber-400',
      glow: 'shadow-amber-950/20',
      text: 'text-amber-400',
    },
    rose: {
      border: 'border-rose-500/20 hover:border-rose-500/40',
      iconBg: 'bg-rose-500/10 text-rose-400',
      glow: 'shadow-rose-950/20',
      text: 'text-rose-400',
    },
    indigo: {
      border: 'border-indigo-500/20 hover:border-indigo-500/40',
      iconBg: 'bg-indigo-500/10 text-indigo-400',
      glow: 'shadow-indigo-950/20',
      text: 'text-indigo-400',
    },
    slate: {
      border: 'border-slate-800 hover:border-slate-700',
      iconBg: 'bg-slate-800 text-slate-300',
      glow: 'shadow-black/20',
      text: 'text-slate-300',
    },
  }[color];

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-slate-900/70 p-5 backdrop-blur-md shadow-lg transition-all duration-200 ${colorStyles.border} ${colorStyles.glow}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-500/30 px-1.5 py-0.5 rounded">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          )}
          <div className={`p-2 rounded-lg ${colorStyles.iconBg}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight text-white font-mono">
          {value}
        </span>
        {unit && (
          <span className="text-sm font-semibold text-slate-400">{unit}</span>
        )}
      </div>

      {subtext && (
        <div className="mt-2 text-xs text-slate-400 flex items-center gap-1">
          {subtext}
        </div>
      )}
    </div>
  );
}
