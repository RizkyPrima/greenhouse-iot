'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown, Layers, Plus, RefreshCw, ShieldCheck, Warehouse } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';
import type { EffectiveZonePlantConfig, PlantConfigAuditEvent, PlantJsonObject, PlantJsonValue, PlantParameterDefinition, PlantProfileVersion, ZonePlantAssignmentDetails } from '@/types';

type JsonSchemaShape = {
  type?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  enum?: unknown[];
  const?: unknown;
};

function apiError(error: unknown): { status?: number; message: string } {
  const status = (error as Error & { status?: number })?.status;
  if (status === 401) return { status, message: 'Sesi tidak valid. Silakan masuk kembali.' };
  if (status === 403) return { status, message: 'Akses ditolak. Membership organisasi dan role pengelola diperlukan untuk aksi ini.' };
  if (status === 404) return { status, message: 'Zona, assignment, atau profil tidak ditemukan dalam organisasi aktif.' };
  if (status === 409) return { status, message: 'Konflik assignment atau lifecycle. Muat ulang data zona dan coba lagi.' };
  if (status === 400 || status === 422) return { status, message: (error as Error).message || 'Konfigurasi tidak valid menurut batas parameter backend.' };
  return { status, message: (error as Error)?.message || 'Permintaan gagal. Silakan coba lagi.' };
}

