import React from 'react';
import { ConnectionStatus, DeviceStatus, GreenhouseStatus, UserRole } from '@/types';

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const configs: Record<ConnectionStatus, { bg: string; text: string; dot: string; label: string; ping: boolean }> = {
    CONNECTED: {
      bg: 'bg-emerald-950/60 border-emerald-500/40',
      text: 'text-emerald-400',
      dot: 'bg-emerald-400',
      label: 'CONNECTED',
      ping: true,
    },
    RECONNECTING: {
      bg: 'bg-amber-950/60 border-amber-500/40',
      text: 'text-amber-400',
      dot: 'bg-amber-400',
      label: 'RECONNECTING',
      ping: true,
    },
    DISCONNECTED: {
      bg: 'bg-rose-950/60 border-rose-500/40',
      text: 'text-rose-400',
      dot: 'bg-rose-400',
      label: 'DISCONNECTED',
      ping: false,
    },
  };

  const cfg = configs[status] || configs.DISCONNECTED;

  return (
    <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-mono font-medium tracking-wider ${cfg.bg} ${cfg.text}`}>
      <span className="relative flex h-2 w-2">
        {cfg.ping && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.dot}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
      </span>
      <span>{cfg.label}</span>
    </div>
  );
}

export function DeviceStatusBadge({
  status,
  lastSeenAt,
}: {
  status?: string | DeviceStatus;
  lastSeenAt?: string | null;
}) {
  // Determine status dynamically based on lastSeenAt if available:
  // <= 15 seconds: ONLINE
  // > 15 and <= 30 seconds: STALE
  // > 30 seconds: OFFLINE
  let computedStatus: 'ONLINE' | 'STALE' | 'OFFLINE' = 'OFFLINE';

  if (lastSeenAt) {
    const diffSecs = (Date.now() - new Date(lastSeenAt).getTime()) / 1000;
    if (diffSecs <= 15) {
      computedStatus = 'ONLINE';
    } else if (diffSecs <= 30) {
      computedStatus = 'STALE';
    } else {
      computedStatus = 'OFFLINE';
    }
  } else if (status) {
    const s = String(status).toUpperCase();
    if (s === 'ONLINE') computedStatus = 'ONLINE';
    else if (s === 'STALE') computedStatus = 'STALE';
    else computedStatus = 'OFFLINE';
  }

  const styles = {
    ONLINE: 'bg-emerald-900/30 border-emerald-500/30 text-emerald-400',
    STALE: 'bg-amber-900/30 border-amber-500/30 text-amber-400',
    OFFLINE: 'bg-rose-900/30 border-rose-500/30 text-rose-400',
  }[computedStatus];

  const dotColor = {
    ONLINE: 'bg-emerald-400',
    STALE: 'bg-amber-400',
    OFFLINE: 'bg-rose-400',
  }[computedStatus];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-mono font-medium ${styles}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {computedStatus}
    </span>
  );
}

export function GreenhouseStatusBadge({ status }: { status: GreenhouseStatus }) {
  const configs: Record<GreenhouseStatus, { bg: string; text: string }> = {
    ACTIVE: { bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', text: 'Active' },
    INACTIVE: { bg: 'bg-slate-500/10 border-slate-500/30 text-slate-400', text: 'Inactive' },
    MAINTENANCE: { bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400', text: 'Maintenance' },
  };

  const cfg = configs[status] || configs.ACTIVE;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cfg.bg}`}>
      {cfg.text}
    </span>
  );
}

export function RoleBadge({ role }: { role: UserRole | string }) {
  const styles: Record<string, string> = {
    OWNER: 'bg-purple-900/40 border-purple-500/40 text-purple-300',
    ADMIN: 'bg-indigo-900/40 border-indigo-500/40 text-indigo-300',
    OPERATOR: 'bg-blue-900/40 border-blue-500/40 text-blue-300',
    VIEWER: 'bg-slate-800 border-slate-600 text-slate-300',
    AI_AGENT: 'bg-cyan-900/40 border-cyan-500/40 text-cyan-300',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-mono font-semibold uppercase tracking-wider ${styles[role] || styles.VIEWER}`}>
      {role}
    </span>
  );
}
