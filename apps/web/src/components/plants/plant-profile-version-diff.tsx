'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PlantProfileVersion } from '@/types';
import { diffPlantProfileVersions, type VersionDiffKind } from '@/lib/plant-profile-version-diff';

type Props = {
  versions: PlantProfileVersion[];
  isLoading?: boolean;
  error?: string | null;
};

function display(value: unknown): string {
  if (value === undefined) return '—';
  const sortKeys = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sortKeys);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, nested]) => [key, sortKeys(nested)]));
    }
    return item;
  };
  const serialized = JSON.stringify(sortKeys(value), null, 2);
  return serialized === undefined ? String(value) : serialized;
}

const kindLabel: Record<VersionDiffKind, string> = {
  added: 'Ditambahkan',
  removed: 'Dihapus',
  changed: 'Berubah',
  invalid: 'Data tidak lengkap/valid',
};

export function PlantProfileVersionDiff({ versions, isLoading = false, error = null }: Props) {
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');

  useEffect(() => {
    setBeforeId((current) => versions.some((item) => item.id === current) ? current : versions[1]?.id ?? versions[0]?.id ?? '');
    setAfterId((current) => versions.some((item) => item.id === current) ? current : versions[0]?.id ?? '');
  }, [versions]);

  const before = versions.find((item) => item.id === beforeId);
  const after = versions.find((item) => item.id === afterId);
  const entries = useMemo(() => before && after && before.id !== after.id
    ? diffPlantProfileVersions(before, after)
    : [], [before, after]);

  if (isLoading) return <section aria-label="Perbandingan versi" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5"><h2 className="font-semibold text-white">Perbandingan versi</h2><p role="status" className="mt-3 text-sm text-slate-400">Memuat versi profil…</p></section>;
  if (error) return <section aria-label="Perbandingan versi" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5"><h2 className="font-semibold text-white">Perbandingan versi</h2><p role="alert" className="mt-3 text-sm text-rose-300">Versi profil gagal dimuat: {error}</p></section>;
  if (versions.length < 2) return <section aria-label="Perbandingan versi" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5"><h2 className="font-semibold text-white">Perbandingan versi</h2><p className="mt-3 text-sm text-slate-400">Perlu minimal dua versi profil untuk dibandingkan.</p></section>;

  return <section aria-label="Perbandingan versi" className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
    <div><h2 className="font-semibold text-white">Perbandingan versi</h2><p className="mt-1 text-xs text-slate-400">Konfigurasi profil dan growth stage dicocokkan secara struktural; stage menggunakan code, bukan posisi array.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-xs text-slate-300">Sebelum
        <select aria-label="Versi sebelum" value={beforeId} onChange={(event) => { if (event.target.value !== afterId) setBeforeId(event.target.value); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100">
          {versions.map((version) => <option key={version.id} value={version.id} disabled={version.id === afterId}>v{version.version} · {version.status}</option>)}
        </select>
      </label>
      <label className="space-y-1.5 text-xs text-slate-300">Sesudah
        <select aria-label="Versi sesudah" value={afterId} onChange={(event) => { if (event.target.value !== beforeId) setAfterId(event.target.value); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100">
          {versions.map((version) => <option key={version.id} value={version.id} disabled={version.id === beforeId}>v{version.version} · {version.status}</option>)}
        </select>
      </label>
    </div>
    {beforeId === afterId || !before || !after
      ? <p role="alert" className="text-sm text-amber-300">Pilih dua versi yang berbeda.</p>
      : entries.length === 0
        ? <p className="rounded-lg bg-slate-950/50 p-4 text-sm text-slate-400">Tidak ada perubahan atau data konfigurasi belum tersedia untuk dibandingkan.</p>
        : <div className="space-y-3" aria-live="polite">{entries.map((entry, index) => <article key={`${entry.section}:${entry.path}:${entry.kind}:${index}`} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">{entry.section}</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${entry.kind === 'invalid' ? 'bg-amber-500/10 text-amber-300' : 'bg-sky-500/10 text-sky-300'}`}>{kindLabel[entry.kind]}</span></div>
          <code className="mt-2 block break-all text-xs text-slate-200">{entry.path}</code>
          {entry.kind !== 'invalid' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><span className="text-[10px] uppercase tracking-wide text-slate-500">Before</span><pre className="mt-1 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-2 text-xs text-rose-200">{display(entry.before)}</pre></div><div><span className="text-[10px] uppercase tracking-wide text-slate-500">After</span><pre className="mt-1 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-2 text-xs text-emerald-200">{display(entry.after)}</pre></div></div>}
          {entry.kind === 'invalid' && <p className="mt-2 text-xs text-amber-200">Before: {display(entry.before)} · After: {display(entry.after)}</p>}
        </article>)}</div>}
  </section>;
}
