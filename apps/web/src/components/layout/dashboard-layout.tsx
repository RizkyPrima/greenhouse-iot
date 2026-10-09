'use client';

import React from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { useAuth } from '@/context/auth-context';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        <span className="text-xs font-mono tracking-wider">INITIALIZING PLATFORM...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect via AuthProvider
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
