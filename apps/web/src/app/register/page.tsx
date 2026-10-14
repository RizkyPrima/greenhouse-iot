'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/auth-context';
import {
  Leaf,
  Lock,
  Mail,
  User as UserIcon,
  Building,
  KeyRound,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  PlusCircle,
  Users,
  UserCheck,
  Eye,
  EyeOff,
} from 'lucide-react';

type OrgAction = 'create' | 'join' | 'none';

export default function RegisterPage() {
  const { register } = useAuth();

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Organization mode states
  const [orgAction, setOrgAction] = useState<OrgAction>('create');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [joinCode, setJoinCode] = useState('');

  // UI status states
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Auto-slugify when org name changes
  const handleOrgNameChange = (val: string) => {
    setOrgName(val);
    const generatedSlug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setOrgSlug(generatedSlug);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!name.trim()) {
      setError('Full name is required');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('A valid email address is required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (orgAction === 'create') {
      if (!orgName.trim()) {
        setError('Organization name is required to create a new organization');
        return;
      }
    } else if (orgAction === 'join') {
      if (!orgSlug.trim()) {
        setError('Organization slug/identifier is required to join');
        return;
      }
      if (!joinCode.trim()) {
        setError('Authorization / Invite code is required to join an existing organization');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        organizationAction: orgAction,
        organizationName: orgAction === 'create' ? orgName.trim() : undefined,
        organizationSlug: orgAction === 'create' ? (orgSlug.trim() || undefined) : orgAction === 'join' ? orgSlug.trim() : undefined,
        joinCode: orgAction === 'join' ? joinCode.trim() : undefined,
      });
      setIsSuccess(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page auth-register-page relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,_#064e3b_0%,_#020617_42%,_#020617_100%)] px-4 py-8 sm:px-6 sm:py-12">
      {/* Background glow accents */}
      <div className="auth-glow pointer-events-none absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="auth-glow pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />

      <main className="relative z-10 w-full max-w-2xl">
        {/* Brand header */}
        <div className="mb-8 text-center">
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 shadow-lg shadow-emerald-950/30">
            <Leaf className="h-7 w-7 text-emerald-300" />
          </div>
          <p className="auth-brand text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">
            Greenhouse IoT
          </p>
          <h1 className="auth-title mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Buat akun Anda
          </h1>
          <p className="auth-subtitle mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">
            Siapkan akses operator dan workspace untuk memantau greenhouse Anda.
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

          {isSuccess && (
            <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Pendaftaran berhasil. Mengalihkan ke dashboard...</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* User Profile Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="register-name" className="auth-label mb-2 block text-sm font-medium text-slate-200">
                  Nama lengkap
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <UserIcon className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    id="register-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                    autoComplete="name"
                    className="auth-input w-full rounded-xl border border-slate-700/80 bg-slate-950/70 py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="register-email" className="auth-label mb-2 block text-sm font-medium text-slate-200">
                  Alamat email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Mail className="h-4 w-4" />
                  </div>
                  <input
                    type="email"
                    id="register-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@greenhouse.internal"
                    required
                    autoComplete="email"
                    className="auth-input w-full rounded-xl border border-slate-700/80 bg-slate-950/70 py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                  />
                </div>
              </div>
            </div>

            {/* Password and Confirm */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="register-password" className="auth-label mb-2 block text-sm font-medium text-slate-200">
                  Kata sandi
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="register-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
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

              <div>
                <label htmlFor="register-confirm-password" className="auth-label mb-2 block text-sm font-medium text-slate-200">
                  Konfirmasi kata sandi
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    id="register-confirm-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="auth-input w-full rounded-xl border border-slate-700/80 bg-slate-950/70 py-3 pl-10 pr-12 text-sm text-white placeholder-slate-500 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((visible) => !visible)}
                    aria-label={showConfirmPassword ? 'Sembunyikan konfirmasi kata sandi' : 'Tampilkan konfirmasi kata sandi'}
                    aria-pressed={showConfirmPassword}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition hover:text-emerald-500 focus-visible:rounded-r-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                  >
                    {showConfirmPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Organization Selection Tabs */}
            <div className="pt-4 border-t border-slate-800">
              <label className="mb-2.5 block text-sm font-medium text-slate-200">
                Pengaturan organisasi
              </label>

              <div className="auth-org-tabs grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-slate-950/80 p-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setOrgAction('create')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                    orgAction === 'create'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span>Buat</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOrgAction('join')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                    orgAction === 'join'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span>Gabung</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOrgAction('none')}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                    orgAction === 'none'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  <span>Mandiri</span>
                </button>
              </div>

              {/* Mode Details */}
              <div className="auth-org-details mt-3.5 space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
                {orgAction === 'create' && (
                  <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Role Granted: OWNER
                      </span>
                      <span>Full administrative authority over telemetry & devices</span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 uppercase tracking-wider mb-1">
                        New Organization Name
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Building className="h-3.5 w-3.5" />
                        </div>
                        <input
                          type="text"
                          value={orgName}
                          onChange={(e) => handleOrgNameChange(e.target.value)}
                          placeholder="e.g. AgriTech Hydroponics"
                          required={orgAction === 'create'}
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-1">
                        Slug (Auto-generated)
                      </label>
                      <input
                        type="text"
                        value={orgSlug}
                        onChange={(e) => setOrgSlug(e.target.value)}
                        placeholder="agritech-hydroponics"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  </>
                )}

                {orgAction === 'join' && (
                  <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1.5 text-teal-400 font-medium">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Initial Role: VIEWER
                      </span>
                      <span>Role elevation can be granted by the organization owner</span>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 uppercase tracking-wider mb-1">
                        Organization Slug / ID
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <Building className="h-3.5 w-3.5" />
                        </div>
                        <input
                          type="text"
                          value={orgSlug}
                          onChange={(e) => setOrgSlug(e.target.value.toLowerCase().trim())}
                          placeholder="e.g. default-org or agritech-hydroponics"
                          required={orgAction === 'join'}
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 uppercase tracking-wider mb-1">
                        Authorization / Invite Code
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                          <KeyRound className="h-3.5 w-3.5" />
                        </div>
                        <input
                          type="text"
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value.trim())}
                          placeholder="INVITE-DEFAULT-ORG or JOIN-CODE"
                          required={orgAction === 'join'}
                          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-700 bg-slate-950 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono uppercase"
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 block mt-1">
                        Hint: For default org, use <code className="text-emerald-400">INVITE-DEFAULT-ORG</code>
                      </span>
                    </div>
                  </>
                )}

                {orgAction === 'none' && (
                  <div className="text-xs text-slate-400 py-1">
                    <p>
                      You will register as an independent user without joining an organization immediately. You can be invited to organizations later.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || isSuccess}
              className="auth-primary-button mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <span>Membuat akun...</span>
                </>
              ) : isSuccess ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Berhasil! Mengalihkan...</span>
                </>
              ) : (
                <>
                  <span>Buat akun</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Link to Login */}
          <div className="mt-6 border-t border-white/10 pt-5 text-center">
            <p className="text-sm text-slate-400">
              Sudah punya akun?{' '}
              <Link
                href="/login"
                className="font-semibold text-emerald-300 transition hover:text-emerald-200 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Masuk ke dashboard
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-500">
          Akses aman untuk operasional greenhouse Anda
        </div>
      </main>
    </div>
  );
}
