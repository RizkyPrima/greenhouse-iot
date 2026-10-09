import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionText,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30">
      <div className="p-3 rounded-full bg-slate-800/80 border border-slate-700/50 text-slate-400 mb-4">
        <Icon className="h-8 w-8" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-400 max-w-sm">{description}</p>
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="mt-5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 animate-pulse">
      <div className="flex justify-between items-center mb-4">
        <div className="h-4 w-24 bg-slate-800 rounded" />
        <div className="h-8 w-8 bg-slate-800 rounded-lg" />
      </div>
      <div className="h-8 w-16 bg-slate-800 rounded mb-2" />
      <div className="h-3 w-32 bg-slate-800 rounded" />
    </div>
  );
}

export function SkeletonTable() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 animate-pulse">
      <div className="h-10 bg-slate-800/60 rounded" />
      <div className="h-12 bg-slate-800/40 rounded" />
      <div className="h-12 bg-slate-800/40 rounded" />
      <div className="h-12 bg-slate-800/40 rounded" />
    </div>
  );
}
