'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Leaf, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';
import type { CreatePlantCatalogVersionDto, CreatePlantParameterDefinitionDto, PlantCatalogVersion, PlantJsonObject, PlantParameterDefinition, UpdatePlantCatalogVersionDto, UpdatePlantParameterDefinitionDto } from '@/types';

function apiError(error: unknown): { message: string; status?: number } {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401) return { status, message: 'Sesi tidak valid. Silakan masuk kembali.' };
  if (status === 403) return { status, message: 'Server menolak aksi ini. Kapabilitas platform aktif diperlukan.' };
  if (status === 404) return { status, message: 'Katalog atau versi tidak ditemukan.' };
  if (status === 409) return { status, message: 'Perubahan ditolak karena konflik lifecycle atau versi sudah tidak dapat diedit.' };
  if (status === 400 || status === 422) return { status, message: (error as Error).message || 'Data tidak valid. Periksa kembali format dan batas parameter.' };
  return { status, message: (error as Error)?.message || 'Permintaan gagal. Silakan coba lagi.' };
}

function parseJsonObject(source: string, fieldName: string): PlantJsonObject {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${fieldName} harus berupa JSON object.`);
  return value as PlantJsonObject;
}

type ParameterForm = {
  parameterKey: string;
  label: string;
  dataType: string;
  unit: string;
  valueSchema: string;
  metadataSchema: string;
};

const blankParameter: ParameterForm = { parameterKey: '', label: '', dataType: 'number', unit: '', valueSchema: '{\n  "type": "number"\n}', metadataSchema: '{}' };

export default function PlantCatalogDetailPage() {
  const { currentOrg, currentMembership } = useAuth();
  const params = useParams<{ catalogId: string }>();
  const catalogId = Array.isArray(params.catalogId) ? params.catalogId[0] : params.catalogId;
  const queryClient = useQueryClient();
  const [versionError, setVersionError] = useState('');
  const [versionDefaults, setVersionDefaults] = useState('{}');
  const [stageTemplates, setStageTemplates] = useState('[]');
  const [edgeCompatibility, setEdgeCompatibility] = useState('{}');
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [draftDefaults, setDraftDefaults] = useState('{}');
  const [draftStageTemplates, setDraftStageTemplates] = useState('[]');
  const [draftEdgeCompatibility, setDraftEdgeCompatibility] = useState('{}');
  const [draftConfigError, setDraftConfigError] = useState('');
  const [parameterVersionId, setParameterVersionId] = useState<string | null>(null);
  const [parameterForm, setParameterForm] = useState<ParameterForm>(blankParameter);
  const [editingParameter, setEditingParameter] = useState<PlantParameterDefinition | null>(null);
  const [parameterError, setParameterError] = useState('');

  const organizationId = currentOrg?.id;
  const canAdminister = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const catalogQuery = useQuery({
    queryKey: ['plant-catalog', organizationId, catalogId],
    queryFn: () => apiClient.getPlantCatalogItem(organizationId!, catalogId),
    enabled: Boolean(organizationId && catalogId),
  });

  const invalidateCatalogs = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['plant-catalog'] }),
      queryClient.invalidateQueries({ queryKey: ['plant-catalog', catalogId] }),
    ]);
  };

  const createVersion = useMutation({
    mutationFn: (payload: CreatePlantCatalogVersionDto) => apiClient.createPlantCatalogVersion(organizationId!, catalogId, payload),
    onSuccess: async () => { setVersionError(''); await invalidateCatalogs(); },
    onError: (error) => setVersionError(apiError(error).message),
  });
  const createParameter = useMutation({
    mutationFn: ({ versionId, payload }: { versionId: string; payload: CreatePlantParameterDefinitionDto }) => apiClient.createPlantParameterDefinition(organizationId!, versionId, payload),
    onSuccess: async () => { setParameterError(''); setParameterForm(blankParameter); setParameterVersionId(null); await invalidateCatalogs(); },
    onError: (error) => setParameterError(apiError(error).message),
  });
  const updateParameter = useMutation({
    mutationFn: ({ versionId, parameterId, payload }: { versionId: string; parameterId: string; payload: UpdatePlantParameterDefinitionDto }) => apiClient.updatePlantParameterDefinition(organizationId!, versionId, parameterId, payload),
    onSuccess: async () => { setParameterError(''); setEditingParameter(null); await invalidateCatalogs(); },
    onError: (error) => setParameterError(apiError(error).message),
  });
  const deleteParameter = useMutation({
    mutationFn: ({ versionId, parameterId }: { versionId: string; parameterId: string }) => apiClient.deletePlantParameterDefinition(organizationId!, versionId, parameterId),
    onSuccess: invalidateCatalogs,
    onError: (error) => setParameterError(apiError(error).message),
  });
  const publishVersion = useMutation({
    mutationFn: (versionId: string) => apiClient.publishPlantCatalogVersion(organizationId!, versionId),
    onSuccess: async () => { await invalidateCatalogs(); await queryClient.invalidateQueries({ queryKey: ['plant-catalog'] }); },
  });
  const updateVersion = useMutation({
    mutationFn: ({ versionId, payload }: { versionId: string; payload: UpdatePlantCatalogVersionDto }) => apiClient.updatePlantCatalogVersion(organizationId!, versionId, payload),
    onSuccess: async () => { setEditingVersionId(null); setDraftConfigError(''); await invalidateCatalogs(); },
    onError: (error) => setDraftConfigError(apiError(error).message),
  });

  const versions = useMemo(() => catalogQuery.data?.versions ?? [], [catalogQuery.data?.versions]);

  function submitVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVersionError('');
    try {
      const defaults = parseJsonObject(versionDefaults, 'Defaults');
      const templates: unknown = JSON.parse(stageTemplates);
      if (!Array.isArray(templates)) throw new Error('Stage templates harus berupa JSON array.');
      const edge = parseJsonObject(edgeCompatibility, 'Edge compatibility');
      createVersion.mutate({ profileDefaults: defaults, stageTemplates: templates as CreatePlantCatalogVersionDto['stageTemplates'], edgeCompatibility: edge });
    } catch (error) {
      setVersionError((error as Error).message || 'Format JSON tidak valid.');
    }
  }

  function beginEditingVersion(version: PlantCatalogVersion) {
    setEditingVersionId(version.id);
    setDraftDefaults(JSON.stringify(version.profileDefaults ?? {}, null, 2));
    setDraftStageTemplates(JSON.stringify(version.stageTemplates ?? [], null, 2));
    setDraftEdgeCompatibility(JSON.stringify(version.edgeCompatibility ?? {}, null, 2));
    setDraftConfigError('');
  }

  function submitVersionUpdate(event: FormEvent<HTMLFormElement>, versionId: string) {
    event.preventDefault();
    setDraftConfigError('');
    try {
      const defaults = parseJsonObject(draftDefaults, 'Profile defaults');
      const templates: unknown = JSON.parse(draftStageTemplates);
      if (!Array.isArray(templates)) throw new Error('Stage templates harus berupa JSON array.');
      const edge = parseJsonObject(draftEdgeCompatibility, 'Edge compatibility');
      updateVersion.mutate({
        versionId,
        payload: {
          profileDefaults: defaults,
          stageTemplates: templates as UpdatePlantCatalogVersionDto['stageTemplates'],
          edgeCompatibility: edge,
        },
      });
    } catch (error) {
      setDraftConfigError((error as Error).message || 'Format JSON tidak valid.');
    }
  }

  function submitParameter(event: FormEvent<HTMLFormElement>, versionId: string) {
    event.preventDefault();
    setParameterError('');
    try {
      const payload: CreatePlantParameterDefinitionDto = {
        parameterKey: parameterForm.parameterKey.trim(),
        label: parameterForm.label.trim(),
        dataType: parameterForm.dataType.trim(),
        unit: parameterForm.unit.trim() || undefined,
        valueSchema: parseJsonObject(parameterForm.valueSchema, 'Value schema'),
        metadataSchema: parseJsonObject(parameterForm.metadataSchema, 'Metadata schema'),
      };
      createParameter.mutate({ versionId, payload });
    } catch (error) {
      setParameterError((error as Error).message || 'Format JSON tidak valid.');
    }
  }

  function startEditing(parameter: PlantParameterDefinition) {
    setEditingParameter(parameter);
    setParameterForm({ parameterKey: parameter.parameterKey, label: parameter.label, dataType: parameter.dataType, unit: parameter.unit ?? '', valueSchema: JSON.stringify(parameter.valueSchema, null, 2), metadataSchema: JSON.stringify(parameter.metadataSchema, null, 2) });
    setParameterError('');
  }

  function submitParameterUpdate(event: FormEvent<HTMLFormElement>, versionId: string) {
    event.preventDefault();
    if (!editingParameter) return;
    setParameterError('');
    try {
      const payload: UpdatePlantParameterDefinitionDto = {
        parameterKey: parameterForm.parameterKey.trim(), label: parameterForm.label.trim(), dataType: parameterForm.dataType.trim(),
        unit: parameterForm.unit.trim() || null,
        valueSchema: parseJsonObject(parameterForm.valueSchema, 'Value schema'),
        metadataSchema: parseJsonObject(parameterForm.metadataSchema, 'Metadata schema'),
      };
      updateParameter.mutate({ versionId, parameterId: editingParameter.id, payload });
    } catch (error) {
      setParameterError((error as Error).message || 'Format JSON tidak valid.');
    }
  }

  const isLoading = !organizationId || catalogQuery.isLoading;
  const readError = catalogQuery.isError ? apiError(catalogQuery.error) : null;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/plant-catalog" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-emerald-300"><ArrowLeft className="h-4 w-4" /> Kembali ke katalog</Link>
        {isLoading ? (
          <div className="space-y-4" aria-label="Memuat detail katalog"><div className="h-8 w-64 animate-pulse rounded bg-slate-800" /><div className="h-40 animate-pulse rounded-2xl bg-slate-900" /></div>
        ) : readError ? (
          <section role="alert" className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-8"><h1 className="text-lg font-semibold text-rose-200">Detail katalog tidak tersedia</h1><p className="mt-2 text-sm text-rose-100/80">{readError.message}</p><button onClick={() => void catalogQuery.refetch()} className="mt-4 rounded-lg border border-rose-300/20 px-3 py-2 text-sm text-rose-100">Coba lagi</button></section>
        ) : catalogQuery.data ? (
          <>
            <header className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
              <div className="flex items-start gap-4"><span className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-400"><Leaf className="h-6 w-6" /></span><div><span className="font-mono text-xs uppercase tracking-wider text-emerald-300">{catalogQuery.data.code} · {catalogQuery.data.status}</span><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{catalogQuery.data.commonName}</h1><p className="mt-2 text-sm italic text-slate-400">{catalogQuery.data.scientificName}{catalogQuery.data.cultivar ? ` · ${catalogQuery.data.cultivar}` : ''}</p></div></div>
              {canAdminister && <span className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300"><Check className="h-3.5 w-3.5" /> Kapabilitas admin aktif</span>}
            </header>

            {canAdminister && (
              <form onSubmit={submitVersion} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
                <div><h2 className="font-semibold text-white">Buat draft version</h2><p className="mt-1 text-xs text-slate-400">Profile defaults dan setiap config stage hanya menerima parameterKey yang sudah didefinisikan. Template memakai code, label, sequence, dan config. Edge compatibility hanya menerima mode, controller, schema_version, dan actuator_commands_enabled (false).</p></div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <label className="space-y-1.5 text-xs text-slate-300">Profile defaults (JSON object)<textarea value={versionDefaults} onChange={(e) => setVersionDefaults(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500" /></label>
                  <label className="space-y-1.5 text-xs text-slate-300">Stage templates (JSON array)<textarea value={stageTemplates} onChange={(e) => setStageTemplates(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500" /></label>
                  <label className="space-y-1.5 text-xs text-slate-300">Edge compatibility (JSON object)<textarea value={edgeCompatibility} onChange={(e) => setEdgeCompatibility(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500" /></label>
                </div>
                {versionError && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{versionError}</p>}
                <button disabled={createVersion.isPending} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"><Plus className="h-4 w-4" />{createVersion.isPending ? 'Membuat draft…' : 'Buat draft version'}</button>
              </form>
            )}

            <section className="space-y-4">
              <div className="flex items-end justify-between"><div><h2 className="text-lg font-semibold text-white">Versi katalog</h2><p className="mt-1 text-sm text-slate-400">{canAdminister ? 'Termasuk draft untuk pengelola platform.' : 'Hanya versi terbit yang dibagikan backend.'}</p></div><span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">{versions.length} versi</span></div>
              {!versions.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-400">Belum ada versi katalog.</div> : versions.map((version) => {
                const isDraft = version.status === 'DRAFT';
                return <article key={version.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
                  <div className="flex flex-col gap-3 border-b border-slate-800 p-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-100">Versi {version.version}</h3><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${isDraft ? 'bg-amber-500/10 text-amber-300' : version.status === 'PUBLISHED' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{version.status}</span></div><p className="mt-1 text-xs text-slate-500">Schema {version.configSchemaVersion} · {version.checksum ? `SHA checksum ${version.checksum.slice(0, 12)}…` : 'Belum memiliki checksum'}</p></div>
                    {canAdminister && isDraft && <div className="flex gap-2"><button type="button" onClick={() => beginEditingVersion(version)} className="rounded-lg border border-slate-700 px-3.5 py-2 text-sm text-slate-200 hover:border-emerald-500/40">Edit konfigurasi</button><button onClick={() => { if (window.confirm(`Publikasikan versi ${version.version}? Setelah dipublikasikan, versi menjadi immutable.`)) publishVersion.mutate(version.id); }} disabled={publishVersion.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"><Check className="h-4 w-4" />{publishVersion.isPending && publishVersion.variables === version.id ? 'Menerbitkan…' : 'Publish'}</button></div>}
                  </div>
                  {publishVersion.isError && publishVersion.variables === version.id && <p role="alert" className="border-b border-rose-500/20 bg-rose-500/10 px-5 py-3 text-sm text-rose-300">{apiError(publishVersion.error).message}</p>}
                  {editingVersionId === version.id && isDraft && canAdminister && <form onSubmit={(event) => submitVersionUpdate(event, version.id)} className="grid gap-4 border-b border-slate-800 bg-slate-950/50 p-5 lg:grid-cols-3"><label className="space-y-1.5 text-xs text-slate-300">Profile defaults (JSON object)<textarea value={draftDefaults} onChange={(event) => setDraftDefaults(event.target.value)} rows={8} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200" /></label><label className="space-y-1.5 text-xs text-slate-300">Stage templates (JSON array; code, label, sequence, config)<textarea value={draftStageTemplates} onChange={(event) => setDraftStageTemplates(event.target.value)} rows={8} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200" /></label><label className="space-y-1.5 text-xs text-slate-300">Edge compatibility (JSON object; mode, controller, schema_version, actuator_commands_enabled=false)<textarea value={draftEdgeCompatibility} onChange={(event) => setDraftEdgeCompatibility(event.target.value)} rows={8} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200" /></label>{draftConfigError && <p role="alert" className="lg:col-span-3 text-sm text-rose-300">{draftConfigError}</p>}<div className="flex justify-end gap-2 lg:col-span-3"><button type="button" onClick={() => { setEditingVersionId(null); setDraftConfigError(''); }} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Batal</button><button disabled={updateVersion.isPending} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{updateVersion.isPending ? 'Menyimpan…' : 'Simpan draft'}</button></div></form>}
                  <div className="space-y-4 p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-sm font-medium text-slate-200">Parameter definitions</h4><p className="text-xs text-slate-500">{version.parameterDefinitions?.length ?? 0} parameter</p></div>{canAdminister && isDraft && <button onClick={() => { setParameterVersionId(parameterVersionId === version.id ? null : version.id); setEditingParameter(null); setParameterForm(blankParameter); setParameterError(''); }} className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:border-emerald-500/40 hover:text-emerald-300"><Plus className="h-3.5 w-3.5" /> Tambah parameter</button>}</div>
                    {(version.parameterDefinitions ?? []).length === 0 ? <p className="rounded-lg bg-slate-950/50 p-4 text-sm text-slate-500">Belum ada parameter dalam versi ini.</p> : <div className="space-y-2">{version.parameterDefinitions?.map((parameter) => <div key={parameter.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm text-emerald-300">{parameter.parameterKey}</span><span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-400">{parameter.dataType}</span></div><p className="mt-1 text-sm text-slate-200">{parameter.label}{parameter.unit ? <span className="text-slate-500"> · {parameter.unit}</span> : ''}</p><p className="mt-1 truncate font-mono text-[11px] text-slate-500">{JSON.stringify(parameter.valueSchema)}</p></div>{canAdminister && isDraft && <div className="flex gap-2"><button onClick={() => startEditing(parameter)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">Ubah</button><button onClick={() => { if (window.confirm(`Hapus parameter ${parameter.parameterKey}?`)) deleteParameter.mutate({ versionId: version.id, parameterId: parameter.id }); }} disabled={deleteParameter.isPending} aria-label={`Hapus ${parameter.parameterKey}`} className="rounded-lg border border-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/10 disabled:opacity-60"><Trash2 className="h-4 w-4" /></button></div>}</div>)}</div>}
                    {parameterVersionId === version.id && isDraft && canAdminister && <form onSubmit={(event) => submitParameter(event, version.id)} className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 md:grid-cols-2"><div className="md:col-span-2"><h5 className="text-sm font-semibold text-emerald-200">Parameter baru</h5></div><label className="space-y-1 text-xs text-slate-300">Key<input required maxLength={64} value={parameterForm.parameterKey} onChange={(e) => setParameterForm({ ...parameterForm, parameterKey: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Label<input required maxLength={128} value={parameterForm.label} onChange={(e) => setParameterForm({ ...parameterForm, label: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Data type<input required maxLength={16} value={parameterForm.dataType} onChange={(e) => setParameterForm({ ...parameterForm, dataType: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Unit<input maxLength={64} value={parameterForm.unit} onChange={(e) => setParameterForm({ ...parameterForm, unit: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Value schema (JSON)<textarea required rows={5} value={parameterForm.valueSchema} onChange={(e) => setParameterForm({ ...parameterForm, valueSchema: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white" /></label><label className="space-y-1 text-xs text-slate-300">Metadata schema (JSON)<textarea rows={5} value={parameterForm.metadataSchema} onChange={(e) => setParameterForm({ ...parameterForm, metadataSchema: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white" /></label>{parameterError && <p role="alert" className="md:col-span-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{parameterError}</p>}<div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => { setParameterVersionId(null); setParameterError(''); }} className="rounded-lg px-3 py-2 text-sm text-slate-400">Batal</button><button disabled={createParameter.isPending} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{createParameter.isPending ? 'Menyimpan…' : 'Simpan parameter'}</button></div></form>}
                    {editingParameter && editingParameter.plantCatalogVersionId === version.id && isDraft && <form onSubmit={(event) => submitParameterUpdate(event, version.id)} className="grid gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 md:grid-cols-2"><div className="md:col-span-2"><h5 className="text-sm font-semibold text-sky-200">Ubah {editingParameter.parameterKey}</h5></div><label className="space-y-1 text-xs text-slate-300">Key<input required maxLength={64} value={parameterForm.parameterKey} onChange={(e) => setParameterForm({ ...parameterForm, parameterKey: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Label<input required maxLength={128} value={parameterForm.label} onChange={(e) => setParameterForm({ ...parameterForm, label: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Data type<input required maxLength={16} value={parameterForm.dataType} onChange={(e) => setParameterForm({ ...parameterForm, dataType: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Unit<input maxLength={64} value={parameterForm.unit} onChange={(e) => setParameterForm({ ...parameterForm, unit: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label><label className="space-y-1 text-xs text-slate-300">Value schema (JSON)<textarea required rows={5} value={parameterForm.valueSchema} onChange={(e) => setParameterForm({ ...parameterForm, valueSchema: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white" /></label><label className="space-y-1 text-xs text-slate-300">Metadata schema (JSON)<textarea rows={5} value={parameterForm.metadataSchema} onChange={(e) => setParameterForm({ ...parameterForm, metadataSchema: e.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white" /></label>{parameterError && <p role="alert" className="md:col-span-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{parameterError}</p>}<div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => { setEditingParameter(null); setParameterError(''); }} className="rounded-lg px-3 py-2 text-sm text-slate-400">Batal</button><button disabled={updateParameter.isPending} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"><Save className="h-4 w-4" />{updateParameter.isPending ? 'Menyimpan…' : 'Simpan perubahan'}</button></div></form>}
                    {parameterError && !parameterVersionId && !editingParameter && <p role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{parameterError}</p>}
                  </div>
                </article>;
              })}
            </section>
            <div className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="h-3.5 w-3.5" /> Perubahan draft disimpan oleh backend; versi published tidak dapat diubah.</div>
          </>
        ) : <p className="text-slate-400">Katalog tidak tersedia.</p>}
      </div>
    </DashboardLayout>
  );
}
