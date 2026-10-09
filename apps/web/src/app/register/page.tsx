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
} from 'lucide-react';

type OrgAction = 'create' | 'join' | 'none';

export default function RegisterPage() {
  const { register } = useAuth();

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      {/* Background glow accents */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-teal-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-xl relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 items-center justify-center shadow-xl shadow-emerald-950/60 mb-4 border border-emerald-400/30">
            <Leaf className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-mono">
            CREATE ACCOUNT
          </h1>
          <p className="text-xs font-mono text-emerald-400 mt-1 uppercase tracking-widest">
            Greenhouse IoT Access Portal
          </p>
          <p className="text-sm text-slate-400 mt-2">
            Register your operator or organization profile to monitor telemetry
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-xl p-8 shadow-2xl">
          {error && (
            <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-950/50 p-4 text-xs text-rose-300 flex items-start gap-3 animate-in fade-in">
              <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isSuccess && (
            <div className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-950/50 p-4 text-xs text-emerald-300 flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Registration successful! Directing to dashboard...</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* User Profile Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <UserIcon className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-700 bg-slate-950/60 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Mail className="h-4 w-4" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@greenhouse.internal"
                    required
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-700 bg-slate-950/60 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Password and Confirm */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={8}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-700 bg-slate-950/60 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={8}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-700 bg-slate-950/60 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Organization Selection Tabs */}
            <div className="pt-4 border-t border-slate-800">
              <label className="block text-xs font-medium text-slate-300 uppercase tracking-wider mb-2.5">
                Organization & Workspace Setup
              </label>

              <div className="grid grid-cols-3 gap-2 p-1 bg-slate-950/80 rounded-xl border border-slate-800">
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
                  <span>Create Org</span>
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
                  <span>Join Org</span>
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
                  <span>Standalone</span>
                </button>
              </div>

              {/* Mode Details */}
              <div className="mt-3.5 p-4 rounded-xl border border-slate-800/80 bg-slate-950/40 space-y-3">
                {orgAction === 'create' && (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
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
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
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
              className="w-full mt-6 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-semibold tracking-wide transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : isSuccess ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Success! Redirecting...</span>
                </>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Link to Login */}
          <div className="mt-6 pt-5 border-t border-slate-800 text-center">
            <p className="text-xs text-slate-400">
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4 transition-colors"
              >
                Sign in to Dashboard
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-xs font-mono text-slate-500">
          Backend API: {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}
        </div>
      </div>
    </div>
  );
}
