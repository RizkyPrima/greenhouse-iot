'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, Sparkles } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';
import type { GrowthStage, PlantParameterDefinition, PlantScientificEvidenceRecord } from '@/types';

type EvidenceDraft = {
  title: string; url: string; authors: string; publicationYear: string; doi: string;
  publisher: string; publicationType: string; crop: string; cultivar: string;
  growthStage: string; growingSystem: string; parameterKey: string; reportedValue: string;
  unit: string; experimentalContext: string; limitations: string; findingSummary: string;
  locator: string; quality: '' | 'HIGH' | 'MODERATE' | 'LOW';
};

function evidenceField(value: string) {
  return value.trim() ? { state: 'VALUE', value: value.trim() } : { state: 'NOT_REPORTED' };
}

function evidenceValue(contract: Record<string, unknown>, key: string): string {
  const field = contract[key];
  if (!field || typeof field !== 'object' || !('state' in field) || field.state !== 'VALUE' || !('value' in field)) return '—';
  return typeof field.value === 'object' ? JSON.stringify(field.value) : String(field.value);
}

function PlantEvidenceManager({
  organizationId, cropName, stages, selectedStage, parameters, canManage,
}: {
  organizationId: string | undefined;
  cropName: string;
  stages: GrowthStage[];
  selectedStage: GrowthStage | undefined;
  parameters: PlantParameterDefinition[];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EvidenceDraft>({
    title: '', url: '', authors: '', publicationYear: '', doi: '', publisher: '', publicationType: '',
    crop: cropName, cultivar: '', growthStage: selectedStage?.id ?? '', growingSystem: '',
    parameterKey: parameters[0]?.parameterKey ?? '', reportedValue: '', unit: parameters[0]?.unit ?? '',
    experimentalContext: '', limitations: '', findingSummary: '', locator: '', quality: '',
  });
  const [reviewReason, setReviewReason] = useState('');
  const evidenceQuery = useQuery({
    queryKey: ['plant-evidence', organizationId],
    queryFn: () => apiClient.getPlantEvidence(organizationId!),
    enabled: Boolean(organizationId),
  });
  const refreshEvidence = async () => queryClient.invalidateQueries({ queryKey: ['plant-evidence', organizationId] });
  const createEvidence = useMutation({
    mutationFn: (contract: Record<string, unknown>) => apiClient.createPlantEvidence(organizationId!, contract),
    onSuccess: refreshEvidence,
  });
  const verifyEvidence = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.verifyPlantEvidence(id, reason),
    onSuccess: refreshEvidence,
  });
  const update = (key: keyof EvidenceDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stage = stages.find((item) => item.id === draft.growthStage);
    const parameter = parameters.find((item) => item.parameterKey === draft.parameterKey);
    if (!stage || !parameter || !draft.quality) return;
    const rawValue = draft.reportedValue.trim();
    let reportedValue: unknown = rawValue;
    if (rawValue && Number.isFinite(Number(rawValue))) reportedValue = Number(rawValue);
    else if (rawValue.startsWith('{')) {
      try { reportedValue = JSON.parse(rawValue); } catch { reportedValue = rawValue; }
    }
    const authors = draft.authors.split(';').map((item) => item.trim()).filter(Boolean);
    const timestamp = new Date().toISOString();
    const contract = {
      title: evidenceField(draft.title),
      authors: authors.length ? { state: 'VALUE', value: authors } : { state: 'NOT_REPORTED' },
      publicationYear: draft.publicationYear.trim() ? { state: 'VALUE', value: Number(draft.publicationYear) } : { state: 'NOT_REPORTED' },
      doi: evidenceField(draft.doi),
      canonicalUrl: { state: 'VALUE', value: draft.url.trim() },
      publisherOrJournal: evidenceField(draft.publisher),
      publicationType: { state: 'VALUE', value: draft.publicationType.trim() },
      retrievedAt: timestamp,
      crop: { state: 'VALUE', value: draft.crop.trim() },
      cultivar: draft.cultivar.trim() ? { state: 'VALUE', value: draft.cultivar.trim() } : { state: 'UNKNOWN' },
      growthStage: { state: 'VALUE', value: stage.code },
      growingSystem: { state: 'VALUE', value: draft.growingSystem.trim() },
      parameterKey: { state: 'VALUE', value: parameter.parameterKey },
      reportedValue: { state: 'VALUE', value: reportedValue },
      unit: draft.unit.trim() ? { state: 'VALUE', value: draft.unit.trim() } : { state: 'NOT_REPORTED' },
      experimentalContext: evidenceField(draft.experimentalContext),
      limitations: evidenceField(draft.limitations),
      findingSummary: { state: 'VALUE', value: draft.findingSummary.trim() },
      extraction: { method: 'MANUAL', extractedAt: timestamp, locator: draft.locator.trim() },
      quality: draft.quality,
    };
    createEvidence.mutate(contract);
  }

  const records = evidenceQuery.data ?? [];
  return <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
    <div><h2 className="font-semibold text-white">Evidence ilmiah</h2><p className="mt-1 text-sm text-slate-400">Evidence baru selalu tersimpan UNVERIFIED. URL bukan bukti verifikasi; reviewer harus memeriksa sumber dan kutipan secara eksplisit.</p></div>
    {canManage && organizationId && <form onSubmit={submitEvidence} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 md:grid-cols-2">
      <label className="space-y-1 text-xs text-slate-300">Judul sumber<input required value={draft.title} onChange={(event) => update('title', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">URL sumber<input required type="url" value={draft.url} onChange={(event) => update('url', event.target.value)} placeholder="https://…" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">Penulis (pisahkan dengan titik koma)<input value={draft.authors} onChange={(event) => update('authors', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-slate-300">Tahun terbit<input type="number" min="1000" max="9999" value={draft.publicationYear} onChange={(event) => update('publicationYear', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
        <label className="space-y-1 text-xs text-slate-300">DOI<input value={draft.doi} onChange={(event) => update('doi', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      </div>
      <label className="space-y-1 text-xs text-slate-300">Jurnal / penerbit<input value={draft.publisher} onChange={(event) => update('publisher', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">Jenis publikasi<input required value={draft.publicationType} onChange={(event) => update('publicationType', event.target.value)} placeholder="Isi sesuai sumber" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">Nama tanaman pada sumber<input required value={draft.crop} onChange={(event) => update('crop', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">Cultivar (kosong jika sumber tidak menyebutkan)<input value={draft.cultivar} onChange={(event) => update('cultivar', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">Growth stage<select required value={draft.growthStage} onChange={(event) => update('growthStage', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"><option value="">Pilih stage profile</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.code}</option>)}</select></label>
      <label className="space-y-1 text-xs text-slate-300">Sistem budidaya sesuai sumber<input required value={draft.growingSystem} onChange={(event) => update('growingSystem', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">Parameter catalog<select required value={draft.parameterKey} onChange={(event) => { const selected = parameters.find((item) => item.parameterKey === event.target.value); setDraft((current) => ({ ...current, parameterKey: event.target.value, unit: selected?.unit ?? '' })); }} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"><option value="">Pilih parameter</option>{parameters.map((item) => <option key={item.id} value={item.parameterKey}>{item.label} · {item.parameterKey}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-slate-300">Nilai sumber (angka atau JSON range)<input required value={draft.reportedValue} onChange={(event) => update('reportedValue', event.target.value)} placeholder='nilai literal atau {"minimum":…,"maximum":…}' className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
        <label className="space-y-1 text-xs text-slate-300">Satuan persis seperti sumber<input value={draft.unit} onChange={(event) => update('unit', event.target.value)} placeholder="Samakan dengan unit katalog/sumber" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      </div>
      <label className="space-y-1 text-xs text-slate-300">Konteks eksperimen<input required value={draft.experimentalContext} onChange={(event) => update('experimentalContext', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300">Keterbatasan yang disebut sumber<input required value={draft.limitations} onChange={(event) => update('limitations', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <label className="space-y-1 text-xs text-slate-300 md:col-span-2">Ringkasan temuan persis dari sumber<textarea required value={draft.findingSummary} onChange={(event) => update('findingSummary', event.target.value)} rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-slate-300">Lokator kutipan (halaman/tabel/bagian)<input required value={draft.locator} onChange={(event) => update('locator', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm" /></label>
        <label className="space-y-1 text-xs text-slate-300">Kualitas evidence<select required value={draft.quality} onChange={(event) => update('quality', event.target.value as EvidenceDraft['quality'])} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"><option value="">Pilih setelah meninjau sumber</option><option value="HIGH">HIGH</option><option value="MODERATE">MODERATE</option><option value="LOW">LOW (tidak dapat diverifikasi)</option></select></label>
      </div>
      <p className="text-xs text-slate-500 md:col-span-2">Penulis, tahun, DOI, jurnal, dan unit boleh dikosongkan hanya jika memang tidak dilaporkan; statusnya disimpan sebagai NOT_REPORTED, bukan ditebak. Isi temuan dan lokator dari sumber yang benar-benar diperiksa.</p>
      {createEvidence.isError && <p role="alert" className="text-sm text-rose-300 md:col-span-2">{(createEvidence.error as Error).message}</p>}
      {createEvidence.isSuccess && <p className="text-sm text-emerald-300 md:col-span-2">Evidence tersimpan sebagai UNVERIFIED dan belum dapat digunakan AI.</p>}
      <button disabled={createEvidence.isPending || !parameters.length || !stages.length} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 md:col-span-2">{createEvidence.isPending ? 'Menyimpan…' : 'Simpan evidence sebagai UNVERIFIED'}</button>
      {!parameters.length && <p className="text-sm text-amber-300 md:col-span-2">Pilih profile version yang memakai published Plant Standard dengan parameter definitions sebelum menambahkan evidence.</p>}
    </form>}
    {canManage && <div className="flex flex-wrap gap-2">
      <label className="flex-1 space-y-1 text-xs text-slate-300">Alasan review/verifikasi<input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Contoh: diperiksa teks lengkap dan tabel yang dirujuk" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /></label>
    </div>}
    {verifyEvidence.isError && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{(verifyEvidence.error as Error).message}</p>}
    {evidenceQuery.isError && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{(evidenceQuery.error as Error).message}</p>}
    {evidenceQuery.isLoading ? <p className="text-sm text-slate-400">Memuat daftar evidence…</p> : records.length === 0 ? <p className="rounded-lg bg-slate-950/50 p-4 text-sm text-slate-400">Belum ada evidence organisasi atau evidence global terverifikasi.</p> : <div className="space-y-2">{records.map((item: PlantScientificEvidenceRecord) => <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-slate-100">{evidenceValue(item.contract, 'title')} · {evidenceValue(item.contract, 'parameterKey')}</p><p className="mt-1 text-xs text-slate-400">{evidenceValue(item.contract, 'crop')} · {evidenceValue(item.contract, 'growthStage')} · {evidenceValue(item.contract, 'reportedValue')} {evidenceValue(item.contract, 'unit')}</p><p className="mt-1 text-xs text-slate-500">{evidenceValue(item.contract, 'findingSummary')}</p><a href={evidenceValue(item.contract, 'canonicalUrl')} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-300 underline">Buka sumber</a></div><span className={`rounded-full px-2.5 py-1 text-xs ${item.verificationStatus === 'VERIFIED' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{item.verificationStatus}</span></div>
      {item.verificationStatus === 'UNVERIFIED' && canManage && item.organizationId === organizationId && <button type="button" disabled={verifyEvidence.isPending || reviewReason.trim().length === 0} onClick={() => verifyEvidence.mutate({ id: item.id, reason: reviewReason.trim() })} className="mt-3 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-300 disabled:opacity-50">{verifyEvidence.isPending ? 'Memverifikasi…' : 'Verifikasi setelah pemeriksaan manual'}</button>}
      {item.verificationStatus === 'UNVERIFIED' && <p className="mt-2 text-xs text-amber-300">Belum diverifikasi: tidak disertakan dalam retrieval AI.</p>}
    </article>)}</div>}
  </section>;
}

export default function PlantAiRecommendationsPage() {
  const { currentOrg, currentMembership } = useAuth();
  const organizationId = currentOrg?.id;
  const [profileId, setProfileId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [stageId, setStageId] = useState('');
  const profiles = useQuery({ queryKey: ['plant-profiles', organizationId], queryFn: () => apiClient.getPlantProfiles(organizationId!), enabled: Boolean(organizationId) });
  const profile = profiles.data?.find((item) => item.id === profileId) ?? profiles.data?.[0];
  const catalog = useQuery({
    queryKey: ['plant-catalog-item', organizationId, profile?.plantCatalogId],
    queryFn: () => apiClient.getPlantCatalogItem(organizationId!, profile!.plantCatalogId),
    enabled: Boolean(organizationId && profile?.plantCatalogId),
  });
  const versions = profile?.versions ?? [];
  const version = versions.find((item) => item.id === versionId) ?? versions.find((item) => item.status === 'VALIDATED');
  const stages = version?.growthStages ?? [];
  const stage = stages.find((item) => item.id === stageId) ?? stages[0];
  const sourceCatalogVersion = catalog.data?.versions?.find((item) => item.id === version?.sourceCatalogVersionId);
  const parameterDefinitions = sourceCatalogVersion?.parameterDefinitions ?? [];
  const canManage = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const recommendation = useMutation({
    mutationFn: () => apiClient.createPlantRecommendation(organizationId!, profile!.id, { profileVersionId: version!.id, growthStageId: stage!.id }),
  });
  const result = recommendation.data;
  const proposalContract = result?.proposal?.contract;
  const recommendationRows = Array.isArray(proposalContract?.parameterDefinitions) ? proposalContract.parameterDefinitions as Array<Record<string, unknown>> : [];
  const stageTemplates = Array.isArray(proposalContract?.stageTemplates) ? proposalContract.stageTemplates as Array<Record<string, unknown>> : [];
  const selectedStageTemplate = stageTemplates.find((item) => item.code === stage?.code);
  const proposedStageConfig = selectedStageTemplate?.config && typeof selectedStageTemplate.config === 'object' ? selectedStageTemplate.config as Record<string, unknown> : {};
  const buttonDisabled = !organizationId || !canManage || !profile || version?.status !== 'VALIDATED' || !stage || !parameterDefinitions.length || recommendation.isPending;

  return <DashboardLayout><main className="mx-auto max-w-5xl space-y-6">
    <header><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400"><Sparkles className="h-4 w-4" /> Plant Standardization</div><h1 className="text-2xl font-bold text-white sm:text-3xl">Rekomendasi agronomi berbantuan AI</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">Rekomendasi hanya memakai evidence terverifikasi yang cocok dengan tanaman dan fase. Hasil AI menjadi proposal untuk human review; tidak menerbitkan standar atau mengirim perintah aktuator.</p></header>
    {!organizationId && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Pilih organisasi terlebih dahulu.</p>}
    {organizationId && !canManage && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Role OWNER atau ADMIN diperlukan untuk membuat proposal.</p>}
    {organizationId && profile && version && catalog.isError && <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">Plant Standard yang dipakai profile tidak dapat dimuat: {(catalog.error as Error).message}</p>}
    {organizationId && profile && version && catalog.data && !parameterDefinitions.length && <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
      <p className="font-semibold">Profile version ini terikat ke Plant Standard tanpa parameter.</p>
      <p className="mt-1">Validated profile v{version.version} memakai catalog version ID {version.sourceCatalogVersionId}; katalog tersebut memiliki 0 parameter definitions. Menambahkan parameter ke draft catalog lain tidak mengubah profile ini.</p>
      <p className="mt-1">Tambahkan parameter pada draft katalog, publish, lalu di halaman profile buat draft version baru, adopsi catalog version yang baru terbit, lengkapi stage/config, dan validasi profile version tersebut.</p>
      <Link href={`/plant-catalog/${profile.plantCatalogId}`} className="mt-2 inline-block text-emerald-300 underline">Buka Plant Catalog</Link>
      <Link href={`/plant-profiles/${profile.id}`} className="ml-4 mt-2 inline-block text-emerald-300 underline">Buka Plant Profile</Link>
    </div>}
    {organizationId && <PlantEvidenceManager
      key={`${organizationId}-${profile?.id ?? ''}-${version?.id ?? ''}`}
      organizationId={organizationId}
      cropName={catalog.data?.scientificName ?? profile?.plantCatalog?.scientificName ?? ''}
      stages={stages}
      selectedStage={stage}
      parameters={parameterDefinitions}
      canManage={canManage}
    />}
    <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 md:grid-cols-3">
      <label className="space-y-2 text-sm text-slate-300">Plant Profile<select value={profile?.id ?? ''} onChange={(event) => { setProfileId(event.target.value); setVersionId(''); setStageId(''); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Pilih profil</option>{profiles.data?.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.plantCatalog?.commonName ?? item.code}</option>)}</select></label>
      <label className="space-y-2 text-sm text-slate-300">Validated profile version<select value={version?.id ?? ''} onChange={(event) => { setVersionId(event.target.value); setStageId(''); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Pilih versi tervalidasi</option>{versions.filter((item) => item.status === 'VALIDATED').map((item) => <option key={item.id} value={item.id}>v{item.version}</option>)}</select></label>
      <label className="space-y-2 text-sm text-slate-300">Growth stage<select value={stage?.id ?? ''} onChange={(event) => setStageId(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Pilih fase</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.code}</option>)}</select></label>
      <div className="md:col-span-3"><button type="button" disabled={buttonDisabled} onClick={() => recommendation.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"><Sparkles className="h-4 w-4" />{recommendation.isPending ? 'Mengambil evidence dan mengevaluasi…' : 'Buat rekomendasi dan proposal'}</button><p className="mt-2 text-xs text-slate-500">Hanya versi profile tervalidasi dan Plant Standard terbit dengan parameter yang digunakan.</p></div>
    </section>
    {recommendation.isError && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{(recommendation.error as Error).message || 'Rekomendasi gagal dibuat.'}</p>}
    {result && <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-white">Status: {result.status}</h2><p className="mt-1 text-sm text-slate-400">Evidence terverifikasi: {result.completeness.verifiedEvidenceCount} · parameter tercakup: {result.completeness.parametersWithEvidence}/{result.completeness.totalParameters}{result.proposal ? ` · status proposal: ${result.proposal.status}` : ''}</p></div>{result.proposal && <Link href="/plant-proposals" className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10"><FileSearch className="h-4 w-4" />Buka review proposal</Link>}</div>
      {result.completeness.missingParameters.length > 0 && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">Parameter tanpa evidence yang cocok: {result.completeness.missingParameters.join(', ')}.</p>}
      {result.status === 'PROVIDER_NOT_CONFIGURED' && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">Provider belum dikonfigurasi. Tidak ada konten AI yang dibuat atau disimpan.</p>}
      {result.status === 'INSUFFICIENT_EVIDENCE' && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">INSUFFICIENT_EVIDENCE — lengkapi dan verifikasi sumber sesuai tanaman, parameter, serta fase sebelum meminta rekomendasi.</p>}
      {recommendationRows.length > 0 && <div><h3 className="mb-2 text-sm font-medium text-slate-200">Hasil per parameter</h3><div className="space-y-2">{recommendationRows.map((raw, index) => {
        const key = typeof raw.parameterKey === 'string' ? raw.parameterKey : `parameter-${index}`;
        const biological = raw.biologicalRecommendation && typeof raw.biologicalRecommendation === 'object' ? raw.biologicalRecommendation as Record<string, unknown> : {};
        const uncertainty = raw.uncertainty && typeof raw.uncertainty === 'object' ? raw.uncertainty as Record<string, unknown> : {};
        const citations = Array.isArray(raw.evidenceReferences) ? raw.evidenceReferences.filter((item): item is string => typeof item === 'string') : [];
        const stageValue = Object.hasOwn(proposedStageConfig, key) ? JSON.stringify(proposedStageConfig[key]) : null;
        return <article key={key} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-100">{String(raw.label ?? key)} <span className="font-mono text-xs text-slate-500">{key}{typeof raw.unit === 'string' ? ` · ${raw.unit}` : ''}</span></p><span className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-amber-200">{String(raw.reviewStatus ?? 'NEEDS_REVIEW')}</span></div><p className="mt-2 text-slate-300">{String(biological.summary ?? (stageValue ? `Nilai sumber yang sama persis: ${stageValue}` : 'Belum ada rekomendasi yang memenuhi syarat untuk konfigurasi standar.'))}</p><p className="mt-1 text-xs text-slate-400">Ketidakpastian: {String(uncertainty.level ?? 'UNKNOWN')}{typeof uncertainty.explanation === 'string' ? ` · ${uncertainty.explanation}` : ''}</p><p className="mt-1 text-xs text-slate-500">Evidence: {citations.length ? citations.join(', ') : 'belum tersedia'}</p></article>;
      })}</div></div>}
      {result.evidence.length > 0 && <div><h3 className="mb-2 text-sm font-medium text-slate-200">Referensi yang digunakan</h3><ul className="space-y-2">{result.evidence.map((item) => <li key={item.evidenceId} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"><p className="font-medium text-slate-200">{item.source?.title ?? item.evidenceId} · {item.parameterKey ?? 'parameter tidak tersedia'}</p><p className="mt-1 text-xs text-slate-400">Temuan: {item.findingSummary ?? '—'} · nilai dilaporkan: {JSON.stringify(item.reportedValue ?? null)} {item.unit ?? ''}</p>{item.source?.doi && <p className="mt-1 text-xs text-sky-300">DOI: {item.source.doi}</p>}{item.source?.canonicalUrl && <a className="mt-1 inline-block text-xs text-sky-300 underline" href={item.source.canonicalUrl} target="_blank" rel="noreferrer">Buka sumber</a>}</li>)}</ul></div>}
      {result.findings.length > 0 && <div><h3 className="mb-2 text-sm font-medium text-slate-200">Validasi dan hal yang perlu ditinjau</h3><ul className="list-inside list-disc space-y-1 text-sm text-amber-200">{result.findings.map((item, index) => <li key={`${item.code}-${index}`}>{item.code}: {item.explanation}</li>)}</ul></div>}
    </section>}
  </main></DashboardLayout>;
}
