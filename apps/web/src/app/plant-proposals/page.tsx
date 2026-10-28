'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileSearch, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';

function contractLabel(contract: Record<string, unknown>, key: string): string {
  const value = contract[key];
  return typeof value === 'string' ? value : '—';
}

export default function PlantProposalsPage() {
  const { currentOrg, currentMembership, user } = useAuth();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const organizationId = currentOrg?.id;
  const canReview = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const proposals = useQuery({
    queryKey: ['plant-proposals', organizationId],
    queryFn: () => apiClient.getPlantProposals(organizationId!),
    enabled: Boolean(organizationId),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plant-proposals', organizationId] });
  const decision = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 'approve' | 'reject' }) => apiClient.decidePlantProposal(organizationId!, id, value, reason),
    onSuccess: async () => { setReason(''); setError(''); await refresh(); },
    onError: (cause) => setError((cause as Error).message || 'Keputusan review gagal disimpan.'),
  });
  const apply = useMutation({
    mutationFn: (id: string) => apiClient.applyPlantProposal(organizationId!, id),
    onSuccess: async () => { setError(''); await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['plant-catalog'] })]); },
    onError: (cause) => setError((cause as Error).message || 'Proposal gagal diterapkan ke draft.'),
  });
  const verify = useMutation({
    mutationFn: (id: string) => apiClient.verifyPlantEvidence(id, reason),
    onSuccess: async () => { setReason(''); setError(''); await refresh(); },
    onError: (cause) => setError((cause as Error).message || 'Verifikasi evidence gagal disimpan.'),
  });

  return (
    <DashboardLayout>
      <main className="mx-auto max-w-6xl space-y-6">
        <header>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400"><FileSearch className="h-4 w-4" /> Plant Standardization</div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Review proposal tanaman</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Tinjau proposal beserta status bukti. Persetujuan hanya membuat proposal dapat diterapkan ke draft; versi katalog tetap harus lolos validasi dan publikasi tersendiri.</p>
        </header>

        {!organizationId && <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Pilih organisasi untuk melihat proposal.</p>}
        {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</p>}
        {proposals.isLoading && <p role="status" className="text-sm text-slate-400">Memuat proposal…</p>}
        {proposals.isError && <p role="alert" className="text-sm text-rose-300">Proposal gagal dimuat. Periksa akses organisasi lalu coba lagi.</p>}
        {proposals.data?.length === 0 && <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">Belum ada proposal untuk organisasi ini.</p>}

        <div className="space-y-4">
          {proposals.data?.map((proposal) => {
            const contract = proposal.contract;
            const crop = contract.cropIdentity && typeof contract.cropIdentity === 'object' ? contract.cropIdentity as Record<string, unknown> : {};
            const reviewable = proposal.status === 'PROPOSED' || proposal.status === 'NEEDS_REVIEW';
            const applied = typeof contract.appliedCatalogVersionId === 'string';
            const canApproveThis = canReview && proposal.createdByUserId !== user?.id;
            return (
              <article key={proposal.id} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-white">{String(crop.commonName ?? crop.scientificName ?? 'Proposal tanaman')}</h2>
                    <p className="mt-1 text-xs text-slate-400">Katalog {proposal.plantCatalogId} · dibuat {new Date(proposal.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300">{proposal.status}</span>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <p><span className="text-slate-500">Intent</span><span className="mt-1 block text-slate-200">{contractLabel(contract, 'targetIntent')}</span></p>
                  <p><span className="text-slate-500">Parameter</span><span className="mt-1 block text-slate-200">{Array.isArray(contract.parameterDefinitions) ? contract.parameterDefinitions.length : 0}</span></p>
                  <p><span className="text-slate-500">Bukti</span><span className="mt-1 block text-slate-200">{proposal.evidenceLinks.map(({ evidence }) => evidence.verificationStatus).join(', ') || 'Tidak ada referensi'}</span></p>
                </div>
                {Array.isArray(contract.validationFindings) && contract.validationFindings.length > 0 && <details className="text-sm text-amber-200"><summary className="cursor-pointer">Temuan validasi ({contract.validationFindings.length})</summary><pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300">{JSON.stringify(contract.validationFindings, null, 2)}</pre></details>}
                {proposal.evidenceLinks.length > 0 && <div className="space-y-2"><h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Evidence terkait</h3>{proposal.evidenceLinks.map(({ evidence }) => <div key={evidence.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs text-slate-300">{String((evidence.contract.findingSummary as { value?: string } | undefined)?.value ?? evidence.id)}</p><p className="mt-1 text-xs text-slate-500">{evidence.verificationStatus}</p></div>{canReview && evidence.verificationStatus === 'UNVERIFIED' && <button type="button" disabled={verify.isPending || !reason.trim()} onClick={() => verify.mutate(evidence.id)} className="rounded-md border border-emerald-500/40 px-2.5 py-1.5 text-xs text-emerald-200 disabled:opacity-50">Verifikasi evidence</button>}</div><details className="text-xs text-slate-400"><summary className="cursor-pointer">Lihat provenance dan temuan</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3">{JSON.stringify(evidence.contract, null, 2)}</pre></details></div>)}</div>}
                {typeof contract.review === 'object' && contract.review !== null && <p className="text-sm text-slate-300">Review: {String((contract.review as Record<string, unknown>).reason ?? '')}</p>}
                {applied && <p className="text-sm text-emerald-300">Diterapkan ke draft katalog {String(contract.appliedCatalogVersionId)}.</p>}
                {canReview && reviewable && (
                  <div className="space-y-3 border-t border-slate-800 pt-4">
                    <label className="block text-xs text-slate-400">Alasan keputusan
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={2} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" placeholder="Catat dasar review dan persetujuan/revisi yang diperlukan." />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={decision.isPending || !reason.trim() || !canApproveThis} onClick={() => decision.mutate({ id: proposal.id, value: 'approve' })} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Check className="h-4 w-4" /> Setujui</button>
                      <button type="button" disabled={decision.isPending || !reason.trim()} onClick={() => decision.mutate({ id: proposal.id, value: 'reject' })} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-200 disabled:opacity-50"><X className="h-4 w-4" /> Tolak</button>
                    </div>
                    {proposal.createdByUserId === user?.id && <p className="text-xs text-amber-300">Pembuat proposal tidak dapat menyetujuinya.</p>}
                  </div>
                )}
                {canReview && proposal.status === 'APPROVED' && !applied && <button type="button" disabled={apply.isPending} onClick={() => apply.mutate(proposal.id)} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Terapkan ke draft katalog</button>}
              </article>
            );
          })}
        </div>
      </main>
    </DashboardLayout>
  );
}
