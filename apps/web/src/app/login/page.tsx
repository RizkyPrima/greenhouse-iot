'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/auth-context';
import { Leaf, Lock, Mail, AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await login({ email, password });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid login credentials';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoFill = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  return (
    <div className="auth-page relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,_#064e3b_0%,_#020617_42%,_#020617_100%)] px-4 py-10 sm:px-6">
      {/* Background glow accents */}
      <div className="auth-glow pointer-events-none absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="auth-glow pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />

      <main className="relative z-10 w-full max-w-md">
        {/* Brand header */}
        <div className="mb-8 text-center">
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 shadow-lg shadow-emerald-950/30">
            <Leaf className="h-7 w-7 text-emerald-300" />
          </div>
          <p className="auth-brand text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
            Greenhouse IoT
          </p>
          <h1 className="auth-title mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Selamat datang kembali
          </h1>
          <p className="auth-subtitle mt-2 text-sm leading-6 text-slate-400">
            Masuk untuk memantau kondisi greenhouse dan mengelola perangkat Anda.
          </p>
        </div>

        {/* Card */}
        <div className="auth-card rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
          {error && (
            <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="auth-label mb-2 block text-sm font-medium text-slate-200">
                Alamat email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  type="email"
                  id="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@greenhouse.internal"
                  required
                  autoComplete="email"
                  className="auth-input w-full rounded-xl border border-slate-700/80 bg-slate-950/70 py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="auth-label mb-2 block text-sm font-medium text-slate-200">
                Kata sandi
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  autoComplete="current-password"
                  className="auth-input w-full rounded-xl border border-slate-700/80 bg-slate-950/70 py-3 pl-10 pr-12 text-sm text-white placeholder-slate-500 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition hover:text-emerald-500 focus-visible:rounded-r-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                >
                  {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="auth-primary-button mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <span>Memproses...</span>
                </>
              ) : (
                <>
                  <span>Masuk ke dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Registration Link */}
          <div className="mt-6 border-t border-white/10 pt-5 text-center">
            <p className="text-sm text-slate-400">
              Belum punya akun?{' '}
              <Link
                href="/register"
                className="font-semibold text-emerald-300 transition hover:text-emerald-200 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Buat akun
              </Link>
            </p>
          </div>

          {/* Quick Demo Pre-fill */}
          <div className="mt-5 border-t border-white/5 pt-5 text-center">
            <span className="mb-3 block text-xs text-slate-500">
              Akses cepat untuk demo
            </span>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                type="button"
                onClick={() => handleDemoFill('owner@example.com', 'Password123!')}
                className="rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Owner
              </button>
              <button
                type="button"
                onClick={() => handleDemoFill('operator@example.com', 'Password123!')}
                className="rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Operator
              </button>
              <button
                type="button"
                onClick={() => handleDemoFill('viewer@example.com', 'Password123!')}
                className="rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Viewer
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          Akses aman untuk operasional greenhouse Anda
        </div>
      </main>
    </div>
  );
}
