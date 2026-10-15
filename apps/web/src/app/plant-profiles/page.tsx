'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Leaf, Plus, Sprout } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';
import type { CreatePlantProfileDto } from '@/types';

function messageFor(error: unknown): string {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401) return 'Sesi tidak valid. Silakan masuk kembali.';
  if (status === 403) return 'Anda tidak memiliki akses ke organisasi ini atau role OWNER/ADMIN diperlukan untuk mengubah profil.';
  if (status === 404) return 'Profil, organisasi, atau versi katalog tidak ditemukan.';
  if (status === 409) return 'Aksi bertentangan dengan status lifecycle profil saat ini.';
  if (status === 400 || status === 422) return (error as Error).message || 'Data profil tidak valid.';
  return (error as Error)?.message || 'Permintaan gagal. Silakan coba lagi.';
}

export default function PlantProfilesPage() {
  const { currentOrg, currentMembership } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState('');
  const [catalogVersionId, setCatalogVersionId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [stageCode, setStageCode] = useState('seedling');
  const [stageLabel, setStageLabel] = useState('Bibit');
  const canManage = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const organizationId = currentOrg?.id;

  const profilesQuery = useQuery({
    queryKey: ['plant-profiles', organizationId],
    queryFn: () => apiClient.getPlantProfiles(organizationId!),
    enabled: Boolean(organizationId),
  });
  const catalogQuery = useQuery({
    queryKey: ['plant-catalog', 'profile-create'],
    queryFn: () => apiClient.getPlantCatalog(),
    enabled: Boolean(organizationId && canManage && showCreate),
  });
  const catalogVersions = useMemo(() => (catalogQuery.data ?? []).flatMap((catalog) =>
    (catalog.versions ?? []).map((version) => ({ catalog, version }))), [catalogQuery.data]);

  const createProfile = useMutation({
    mutationFn: (payload: CreatePlantProfileDto) => apiClient.createPlantProfile(organizationId!, payload),
    onSuccess: async (profile) => {
      await queryClient.invalidateQueries({ queryKey: ['plant-profiles', organizationId] });
      setShowCreate(false);
      setFormError('');
      router.push(`/plant-profiles/${encodeURIComponent(profile.id)}`);
    },
    onError: (error) => setFormError(messageFor(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (!organizationId || !catalogVersionId) {
      setFormError('Pilih versi katalog yang sudah dipublikasikan.');
      return;
    }
    if (!window.confirm(`Buat profil “${name}” pada organisasi ${currentOrg?.name}?`)) return;
    createProfile.mutate({
      catalogVersionId,
      code: code.trim(),
      name: name.trim(),
      stages: [{ code: stageCode.trim(), label: stageLabel.trim(), sequence: 1 }],
    });
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400"><Sprout className="h-4 w-4" /> Plant Standardization</div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Profil tanaman</h1>
            <p className="mt-2 text-sm text-slate-400">Profil dan versi konfigurasi untuk {currentOrg?.name ?? 'organisasi aktif'}.</p>
          </div>
          {canManage && organizationId && <button type="button" onClick={() => { setShowCreate((value) => !value); setFormError(''); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"><Plus className="h-4 w-4" /> Buat profil</button>}
        </header>

        {!organizationId ? <section className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-sm text-amber-200">Pilih organisasi untuk melihat profil tanaman.</section> : null}

        {showCreate && canManage && organizationId && <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
          <div><h2 className="font-semibold text-white">Profil baru</h2><p className="mt-1 text-xs text-slate-400">Profil dibuat dari versi katalog terbit dan dimulai pada status DRAFT.</p></div>
          {catalogQuery.isLoading ? <div className="h-12 animate-pulse rounded-lg bg-slate-800" /> : catalogQuery.isError ? <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">Katalog tidak dapat dimuat: {messageFor(catalogQuery.error)}</p> : catalogVersions.length === 0 ? <p className="rounded-lg bg-slate-950/60 p-3 text-sm text-slate-400">Belum ada versi katalog terbit yang dapat digunakan.</p> : <label className="block space-y-1.5 text-xs text-slate-300">Sumber katalog
            <select required value={catalogVersionId} onChange={(event) => setCatalogVersionId(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100">
              <option value="">Pilih tanaman dan versi terbit</option>
              {catalogVersions.map(({ catalog, version }) => <option key={version.id} value={version.id}>{catalog.commonName} · {catalog.scientificName} · v{version.version}</option>)}
            </select>
          </label>}
          <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1.5 text-xs text-slate-300">Kode profil<input required value={code} onChange={(event) => setCode(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100" /></label><label className="space-y-1.5 text-xs text-slate-300">Nama profil<input required value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100" /></label><label className="space-y-1.5 text-xs text-slate-300">Stage awal — kode<input required value={stageCode} onChange={(event) => setStageCode(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100" /></label><label className="space-y-1.5 text-xs text-slate-300">Stage awal — label<input required value={stageLabel} onChange={(event) => setStageLabel(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100" /></label></div>
          {formError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-300">{formError}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">Batal</button><button disabled={createProfile.isPending || !catalogVersions.length} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{createProfile.isPending ? 'Membuat…' : 'Buat profil'}</button></div>
        </form>}

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          {profilesQuery.isLoading && organizationId ? <div className="space-y-3 p-6" aria-label="Memuat profil"><div className="h-6 w-52 animate-pulse rounded bg-slate-800" /><div className="h-20 animate-pulse rounded-xl bg-slate-800/70" /></div>
            : profilesQuery.isError ? <div role="alert" className="p-8 text-center"><h2 className="font-semibold text-rose-300">Profil tidak dapat dimuat</h2><p className="mt-2 text-sm text-slate-400">{messageFor(profilesQuery.error)}</p><button onClick={() => void profilesQuery.refetch()} className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200">Coba lagi</button></div>
            : profilesQuery.data?.length ? <div className="divide-y divide-slate-800/80">{profilesQuery.data.map((profile) => {
              const latest = profile.versions?.[0];
              return <Link key={profile.id} href={`/plant-profiles/${encodeURIComponent(profile.id)}`} className="group flex flex-col gap-3 p-5 transition hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-start gap-4"><span className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-400"><Leaf className="h-5 w-5" /></span><span><span className="block font-semibold text-slate-100 group-hover:text-emerald-300">{profile.name}</span><span className="mt-1 block text-sm text-slate-400">{profile.plantCatalog?.commonName ?? 'Tanaman'} · {profile.plantCatalog?.scientificName ?? 'Nama ilmiah tidak tersedia'}</span><span className="mt-2 inline-flex rounded-md bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-400">{profile.code}</span></span></div><span className="flex items-center gap-3 pl-[4.25rem] text-xs text-slate-400 sm:pl-0"><span>{latest ? `v${latest.version} · ${latest.status}` : 'Belum ada versi'}</span><ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-400" /></span></Link>;
            })}</div>
              : organizationId && !profilesQuery.isLoading ? <div className="px-6 py-16 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/70 text-slate-400"><Sprout className="h-5 w-5" /></span><h2 className="mt-4 font-semibold text-slate-100">Belum ada profil tanaman</h2><p className="mt-2 text-sm text-slate-400">Profil aktif organisasi akan muncul di sini.</p></div> : null}
        </section>
      </div>
    </DashboardLayout>
  );
}