function parseOverrideValue(definition: PlantParameterDefinition, raw: string, useNull: boolean): PlantJsonValue {
  if (useNull) {
    if (definition.metadataSchema.nullable !== true) throw new Error(`${definition.label} tidak mengizinkan nilai null.`);
    return null;
  }
  const schema = definition.valueSchema as JsonSchemaShape;
  let value: unknown;
  if (definition.dataType === 'number' || definition.dataType === 'integer') {
    if (!raw.trim()) throw new Error(`Nilai ${definition.label} wajib diisi.`);
    const numericValue = Number(raw);
    if (!Number.isFinite(numericValue)) throw new Error(`${definition.label} harus berupa angka yang valid.`);
    if (definition.dataType === 'integer' && !Number.isInteger(numericValue)) throw new Error(`${definition.label} harus berupa bilangan bulat.`);
    if (schema.minimum !== undefined && numericValue < schema.minimum) throw new Error(`${definition.label} minimal ${schema.minimum}.`);
    if (schema.maximum !== undefined && numericValue > schema.maximum) throw new Error(`${definition.label} maksimal ${schema.maximum}.`);
    if (schema.exclusiveMinimum !== undefined && numericValue <= schema.exclusiveMinimum) throw new Error(`${definition.label} harus lebih besar dari ${schema.exclusiveMinimum}.`);
    if (schema.exclusiveMaximum !== undefined && numericValue >= schema.exclusiveMaximum) throw new Error(`${definition.label} harus lebih kecil dari ${schema.exclusiveMaximum}.`);
    if (schema.multipleOf && Math.abs(numericValue / schema.multipleOf - Math.round(numericValue / schema.multipleOf)) > 1e-9) throw new Error(`${definition.label} harus kelipatan ${schema.multipleOf}.`);
    value = numericValue;
  } else if (definition.dataType === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new Error(`Pilih nilai untuk ${definition.label}.`);
    value = raw === 'true';
  } else if (definition.dataType === 'object' || definition.dataType === 'array') {
    try { value = JSON.parse(raw); } catch { throw new Error(`${definition.label} harus berisi JSON yang valid.`); }
    if (definition.dataType === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`${definition.label} harus berupa JSON object.`);
    if (definition.dataType === 'array' && !Array.isArray(value)) throw new Error(`${definition.label} harus berupa JSON array.`);
    if (Array.isArray(value) && schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${definition.label} minimal memiliki ${schema.minItems} item.`);
    if (Array.isArray(value) && schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${definition.label} maksimal memiliki ${schema.maxItems} item.`);
  } else {
    value = raw;
    if (!raw.trim()) throw new Error(`Nilai ${definition.label} wajib diisi.`);
    if (schema.minLength !== undefined && raw.length < schema.minLength) throw new Error(`${definition.label} minimal ${schema.minLength} karakter.`);
    if (schema.maxLength !== undefined && raw.length > schema.maxLength) throw new Error(`${definition.label} maksimal ${schema.maxLength} karakter.`);
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(raw)) throw new Error(`${definition.label} tidak sesuai pola yang ditentukan.`); }
      catch (error) { if (error instanceof Error && error.message.includes('tidak sesuai pola')) throw error; }
    }
  }
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) throw new Error(`${definition.label} harus menggunakan salah satu nilai yang diizinkan.`);
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) throw new Error(`${definition.label} harus sama dengan nilai yang ditentukan.`);
  return value as PlantJsonValue;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '';
  if (value !== null && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function statusClass(status: string): string {
  if (status === 'ACTIVE') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  if (status === 'ENDED') return 'border-slate-700 bg-slate-800 text-slate-300';
  return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
}

export default function PlantAssignmentsPage() {
  const { currentOrg, currentMembership } = useAuth();
  const organizationId = currentOrg?.id;
  const canManage = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [greenhouseId, setGreenhouseId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [stageId, setStageId] = useState('');
  const [viewAssignmentId, setViewAssignmentId] = useState('');
  const [actionError, setActionError] = useState('');
  const [overrideError, setOverrideError] = useState('');
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>({});
  const [overrideEnabled, setOverrideEnabled] = useState<Record<string, boolean>>({});
  const [overrideNulls, setOverrideNulls] = useState<Record<string, boolean>>({});
  const activationAttempt = useRef<{ signature: string; key: string } | null>(null);
  const deactivationKeys = useRef<Record<string, string>>({});

  const greenhousesQuery = useQuery({
    queryKey: ['greenhouses', organizationId],
    queryFn: () => apiClient.getGreenhouses(organizationId),
    enabled: Boolean(organizationId),
  });
  const greenhouseBelongsToCurrentOrg = greenhousesQuery.data?.some((greenhouse) => greenhouse.id === greenhouseId) ?? false;
  const zonesQuery = useQuery({
    queryKey: ['zones', organizationId, greenhouseId],
    queryFn: () => apiClient.getGreenhouseZones(greenhouseId),
    enabled: Boolean(organizationId && greenhouseId && greenhouseBelongsToCurrentOrg),
  });
  const zoneBelongsToCurrentGreenhouse = zonesQuery.data?.some((zone) => zone.id === zoneId) ?? false;
  const assignmentsQuery = useQuery({
    queryKey: ['zone-plant-assignments', organizationId, zoneId],
    queryFn: () => apiClient.getZonePlantAssignments(zoneId),
    enabled: Boolean(organizationId && zoneId && greenhouseBelongsToCurrentOrg && zoneBelongsToCurrentGreenhouse),
  });
  const profilesQuery = useQuery({
    queryKey: ['plant-profiles', organizationId],
    queryFn: () => apiClient.getPlantProfiles(organizationId!),
    enabled: Boolean(organizationId),
  });
  const auditQuery = useQuery({
    queryKey: ['plant-config-audit', organizationId],
    queryFn: () => apiClient.getPlantConfigAudit(organizationId!),
    enabled: Boolean(organizationId && canManage),
  });
  const activeAssignments = (assignmentsQuery.data ?? []).filter((assignment) => assignment.status === 'ACTIVE');
  const activeAssignment = activeAssignments[0];
  const shownAssignment = (assignmentsQuery.data ?? []).find((assignment) => assignment.id === viewAssignmentId) ?? activeAssignment;
  const currentOverride = activeAssignment?.overrides.find((override) => override.supersededAt === null) ?? null;

  const validatedChoices = useMemo(() => (profilesQuery.data ?? []).flatMap((profile) =>
    (profile.versions ?? []).filter((version) => version.status === 'VALIDATED').map((version) => ({ profile, version }))), [profilesQuery.data]);

  useEffect(() => {
    setGreenhouseId('');
    setZoneId('');
    setVersionId('');
    setStageId('');
    setViewAssignmentId('');
    setActionError('');
  }, [organizationId]);
  useEffect(() => {
    if (!greenhouseId && greenhousesQuery.data?.[0]) setGreenhouseId(greenhousesQuery.data[0].id);
    if (greenhouseId && !greenhousesQuery.data?.some((item) => item.id === greenhouseId)) {
      setGreenhouseId(greenhousesQuery.data?.[0]?.id ?? '');
      setZoneId('');
    }
  }, [greenhousesQuery.data, greenhouseId]);
  useEffect(() => {
    if (!zoneId && zonesQuery.data?.[0]) setZoneId(zonesQuery.data[0].id);
    if (zoneId && !zonesQuery.data?.some((item) => item.id === zoneId)) setZoneId(zonesQuery.data?.[0]?.id ?? '');
  }, [zonesQuery.data, zoneId]);
  useEffect(() => {
    if (assignmentsQuery.data) {
      const active = assignmentsQuery.data.find((assignment) => assignment.status === 'ACTIVE');
      setViewAssignmentId((current) => current && assignmentsQuery.data?.some((item) => item.id === current) ? current : active?.id ?? assignmentsQuery.data?.[0]?.id ?? '');
    }
  }, [assignmentsQuery.data]);
  useEffect(() => {
    const parameterDefinitions = activeAssignment?.plantProfileVersion.sourceCatalogVersion.parameterDefinitions ?? [];
    const activeOverrideConfig = currentOverride?.overrideConfig;
    const values: Record<string, string> = {};
    const enabled: Record<string, boolean> = {};
    const nulls: Record<string, boolean> = {};
    const current = activeOverrideConfig ?? {};
    for (const definition of parameterDefinitions) {
      const existing = current[definition.parameterKey];
      enabled[definition.parameterKey] = existing !== undefined;
      nulls[definition.parameterKey] = existing === null;
      values[definition.parameterKey] = existing === null ? '' : formatValue(existing);
    }
    setOverrideValues(values);
    setOverrideEnabled(enabled);
    setOverrideNulls(nulls);
    setOverrideError('');
  }, [activeAssignment, currentOverride]);

  const invalidateZone = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['zone-plant-assignments', organizationId, zoneId] }),
      queryClient.invalidateQueries({ queryKey: ['plant-config-audit', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['effective-zone-config', organizationId] }),
    ]);
  };
  const activate = useMutation({
    mutationFn: (request: { zoneId: string; organizationId: string; plantProfileVersionId: string; growthStageId: string; idempotencyKey: string }) => apiClient.activatePlantProfileInZone(request.zoneId, {
      organizationId: request.organizationId,
      plantProfileVersionId: request.plantProfileVersionId,
      growthStageId: request.growthStageId,
    }, request.idempotencyKey),
    onSuccess: async (assignment, request) => {
      if (activationAttempt.current?.key === request.idempotencyKey) activationAttempt.current = null;
      setActionError(''); setViewAssignmentId(assignment.id); await invalidateZone();
    },
    onError: (error) => setActionError(apiError(error).message),
  });
  const deactivate = useMutation({
    mutationFn: (request: { assignmentId: string; organizationId: string; idempotencyKey: string }) => apiClient.deactivateZonePlantAssignment(request.organizationId, request.assignmentId, request.idempotencyKey),
    onSuccess: async (_assignment, request) => {
      if (deactivationKeys.current[request.assignmentId] === request.idempotencyKey) delete deactivationKeys.current[request.assignmentId];
      setActionError(''); await invalidateZone();
    },
    onError: (error) => setActionError(apiError(error).message),
  });
  const createOverride = useMutation({
    mutationFn: ({ assignmentId, overrideConfig }: { assignmentId: string; overrideConfig: PlantJsonObject }) => apiClient.createZoneParameterOverride(assignmentId, { overrideConfig }),
    onSuccess: async () => { setOverrideError(''); await invalidateZone(); },
    onError: (error) => setOverrideError(apiError(error).message),
  });
  const effectiveQuery = useQuery({
    queryKey: ['effective-zone-config', organizationId, shownAssignment?.id],
    queryFn: () => apiClient.getEffectiveZonePlantConfig(shownAssignment!.id),
    enabled: Boolean(organizationId && shownAssignment),
  });

  function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError('');
    if (!zoneId || !organizationId || !versionId || !stageId) return;
    if (activeAssignments.length > 1) {
      setActionError('Zona memiliki lebih dari satu assignment aktif. Aktivasi dihentikan; periksa data melalui backend.');
      return;
    }
    const message = activeAssignment
      ? 'Aktifkan konfigurasi ini? Assignment aktif sebelumnya akan diakhiri oleh backend dalam transaksi yang sama.'
      : 'Aktifkan profil dan growth stage ini pada zona terpilih?';
    if (!window.confirm(message)) return;
    const request = { zoneId, organizationId, plantProfileVersionId: versionId, growthStageId: stageId };
    const signature = JSON.stringify(request);
    if (!activationAttempt.current || activationAttempt.current.signature !== signature) {
      activationAttempt.current = { signature, key: crypto.randomUUID() };
    }
    activate.mutate({ ...request, idempotencyKey: activationAttempt.current.key });
  }

  function submitOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeAssignment) return;
    setOverrideError('');
    try {
      const overrideConfig: PlantJsonObject = {};
      for (const definition of activeAssignment.plantProfileVersion.sourceCatalogVersion.parameterDefinitions ?? []) {
        if (overrideEnabled[definition.parameterKey]) {
          overrideConfig[definition.parameterKey] = parseOverrideValue(definition, overrideValues[definition.parameterKey] ?? '', Boolean(overrideNulls[definition.parameterKey]));
        }
      }
      if (Object.keys(overrideConfig).length === 0 && !window.confirm('Buat revision override kosong? Revision saat ini akan menjadi superseded.')) return;
      if (!window.confirm('Simpan sebagai revision override baru? Revision sebelumnya akan dipertahankan sebagai riwayat.')) return;
      createOverride.mutate({ assignmentId: activeAssignment.id, overrideConfig });
    } catch (error) {
      setOverrideError((error as Error).message || 'Nilai override tidak valid.');
    }
  }

  const selectedGreenhouse = greenhousesQuery.data?.find((item) => item.id === greenhouseId);
  const selectedZone = zonesQuery.data?.find((item) => item.id === zoneId);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <header><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400"><Layers className="h-4 w-4" /> Plant Standardization</div><h1 className="text-2xl font-bold text-white sm:text-3xl">Konfigurasi tanaman per zona</h1><p className="mt-2 text-sm text-slate-400">Assignment, override tervalidasi, dan konfigurasi efektif untuk zona di organisasi aktif.</p></header>

        {!organizationId ? <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Pilih organisasi untuk memuat greenhouse dan zona.</div> : <>
          <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 md:grid-cols-2">
            <label className="space-y-1.5 text-xs text-slate-300"><span className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-emerald-400" /> Greenhouse · {currentOrg?.name}</span><select value={greenhouseId} onChange={(event) => { setGreenhouseId(event.target.value); setZoneId(''); setViewAssignmentId(''); }} disabled={greenhousesQuery.isLoading} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"><option value="">Pilih greenhouse</option>{(greenhousesQuery.data ?? []).map((greenhouse) => <option key={greenhouse.id} value={greenhouse.id}>{greenhouse.name} · {greenhouse.code}</option>)}</select></label>
            <label className="space-y-1.5 text-xs text-slate-300"><span className="flex items-center gap-2"><Layers className="h-4 w-4 text-emerald-400" /> Zona</span><select value={zoneId} onChange={(event) => { setZoneId(event.target.value); setViewAssignmentId(''); setActionError(''); }} disabled={!greenhouseId || zonesQuery.isLoading} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"><option value="">Pilih zona</option>{(zonesQuery.data ?? []).map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {zone.code}</option>)}</select></label>
            {greenhousesQuery.isError && <p role="alert" className="md:col-span-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">Greenhouse gagal dimuat: {apiError(greenhousesQuery.error).message}</p>}
            {zonesQuery.isError && <p role="alert" className="md:col-span-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">Zona gagal dimuat: {apiError(zonesQuery.error).message}</p>}
            {greenhousesQuery.isSuccess && greenhousesQuery.data.length === 0 && <p className="md:col-span-2 text-sm text-slate-400">Belum ada greenhouse pada organisasi ini.</p>}
            {zonesQuery.isSuccess && zonesQuery.data.length === 0 && greenhouseId && <p className="md:col-span-2 text-sm text-slate-400">Greenhouse ini belum memiliki zona.</p>}
          </section>

          {selectedZone && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm"><span className="text-slate-300">{selectedGreenhouse?.name} <span className="text-slate-600">/</span> <strong className="text-white">{selectedZone.name}</strong></span><span className="font-mono text-xs text-slate-500">{selectedZone.code}</span></div>}

          {zoneId && <>
            <section className="space-y-4">
              <div className="flex items-end justify-between"><div><h2 className="text-lg font-semibold text-white">Assignment zona</h2><p className="mt-1 text-sm text-slate-400">Riwayat assignment dan statusnya, dibatasi ke zona terpilih.</p></div><button onClick={() => void assignmentsQuery.refetch()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"><RefreshCw className="h-3.5 w-3.5" /> Muat ulang</button></div>
              {assignmentsQuery.isLoading ? <div className="h-24 animate-pulse rounded-2xl bg-slate-900" /> : assignmentsQuery.isError ? <div role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">Assignment zona gagal dimuat: {apiError(assignmentsQuery.error).message}</div> : activeAssignments.length > 1 ? <div role="alert" className="flex gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200"><AlertTriangle className="h-5 w-5 shrink-0" />Terdapat lebih dari satu assignment ACTIVE. UI menonaktifkan aktivasi sampai konsistensi diperiksa.</div> : (assignmentsQuery.data?.length ?? 0) === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Belum ada assignment untuk zona ini.</div> : <div className="space-y-3">{assignmentsQuery.data?.map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} selected={shownAssignment?.id === assignment.id} canManage={canManage} onSelect={() => setViewAssignmentId(assignment.id)} onDeactivate={() => { if (!organizationId || !window.confirm('Akhiri assignment aktif ini? Riwayat assignment tetap dipertahankan.')) return; const key = deactivationKeys.current[assignment.id] ?? (deactivationKeys.current[assignment.id] = crypto.randomUUID()); deactivate.mutate({ assignmentId: assignment.id, organizationId, idempotencyKey: key }); }} deactivating={deactivate.isPending && deactivate.variables?.assignmentId === assignment.id} />)}</div>}
              {actionError && <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{actionError}</p>}
            </section>

            {canManage && assignmentsQuery.isSuccess && profilesQuery.isSuccess && <ActivationForm choices={validatedChoices} versionId={versionId} stageId={stageId} onVersionChange={(id) => { setVersionId(id); setStageId(''); }} onStageChange={setStageId} onSubmit={submitActivation} pending={activate.isPending} hasActive={Boolean(activeAssignment)} disabled={activeAssignments.length > 1} />}
            {profilesQuery.isError && <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">Profil tervalidasi gagal dimuat: {apiError(profilesQuery.error).message}</p>}

            {shownAssignment && <>
              <EffectiveConfigPanel assignment={shownAssignment} query={effectiveQuery} />
              {canManage && activeAssignment?.id === shownAssignment.id && <OverrideForm assignment={activeAssignment} values={overrideValues} enabled={overrideEnabled} nulls={overrideNulls} error={overrideError} pending={createOverride.isPending} onValue={(key, value) => setOverrideValues((current) => ({ ...current, [key]: value }))} onEnabled={(key, value) => setOverrideEnabled((current) => ({ ...current, [key]: value }))} onNull={(key, value) => setOverrideNulls((current) => ({ ...current, [key]: value }))} onSubmit={submitOverride} />}
            </>}

          </>}
          {canManage && <AuditPanel query={auditQuery} />}
        </>}
      </div>
    </DashboardLayout>
  );
}

function AssignmentCard({ assignment, selected, canManage, onSelect, onDeactivate, deactivating }: { assignment: ZonePlantAssignmentDetails; selected: boolean; canManage: boolean; onSelect: () => void; onDeactivate: () => void; deactivating: boolean }) {
  const currentRevision = assignment.overrides.find((item) => item.supersededAt === null);
  return <article className={`rounded-2xl border bg-slate-900/60 p-4 sm:p-5 ${selected ? 'border-emerald-500/35' : 'border-slate-800'}`}>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-100">{assignment.plantProfileVersion.plantProfile.name}</h3><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusClass(assignment.status)}`}>{assignment.status}</span></div><p className="mt-1 text-sm text-slate-400">Versi profil {assignment.plantProfileVersion.version} · {assignment.plantProfileVersion.status} · Stage {assignment.growthStage.label}</p><p className="mt-1 text-xs text-slate-500">Aktif sejak {new Date(assignment.activatedAt).toLocaleString()} · {currentRevision ? `Override revision ${currentRevision.revision}` : 'Tanpa override aktif'}</p></div><div className="flex flex-wrap gap-2"><button onClick={onSelect} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">Konfigurasi efektif</button>{canManage && assignment.status === 'ACTIVE' && <button onClick={onDeactivate} disabled={deactivating} className="rounded-lg border border-rose-500/25 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">{deactivating ? 'Mengakhiri…' : 'Deaktivasi'}</button>}</div></div>
  </article>;
}

function ActivationForm({ choices, versionId, stageId, onVersionChange, onStageChange, onSubmit, pending, hasActive, disabled }: { choices: Array<{ profile: { id: string; name: string; code: string; organizationId: string }; version: PlantProfileVersion }>; versionId: string; stageId: string; onVersionChange: (id: string) => void; onStageChange: (id: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; hasActive: boolean; disabled: boolean }) {
  const selected = choices.find(({ version }) => version.id === versionId)?.version;
  const stages = selected?.growthStages ?? [];
  return <form onSubmit={onSubmit} className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 md:grid-cols-3"><div className="md:col-span-3"><h2 className="font-semibold text-white">{hasActive ? 'Ganti assignment aktif' : 'Aktifkan profil tervalidasi'}</h2><p className="mt-1 text-xs text-slate-400">Hanya versi VALIDATED milik organisasi aktif dan stage yang berasal dari versi tersebut.</p></div>
    <label className="space-y-1.5 text-xs text-slate-300">Profil · versi<select required value={versionId} onChange={(event) => onVersionChange(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"><option value="">Pilih versi tervalidasi</option>{choices.map(({ profile, version }) => <option key={version.id} value={version.id}>{profile.name} · v{version.version} · {version.status}</option>)}</select></label>
    <label className="space-y-1.5 text-xs text-slate-300">Growth stage<select required value={stageId} onChange={(event) => onStageChange(event.target.value)} disabled={!versionId} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"><option value="">Pilih stage dari versi</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.sequence}. {stage.label}</option>)}</select></label>
    <div className="flex items-end"><button disabled={pending || disabled || !choices.length || !stages.length} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"><Check className="h-4 w-4" />{pending ? 'Menyimpan…' : hasActive ? 'Ganti assignment' : 'Aktifkan'}</button></div>
    {!choices.length && <p className="md:col-span-3 text-sm text-slate-500">Belum ada versi profil VALIDATED dengan stage.</p>}{disabled && <p role="alert" className="md:col-span-3 text-sm text-rose-300">Aktivasi dinonaktifkan karena lebih dari satu assignment aktif ditemukan.</p>}
  </form>;
}

function EffectiveConfigPanel({ assignment, query }: { assignment: ZonePlantAssignmentDetails; query: UseQueryResult<EffectiveZonePlantConfig, Error> }) {
  const activeOverride = assignment.overrides.find((item) => item.supersededAt === null);
  return <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"><div><h2 className="text-lg font-semibold text-white">Konfigurasi efektif</h2><p className="mt-1 text-sm text-slate-400">Hasil final berasal langsung dari endpoint backend; lapisan sumber ditampilkan terpisah berdasarkan relasi assignment.</p></div>
    <div className="grid gap-3 lg:grid-cols-3"><ConfigLayer title="Profil" value={assignment.plantProfileVersion.profileConfig} /><ConfigLayer title={`Growth stage · ${assignment.growthStage.label}`} value={assignment.growthStage.parameterConfig?.config ?? {}} /><ConfigLayer title={activeOverride ? `Override aktif · revision ${activeOverride.revision}` : 'Override zona · tidak ada'} value={activeOverride?.overrideConfig ?? {}} /></div>
    {query.isLoading ? <div className="h-36 animate-pulse rounded-xl bg-slate-800" /> : query.isError ? <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">Konfigurasi efektif gagal dimuat: {apiError(query.error).message}</p> : query.data ? <div className="overflow-hidden rounded-xl border border-emerald-500/20"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/15 bg-emerald-500/5 px-4 py-3"><span className="text-sm font-semibold text-emerald-200">Hasil dari server</span><span className="font-mono text-[11px] text-slate-400">{query.data.schemaVersion} · checksum {query.data.checksum.slice(0, 16)}…</span></div><pre className="max-h-[28rem] overflow-auto bg-slate-950/60 p-4 text-xs leading-relaxed text-slate-200">{JSON.stringify(query.data.config, null, 2)}</pre></div> : <p className="text-sm text-slate-400">Konfigurasi efektif belum tersedia.</p>}
    {assignment.overrides.length > 0 && <details className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-300">Riwayat override ({assignment.overrides.length} revision)</summary><div className="mt-3 space-y-2">{assignment.overrides.map((revision) => <div key={revision.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-2 text-xs"><span className="text-slate-300">Revision {revision.revision}{revision.supersededAt ? ' · superseded' : ' · current'}</span><span className="text-slate-500">{new Date(revision.createdAt).toLocaleString()} · {revision.createdByUserId}</span></div>)}</div></details>}
  </section>;
}

function ConfigLayer({ title, value }: { title: string; value: Record<string, unknown> }) {
  return <details className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><summary className="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-slate-300">{title}<ChevronDown className="h-3.5 w-3.5 text-slate-500" /></summary><pre className="mt-3 max-h-48 overflow-auto border-t border-slate-800 pt-3 font-mono text-[11px] text-slate-400">{JSON.stringify(value, null, 2)}</pre></details>;
}

function OverrideForm({ assignment, values, enabled, nulls, error, pending, onValue, onEnabled, onNull, onSubmit }: { assignment: ZonePlantAssignmentDetails; values: Record<string, string>; enabled: Record<string, boolean>; nulls: Record<string, boolean>; error: string; pending: boolean; onValue: (key: string, value: string) => void; onEnabled: (key: string, value: boolean) => void; onNull: (key: string, value: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const definitions = assignment.plantProfileVersion.sourceCatalogVersion.parameterDefinitions ?? [];
  const active = assignment.overrides.find((item) => item.supersededAt === null);
  return <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"><div><h2 className="font-semibold text-white">Zone parameter override</h2><p className="mt-1 text-xs text-slate-400">Menyimpan akan membuat revision baru dan mempertahankan revision sebelumnya. Nilai diuji terhadap schema parameter dan backend memvalidasi konfigurasi efektif.</p>{active && <p className="mt-2 text-xs text-sky-300">Revision aktif saat ini: {active.revision}</p>}</div>
    {definitions.length === 0 ? <p className="rounded-lg bg-slate-950/50 p-4 text-sm text-slate-400">Versi sumber ini tidak menyediakan parameter override.</p> : <div className="space-y-3">{definitions.map((definition) => <OverrideField key={definition.id} definition={definition} enabled={Boolean(enabled[definition.parameterKey])} useNull={Boolean(nulls[definition.parameterKey])} value={values[definition.parameterKey] ?? ''} onEnabled={(value) => onEnabled(definition.parameterKey, value)} onNull={(value) => onNull(definition.parameterKey, value)} onValue={(value) => onValue(definition.parameterKey, value)} />)}</div>}
    {error && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    <button disabled={pending || definitions.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"><Plus className="h-4 w-4" />{pending ? 'Membuat revision…' : 'Simpan revision override'}</button>
  </form>;
}

function OverrideField({ definition, enabled, useNull, value, onEnabled, onNull, onValue }: { definition: PlantParameterDefinition; enabled: boolean; useNull: boolean; value: string; onEnabled: (value: boolean) => void; onNull: (value: boolean) => void; onValue: (value: string) => void }) {
  const schema = definition.valueSchema as JsonSchemaShape;
  const primitiveEnum = schema.enum?.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
  return <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 md:grid-cols-[minmax(9rem,1fr)_2fr]"><div><label className="flex items-start gap-2"><input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} className="mt-0.5 accent-emerald-500" /><span><span className="block text-sm font-medium text-slate-100">{definition.label}</span><span className="mt-1 block font-mono text-[11px] text-slate-500">{definition.parameterKey} · {definition.dataType}{definition.unit ? ` · ${definition.unit}` : ''}</span>{definition.metadataSchema.nullable === true && <span className="mt-1 block text-[10px] text-slate-500">Nilai null diizinkan</span>}</span></label></div><div className="space-y-2">{enabled && <>
    {definition.metadataSchema.nullable === true && <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={useNull} onChange={(event) => onNull(event.target.checked)} className="accent-sky-500" />Gunakan null</label>}
    {!useNull && definition.dataType === 'boolean' ? <select value={value} onChange={(event) => onValue(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Pilih nilai</option><option value="true">true</option><option value="false">false</option></select>
      : !useNull && primitiveEnum ? <select value={value} onChange={(event) => onValue(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"><option value="">Pilih nilai yang diizinkan</option>{schema.enum?.map((option) => <option key={JSON.stringify(option)} value={formatValue(option)}>{formatValue(option)}</option>)}</select>
        : !useNull && (definition.dataType === 'object' || definition.dataType === 'array') ? <textarea rows={4} value={value} onChange={(event) => onValue(event.target.value)} placeholder={definition.dataType === 'array' ? '[]' : '{}'} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-slate-100" />
          : !useNull && <input type={definition.dataType === 'number' || definition.dataType === 'integer' ? 'number' : 'text'} step={definition.dataType === 'integer' ? '1' : definition.dataType === 'number' ? 'any' : undefined} min={schema.minimum ?? schema.exclusiveMinimum} max={schema.maximum ?? schema.exclusiveMaximum} minLength={schema.minLength} maxLength={schema.maxLength} value={value} onChange={(event) => onValue(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100" />}
    <p className="text-[10px] text-slate-500">Schema: {JSON.stringify(definition.valueSchema)}</p>
  </>}</div></div>;
}

function AuditPanel({ query }: { query: UseQueryResult<PlantConfigAuditEvent[], Error> }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Audit organisasi</h2><p className="mt-1 text-xs text-slate-400">Event yang dikembalikan backend untuk organisasi aktif.</p></div><ShieldCheck className="h-5 w-5 text-emerald-400" /></div>
    {query.isLoading ? <div className="mt-4 h-16 animate-pulse rounded-lg bg-slate-800" /> : query.isError ? <p role="alert" className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-200">Audit tidak dapat dimuat: {apiError(query.error).message}</p> : query.data?.length ? <div className="mt-4 max-h-80 space-y-2 overflow-auto">{query.data.map((event) => <div key={event.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium text-slate-200">{event.action}</span><time className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</time></div><p className="mt-1 text-xs text-slate-400">{event.entityType} · {event.entityId}</p>{event.actorUserId && <p className="mt-1 font-mono text-[10px] text-slate-500">Actor ID: {event.actorUserId}</p>}</div>)}</div> : <p className="mt-4 text-sm text-slate-500">Belum ada audit event.</p>}
  </section>;
}
