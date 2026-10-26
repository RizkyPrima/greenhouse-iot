'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock3, Leaf, Plus, Save, Sprout } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { PlantProfileVersionDiff } from '@/components/plants/plant-profile-version-diff';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';
import type { CreateGrowthStageDto, PlantJsonObject, PlantProfileVersion, UpdateGrowthStageDto } from '@/types';

function errorDetails(error: unknown): { status?: number; message: string } {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401) return { status, message: 'Sesi tidak valid. Silakan masuk kembali.' };
  if (status === 403) return { status, message: 'Akses ditolak. Periksa membership dan role OWNER/ADMIN untuk aksi perubahan.' };
  if (status === 404) return { status, message: 'Profil atau versi tidak ditemukan di organisasi aktif.' };
  if (status === 409) return { status, message: 'Aksi ditolak karena lifecycle versi tidak mengizinkan perubahan ini.' };
  if (status === 400 || status === 422) return { status, message: (error as Error).message || 'Konfigurasi atau data tidak valid.' };
  return { status, message: (error as Error)?.message || 'Permintaan gagal. Silakan coba lagi.' };
}

function parseObject(source: string, label: string): PlantJsonObject {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} harus berupa JSON object.`);
  return value as PlantJsonObject;
}

type StageForm = { code: string; label: string; sequence: string; config: string };
const initialStage: StageForm = { code: '', label: '', sequence: '1', config: '{}' };

function statusStyle(status: PlantProfileVersion['status']): string {
  if (status === 'DRAFT') return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
  if (status === 'VALIDATED') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  return 'border-slate-700 bg-slate-800 text-slate-400';
}

export default function PlantProfileDetailPage() {
  const params = useParams<{ profileId: string }>();
  const profileId = Array.isArray(params.profileId) ? params.profileId[0] : params.profileId;
  const { currentOrg, currentMembership } = useAuth();
  const organizationId = currentOrg?.id;
  const canManage = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [stageForm, setStageForm] = useState<StageForm>(initialStage);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [stageError, setStageError] = useState('');
  const [adoptionVersionId, setAdoptionVersionId] = useState('');
  const [actionError, setActionError] = useState('');
  const [validationNotice, setValidationNotice] = useState('');

  const profileQuery = useQuery({
    queryKey: ['plant-profile', organizationId, profileId],
    queryFn: () => apiClient.getPlantProfile(organizationId!, profileId),
    enabled: Boolean(organizationId && profileId),
  });
  const catalogQuery = useQuery({
    queryKey: ['plant-catalog', 'profile-source', profileQuery.data?.plantCatalogId],
    queryFn: () => apiClient.getPlantCatalogItem(profileQuery.data!.organizationId, profileQuery.data!.plantCatalogId),
    enabled: Boolean(profileQuery.data?.plantCatalog?.organizationId === organizationId),
  });

  const invalidateProfile = async () => queryClient.invalidateQueries({ queryKey: ['plant-profile', organizationId, profileId] });
  const createVersion = useMutation({
    mutationFn: () => apiClient.createPlantProfileVersion(organizationId!, profileId),
    onSuccess: async () => { setActionError(''); await invalidateProfile(); },
    onError: (error) => setActionError(errorDetails(error).message),
  });
  const adoptVersion = useMutation({
    mutationFn: (catalogVersionId: string) => apiClient.adoptPlantCatalogVersion(organizationId!, profileId, { catalogVersionId }),
    onSuccess: async () => { setActionError(''); setAdoptionVersionId(''); await invalidateProfile(); },
    onError: (error) => setActionError(errorDetails(error).message),
  });
  const createStage = useMutation({
    mutationFn: ({ versionId, payload }: { versionId: string; payload: CreateGrowthStageDto }) => apiClient.createGrowthStage(organizationId!, versionId, payload),
    onSuccess: async () => { setStageError(''); setStageForm(initialStage); await invalidateProfile(); },
    onError: (error) => setStageError(errorDetails(error).message),
  });
  const updateStage = useMutation({
    mutationFn: ({ stageId, payload }: { stageId: string; payload: UpdateGrowthStageDto }) => apiClient.updateGrowthStage(organizationId!, stageId, payload),
    onSuccess: async () => { setStageError(''); setEditingStageId(null); await invalidateProfile(); },
    onError: (error) => setStageError(errorDetails(error).message),
  });
  const validateVersion = useMutation({
    mutationFn: (versionId: string) => apiClient.validatePlantProfileVersion(organizationId!, versionId),
    onSuccess: async (version) => { setActionError(''); setValidationNotice(`Versi ${version.version} berhasil divalidasi.`); await invalidateProfile(); },
    onError: (error) => { setValidationNotice(''); setActionError(errorDetails(error).message); },
  });

  const profile = profileQuery.data;
  const versions = useMemo(() => profile?.versions ?? [], [profile?.versions]);
  const latest = versions[0];
  const latestCatalogSource = catalogQuery.data?.versions?.find((catalogVersion) => catalogVersion.id === latest?.sourceCatalogVersionId);
  const canCreateVersion = latest?.status === 'VALIDATED';
  const availableCatalogVersions = (catalogQuery.data?.versions ?? []).filter((version) => version.id !== latest?.sourceCatalogVersionId);

  function submitStage(event: FormEvent<HTMLFormElement>, versionId: string) {
    event.preventDefault();
    setStageError('');
    try {
      const payload: CreateGrowthStageDto = {
        code: stageForm.code.trim(), label: stageForm.label.trim(), sequence: Number(stageForm.sequence),
        config: parseObject(stageForm.config, 'Konfigurasi stage'),
      };
      if (!Number.isInteger(payload.sequence) || payload.sequence < 1) throw new Error('Urutan stage harus bilangan bulat minimal 1.');
      createStage.mutate({ versionId, payload });
    } catch (error) { setStageError((error as Error).message || 'Data stage tidak valid.'); }
  }

  function beginEdit(stage: NonNullable<PlantProfileVersion['growthStages']>[number]) {
    setEditingStageId(stage.id);
    setStageForm({ code: stage.code, label: stage.label, sequence: String(stage.sequence), config: JSON.stringify(stage.parameterConfig?.config ?? {}, null, 2) });
    setStageError('');
  }

  function submitStageUpdate(event: FormEvent<HTMLFormElement>, stageId: string) {
    event.preventDefault();
    setStageError('');
    try {
      const sequence = Number(stageForm.sequence);
      if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Urutan stage harus bilangan bulat minimal 1.');
      const payload: UpdateGrowthStageDto = {
        code: stageForm.code.trim(), label: stageForm.label.trim(), sequence,
        config: parseObject(stageForm.config, 'Konfigurasi stage'),
      };
      updateStage.mutate({ stageId, payload });
    } catch (error) { setStageError((error as Error).message || 'Data stage tidak valid.'); }
  }

  const readError = profileQuery.isError ? errorDetails(profileQuery.error) : null;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/plant-profiles" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-300"><ArrowLeft className="h-4 w-4" /> Kembali ke profil</Link>
        {!organizationId ? <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Pilih organisasi untuk membuka profil.</p>
          : profileQuery.isLoading ? <div className="space-y-4" aria-label="Memuat profil"><div className="h-8 w-64 animate-pulse rounded bg-slate-800" /><div className="h-32 animate-pulse rounded-2xl bg-slate-900" /></div>
            : readError ? <section role="alert" className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6"><h1 className="font-semibold text-rose-200">Profil tidak tersedia</h1><p className="mt-2 text-sm text-rose-100/80">{readError.message}</p><button onClick={() => void profileQuery.refetch()} className="mt-4 rounded-lg border border-rose-300/20 px-3 py-2 text-sm text-rose-100">Coba lagi</button></section>
              : profile ? <>
                <header className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 sm:p-8">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-4"><span className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-400"><Leaf className="h-6 w-6" /></span><div><span className="font-mono text-xs uppercase tracking-wider text-emerald-300">{profile.code} · {profile.status} · {currentOrg?.name}</span><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{profile.name}</h1><p className="mt-2 text-sm text-slate-400">{profile.plantCatalog?.commonName ?? 'Tanaman'} · {profile.plantCatalog?.scientificName ?? ''}</p></div></div>
                    {canManage && canCreateVersion && <button type="button" onClick={() => { if (window.confirm('Buat draft baru dari versi tervalidasi terakhir?')) createVersion.mutate(); }} disabled={createVersion.isPending} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:border-emerald-500/40 disabled:opacity-50"><Plus className="h-4 w-4" /> {createVersion.isPending ? 'Membuat…' : 'Buat versi draft'}</button>}
                  </div>
                  <div className="mt-6 grid gap-3 border-t border-slate-800 pt-5 sm:grid-cols-3"><div><span className="text-[11px] uppercase tracking-wider text-slate-500">Katalog sumber</span><p className="mt-1 text-sm text-slate-200">{catalogQuery.data?.commonName ?? profile.plantCatalog?.commonName ?? 'Tanaman'}</p></div><div><span className="text-[11px] uppercase tracking-wider text-slate-500">Versi sumber saat ini</span><p className="mt-1 text-sm text-slate-300">{latestCatalogSource ? `v${latestCatalogSource.version} · ${latestCatalogSource.status}` : latest?.sourceCatalogVersionId ?? 'Belum ada versi sumber'}</p></div><div><span className="text-[11px] uppercase tracking-wider text-slate-500">Organisasi</span><p className="mt-1 text-sm text-slate-200">{currentOrg?.name}</p></div></div>
                </header>

                {canManage && canCreateVersion && catalogQuery.isSuccess && availableCatalogVersions.length > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-5 sm:flex-row sm:items-end sm:justify-between"><div className="flex-1"><h2 className="font-semibold text-sky-100">Adopsi versi katalog baru</h2><p className="mt-1 text-xs text-slate-400">Membuat draft baru dengan konfigurasi organisasi yang diturunkan dari versi tervalidasi terakhir.</p><select value={adoptionVersionId} onChange={(event) => setAdoptionVersionId(event.target.value)} className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"><option value="">Pilih versi katalog</option>{availableCatalogVersions.map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.status} · {version.id.slice(0, 8)}</option>)}</select></div><button type="button" disabled={!adoptionVersionId || adoptVersion.isPending} onClick={() => { if (adoptionVersionId && window.confirm('Adopsi versi katalog ini dan buat draft profil baru?')) adoptVersion.mutate(adoptionVersionId); }} className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">{adoptVersion.isPending ? 'Mengadopsi…' : 'Adopsi versi'}</button></section>}

                {(actionError || validationNotice) && <div role={actionError ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${actionError ? 'border-rose-500/25 bg-rose-500/10 text-rose-200' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'}`}>{actionError || validationNotice}</div>}

                <PlantProfileVersionDiff versions={versions} />

                <section className="space-y-4"><div><h2 className="text-lg font-semibold text-white">Riwayat versi</h2><p className="mt-1 text-sm text-slate-400">Versi terbaru ditampilkan lebih dahulu. Perubahan hanya tersedia pada DRAFT.</p></div>
                  {!versions.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-sm text-slate-400">Profil belum memiliki versi.</div> : versions.map((version) => {
                    const isDraft = version.status === 'DRAFT';
                    const stages = version.growthStages ?? [];
                    const sourceVersion = catalogQuery.data?.versions?.find((catalogVersion) => catalogVersion.id === version.sourceCatalogVersionId);
                    return <article key={version.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
                      <div className="flex flex-col gap-3 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-100">Versi {version.version}</h3><span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyle(version.status)}`}>{version.status}</span></div><p className="mt-1 break-all font-mono text-[11px] text-slate-500">Sumber katalog: {sourceVersion ? `v${sourceVersion.version} · ${sourceVersion.status}` : version.sourceCatalogVersionId}{version.adoptedFromVersionId ? ` · adopsi dari versi profil ${version.adoptedFromVersionId.slice(0, 8)}` : ''}</p><p className="mt-1 text-xs text-slate-500">Schema {version.configSchemaVersion} · {version.checksum ? `Checksum ${version.checksum.slice(0, 14)}…` : 'Belum tervalidasi'}</p></div>
                        {canManage && isDraft && <button type="button" onClick={() => { setActionError(''); setValidationNotice(''); validateVersion.mutate(version.id); }} disabled={validateVersion.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{validateVersion.isPending && validateVersion.variables === version.id ? 'Memvalidasi…' : 'Validasi versi'}</button>}
                      </div>
                      <div className="space-y-4 p-5"><div className="flex items-center justify-between"><div><h4 className="text-sm font-medium text-slate-200">Growth stages</h4><p className="text-xs text-slate-500">{stages.length} stage</p></div>{!canManage && <span className="text-xs text-slate-500">Akses baca</span>}</div>
                        {!stages.length ? <p className="rounded-lg bg-slate-950/50 p-4 text-sm text-slate-500">Belum ada growth stage.</p> : <div className="space-y-3">{stages.map((stage) => <div key={stage.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-800 font-mono text-xs text-slate-300">{stage.sequence}</span><h5 className="font-medium text-slate-100">{stage.label}</h5><span className="font-mono text-xs text-slate-500">{stage.code}</span></div><p className="mt-2 break-all font-mono text-[11px] text-slate-500">Config: {JSON.stringify(stage.parameterConfig?.config ?? {})}</p></div>{canManage && isDraft && <button type="button" onClick={() => beginEdit(stage)} className="self-start rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Edit stage</button>}</div>
                              {editingStageId === stage.id && isDraft && canManage && <form onSubmit={(event) => submitStageUpdate(event, stage.id)} className="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2"><label className="space-y-1 text-xs text-slate-300">Kode<input required value={stageForm.code} onChange={(e) => setStageForm({ ...stageForm, code: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Label<input required value={stageForm.label} onChange={(e) => setStageForm({ ...stageForm, label: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Urutan<input required type="number" min="1" step="1" value={stageForm.sequence} onChange={(e) => setStageForm({ ...stageForm, sequence: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300 sm:col-span-2">Config (JSON object)<textarea rows={4} value={stageForm.config} onChange={(e) => setStageForm({ ...stageForm, config: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white" /></label>{stageError && <p role="alert" className="sm:col-span-2 text-sm text-rose-300">{stageError}</p>}<div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => { setEditingStageId(null); setStageError(''); }} className="rounded-lg px-3 py-2 text-sm text-slate-400">Batal</button><button disabled={updateStage.isPending} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />Simpan</button></div></form>}
                            </div>)}</div>}

                        {canManage && isDraft && <form onSubmit={(event) => submitStage(event, version.id)} className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:grid-cols-2"><div className="sm:col-span-2"><h4 className="text-sm font-semibold text-emerald-200">Tambah growth stage</h4></div><label className="space-y-1 text-xs text-slate-300">Kode<input required value={stageForm.code} onChange={(e) => setStageForm({ ...stageForm, code: e.target.value })} placeholder="flowering" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Label<input required value={stageForm.label} onChange={(e) => setStageForm({ ...stageForm, label: e.target.value })} placeholder="Pembungaan" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Urutan<input required type="number" min="1" step="1" value={stageForm.sequence} onChange={(e) => setStageForm({ ...stageForm, sequence: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300 sm:col-span-2">Config (JSON object)<textarea rows={4} value={stageForm.config} onChange={(e) => setStageForm({ ...stageForm, config: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white" /></label>{stageError && !editingStageId && <p role="alert" className="sm:col-span-2 text-sm text-rose-300">{stageError}</p>}<button disabled={createStage.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{createStage.isPending ? 'Menambahkan…' : 'Tambah stage'}</button></form>}
                        {isDraft && !stages.length && <p className="inline-flex items-center gap-2 text-xs text-amber-300"><Clock3 className="h-3.5 w-3.5" /> Minimal satu stage wajib ada sebelum validasi.</p>}
                      </div>
                    </article>;
                  })}
                </section>
                <div className="flex items-center gap-2 text-xs text-slate-500"><Sprout className="h-3.5 w-3.5" /> Tidak ada aksi assignment zona pada halaman ini.</div>
              </> : null}
      </div>
    </DashboardLayout>
  );
}
