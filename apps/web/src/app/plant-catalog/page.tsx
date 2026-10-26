'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Leaf, Plus, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';
import type { CreatePlantCatalogDto } from '@/types';

function errorMessage(error: unknown): string {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401) return 'Sesi tidak valid. Silakan masuk kembali.';
  if (status === 403) return 'Akses katalog ditolak oleh server.';
  if (status === 404) return 'Katalog tidak ditemukan.';
  if (status === 409) return 'Data bertentangan dengan katalog atau lifecycle yang ada.';
  if (status === 400 || status === 422) return (error as Error).message || 'Periksa kembali data yang dimasukkan.';
  return (error as Error)?.message || 'Katalog gagal dimuat. Coba lagi.';
}

export default function PlantCatalogPage() {
  const { currentOrg, currentMembership } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<CreatePlantCatalogDto>({ code: '', scientificName: '', commonName: '', cultivar: '' });

  const organizationId = currentOrg?.id;
  const canAdminister = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const catalogQuery = useQuery({
    queryKey: ['plant-catalog', organizationId],
    queryFn: () => apiClient.getPlantCatalog(organizationId!),
    enabled: Boolean(organizationId),
  });

  const createCatalog = useMutation({
    mutationFn: (payload: CreatePlantCatalogDto) => apiClient.createPlantCatalog(organizationId!, payload),
    onSuccess: async (catalog) => {
      await queryClient.invalidateQueries({ queryKey: ['plant-catalog'] });
      setForm({ code: '', scientificName: '', commonName: '', cultivar: '' });
      setFormError('');
      setIsCreating(false);
      router.push(`/plant-catalog/${encodeURIComponent(catalog.id)}`);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    createCatalog.mutate({ ...form, cultivar: form.cultivar?.trim() || undefined });
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400">
              <Leaf className="h-4 w-4" /> Plant Standardization
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Katalog tanaman</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">Referensi global tanaman dan versi konfigurasi yang telah dipublikasikan.</p>
          </div>
          {canAdminister && (
            <button type="button" onClick={() => setIsCreating((value) => !value)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-500">
              <Plus className="h-4 w-4" /> Buat katalog
            </button>
          )}
        </header>

        {!organizationId && <div role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Pilih organisasi untuk mengelola katalog tanaman.</div>}

        {isCreating && canAdminister && (
          <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h2 className="font-semibold text-white">Katalog baru</h2>
              <p className="mt-1 text-xs text-slate-400">Katalog akan dibuat melalui endpoint administrasi backend.</p>
            </div>
            <label className="space-y-1.5 text-xs text-slate-300">Nama umum
              <input required value={form.commonName} onChange={(event) => setForm({ ...form, commonName: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500" />
            </label>
            <label className="space-y-1.5 text-xs text-slate-300">Nama ilmiah
              <input required value={form.scientificName} onChange={(event) => setForm({ ...form, scientificName: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500" />
            </label>
            <label className="space-y-1.5 text-xs text-slate-300">Kode
              <input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500" />
            </label>
            <label className="space-y-1.5 text-xs text-slate-300">Cultivar <span className="text-slate-500">(opsional)</span>
              <input value={form.cultivar} onChange={(event) => setForm({ ...form, cultivar: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500" />
            </label>
            {formError && <p role="alert" className="sm:col-span-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{formError}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => { setIsCreating(false); setFormError(''); }} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Batal</button>
              <button disabled={createCatalog.isPending} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{createCatalog.isPending ? 'Menyimpan…' : 'Simpan katalog'}</button>
            </div>
          </form>
        )}

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          {catalogQuery.isLoading ? (
            <div className="space-y-3 p-6" aria-label="Memuat katalog"><div className="h-5 w-40 animate-pulse rounded bg-slate-800" /><div className="h-16 animate-pulse rounded-xl bg-slate-800/70" /><div className="h-16 animate-pulse rounded-xl bg-slate-800/70" /></div>
          ) : catalogQuery.isError ? (
            <div role="alert" className="p-8 text-center"><p className="font-semibold text-rose-300">Katalog tidak dapat dimuat</p><p className="mt-2 text-sm text-slate-400">{errorMessage(catalogQuery.error)}</p><button onClick={() => void catalogQuery.refetch()} className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Coba lagi</button></div>
          ) : catalogQuery.data?.length ? (
            <div className="divide-y divide-slate-800/80">
              {catalogQuery.data.map((catalog) => {
                const latest = catalog.versions?.[0];
                return <Link key={catalog.id} href={`/plant-catalog/${encodeURIComponent(catalog.id)}`} className="group flex flex-col gap-3 p-5 transition hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="flex min-w-0 items-start gap-4">
                    <span className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-400"><Leaf className="h-5 w-5" /></span>
                    <span className="min-w-0"><span className="block truncate font-semibold text-slate-100 group-hover:text-emerald-300">{catalog.commonName}</span><span className="mt-1 block text-sm italic text-slate-400">{catalog.scientificName}{catalog.cultivar ? ` · ${catalog.cultivar}` : ''}</span><span className="mt-2 inline-flex rounded-md bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-400">{catalog.code}</span></span>
                  </div>
                  <span className="flex items-center gap-3 pl-[4.25rem] text-xs text-slate-400 sm:pl-0"><span>{latest ? `v${latest.version} · ${latest.status}` : 'Belum ada versi publik'}</span><ArrowUpRight className="h-4 w-4 text-slate-500 transition group-hover:text-emerald-400" /></span>
                </Link>;
              })}
            </div>
          ) : (
            <div className="px-6 py-16 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/70 text-slate-400"><Leaf className="h-5 w-5" /></span><h2 className="mt-4 font-semibold text-slate-100">Katalog masih kosong</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Belum ada katalog aktif dengan versi yang dipublikasikan.</p>{canAdminister && <p className="mt-4 inline-flex items-center gap-2 text-xs text-emerald-300"><ShieldCheck className="h-4 w-4" /> Kapabilitas admin aktif</p>}</div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
