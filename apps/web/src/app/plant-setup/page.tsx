'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { useAuth } from '@/context/auth-context';
import { apiClient } from '@/lib/api-client';
import type {
  CreatePlantCatalogDto,
  CreatePlantCatalogVersionDto,
  CreatePlantParameterDefinitionDto,
  GeneratePlantSetupDto,
  PlantCatalog,
  PlantCatalogVersion,
  PlantJsonObject,
  PlantJsonValue,
  PlantProfile,
  PlantSetupCandidateResult,
  DevicePlantConfigurationDelivery,
} from '@/types';

type SetupForm = {
  commonName: string;
  scientificName: string;
  cultivar: string;
  cultivationMethod: GeneratePlantSetupDto['cultivationMethod'] | 'unknown';
  growthStageContext: string;
};
type ParameterRow = {
  parameterKey: string;
  label: string;
  unit: string;
  dataType: string;
  recommendedValue: number | null;
  minimumValue: number | null;
  maximumValue: number | null;
  note: string;
  evidenceStatus: 'NOT_ASSESSED';
  manuallyEdited: boolean;
};
type SetupDraft = { catalogId: string; catalogVersionId: string; catalogCode: string; version: number; status: PlantCatalogVersion['status'] };
type SetupStage = { code: string; label: string; sequence: number; config?: PlantJsonObject };
type SetupMode = 'existing' | 'new';
type SetupSessionSnapshot = {
  setupMode: SetupMode;
  form: SetupForm;
  scientificNameConfirmed: boolean;
  candidate: PlantSetupCandidateResult | null;
  parameters: ParameterRow[];
  stages: SetupStage[];
  setupDraft: SetupDraft | null;
  draftSaved: boolean;
};

const initialForm: SetupForm = {
  commonName: '',
  scientificName: '',
  cultivar: '',
  cultivationMethod: 'hydroponic_tower',
  growthStageContext: '',
};
const defaultEdgeCompatibility = {
  mode: 'monitoring_only',
  controller: 'ESP32-S3',
  schema_version: 1,
  actuator_commands_enabled: false,
};
const cultivationMethods: Array<{ value: SetupForm['cultivationMethod']; label: string }> = [
  { value: 'hydroponic_tower', label: 'Hidroponik tower' },
  { value: 'hydroponic_nft', label: 'Hidroponik NFT' },
  { value: 'hydroponic_dwc', label: 'Hidroponik DWC' },
  { value: 'soil', label: 'Media tanah' },
  { value: 'other', label: 'Lainnya' },
];

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[.\s]+$/g, '');
}

function setupCode(form: SetupForm) {
  const identity = `${form.scientificName}-${form.cultivar}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = `-${form.cultivationMethod}`;
  const prefix = identity.slice(0, 64 - suffix.length).replace(/-$/g, '');
  return prefix ? `${prefix}${suffix}` : form.cultivationMethod;
}

function readStageCodes(version: PlantCatalogVersion) {
  return Array.isArray(version.stageTemplates)
    ? version.stageTemplates.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item) && typeof item.code === 'string' ? [item.code] : [])
    : [];
}

function isPlantJsonValue(value: unknown): value is PlantJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isPlantJsonValue);
  return Boolean(value) && typeof value === 'object'
    && Object.values(value).every(isPlantJsonValue);
}

function isPlantJsonObject(value: unknown): value is PlantJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && isPlantJsonValue(value);
}

function isSetupSessionSnapshot(value: unknown): value is SetupSessionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  const form = snapshot.form;
  if (!form || typeof form !== 'object' || Array.isArray(form)) return false;
  const formValue = form as Record<string, unknown>;
  const candidate = snapshot.candidate;
  const parameters = snapshot.parameters;
  const stages = snapshot.stages;
  const setupDraft = snapshot.setupDraft;
  const numberOrNull = (item: unknown) => item === null || typeof item === 'number' && Number.isFinite(item);
  const parameterIsValid = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const parameter = item as Record<string, unknown>;
    return typeof parameter.parameterKey === 'string'
      && typeof parameter.label === 'string'
      && typeof parameter.unit === 'string'
      && typeof parameter.dataType === 'string'
      && numberOrNull(parameter.recommendedValue)
      && numberOrNull(parameter.minimumValue)
      && numberOrNull(parameter.maximumValue)
      && typeof parameter.note === 'string'
      && parameter.evidenceStatus === 'NOT_ASSESSED'
      && typeof parameter.manuallyEdited === 'boolean';
  };
  const candidateParameterIsValid = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const parameter = item as Record<string, unknown>;
    return typeof parameter.parameterKey === 'string'
      && typeof parameter.label === 'string'
      && parameter.dataType === 'number'
      && (parameter.unit === null || typeof parameter.unit === 'string')
      && numberOrNull(parameter.recommendedValue)
      && numberOrNull(parameter.minimumValue)
      && numberOrNull(parameter.maximumValue)
      && typeof parameter.note === 'string'
      && parameter.evidenceStatus === 'NOT_ASSESSED';
  };
  const stageIsValid = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const stage = item as Record<string, unknown>;
    return typeof stage.code === 'string'
      && typeof stage.label === 'string'
      && typeof stage.sequence === 'number'
      && Number.isFinite(stage.sequence)
      && (stage.config === undefined || isPlantJsonObject(stage.config));
  };
  const candidateIsValid = (item: unknown) => {
    if (item === null) return true;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const result = item as Record<string, unknown>;
    const provider = result.provider;
    return result.status === 'CANDIDATES_FOR_REVIEW'
      && (typeof result.scientificNameSuggestion === 'string' || result.scientificNameSuggestion === null)
      && Array.isArray(result.parameters) && result.parameters.every(candidateParameterIsValid)
      && Array.isArray(result.growthStages) && result.growthStages.every(stageIsValid)
      && Boolean(provider && typeof provider === 'object' && !Array.isArray(provider)
        && typeof (provider as Record<string, unknown>).name === 'string'
        && ((provider as Record<string, unknown>).model === undefined || typeof (provider as Record<string, unknown>).model === 'string'))
      && Array.isArray(result.findings) && result.findings.every((finding) =>
        Boolean(finding && typeof finding === 'object' && typeof (finding as Record<string, unknown>).code === 'string'
          && typeof (finding as Record<string, unknown>).explanation === 'string'))
      && Array.isArray(result.sourceCandidates)
      && result.sourceCandidates.every((source) => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
        const record = source as Record<string, unknown>;
        if ((record.provider !== 'crossref' && record.provider !== 'openalex')
          || typeof record.title !== 'string'
          || !Array.isArray(record.authors) || !record.authors.every((author) => typeof author === 'string')) return false;
        if (['doi', 'journal', 'sourceUrl'].some((key) => record[key] !== undefined && typeof record[key] !== 'string')
          || (record.publicationYear !== undefined && typeof record.publicationYear !== 'number')) return false;
        if (record.sourceUrl !== undefined) {
          if (typeof record.sourceUrl !== 'string') return false;
          try {
            const url = new URL(record.sourceUrl);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
          } catch {
            return false;
          }
        }
        return true;
      })
      && ['NOT_SEARCHED', 'COMPLETED', 'PARTIAL', 'UNAVAILABLE'].includes(String(result.sourceSearchStatus));
  };
  const setupDraftIsValid = (item: unknown) => {
    if (item === null) return true;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const draft = item as Record<string, unknown>;
    return typeof draft.catalogId === 'string'
      && typeof draft.catalogVersionId === 'string'
      && typeof draft.catalogCode === 'string'
      && typeof draft.version === 'number'
      && ['DRAFT', 'PUBLISHED', 'RETIRED'].includes(String(draft.status));
  };
  return (snapshot.setupMode === 'new' || snapshot.setupMode === 'existing')
    && typeof formValue.commonName === 'string'
    && typeof formValue.scientificName === 'string'
    && typeof formValue.cultivar === 'string'
    && (formValue.cultivationMethod === 'unknown' || cultivationMethods.some(({ value }) => value === formValue.cultivationMethod))
    && typeof formValue.growthStageContext === 'string'
    && typeof snapshot.scientificNameConfirmed === 'boolean'
    && candidateIsValid(candidate)
    && Array.isArray(parameters) && parameters.every(parameterIsValid)
    && Array.isArray(stages) && stages.every(stageIsValid)
    && setupDraftIsValid(setupDraft)
    && typeof snapshot.draftSaved === 'boolean';
}

function readStageTemplates(version: PlantCatalogVersion): SetupStage[] {
  if (!Array.isArray(version.stageTemplates)) return [];
  return version.stageTemplates.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const stage = item as Record<string, unknown>;
    if (typeof stage.code !== 'string' || typeof stage.label !== 'string' || typeof stage.sequence !== 'number') return [];
    return [{
      code: stage.code,
      label: stage.label,
      sequence: stage.sequence,
      ...(isPlantJsonObject(stage.config) ? { config: stage.config } : {}),
    }];
  });
}

function methodFromCatalogCode(code: string): SetupForm['cultivationMethod'] {
  return cultivationMethods.find(({ value }) => code.endsWith(`-${value}`))?.value ?? 'unknown';
}

function errorMessage(error: unknown) {
  const shaped = (error instanceof Error ? error : new Error(typeof error === 'string' ? error : '')) as Error & { status?: number; code?: string };
  if (shaped.code === 'LLM_PROVIDER_TIMEOUT' || shaped.name === 'TimeoutError') return 'Proses penyusunan memerlukan waktu terlalu lama dan dihentikan. Silakan coba kembali.';
  if (shaped.code === 'LLM_QUOTA_EXCEEDED') return 'Layanan penyusunan rekomendasi sedang mencapai batas penggunaan. Coba lagi nanti.';
  if (shaped.code === 'LLM_RATE_LIMITED') return 'Permintaan sedang terlalu ramai. Tunggu sebentar, lalu coba kembali.';
  if (['LLM_INVALID_API_KEY', 'LLM_PROVIDER_ACCESS_DENIED', 'LLM_MODEL_UNAVAILABLE', 'LLM_PROVIDER_NOT_CONFIGURED'].includes(shaped.code ?? '')) {
    return 'Layanan penyusunan rekomendasi belum siap. Coba lagi nanti atau hubungi administrator.';
  }
  if (['LLM_PROVIDER_OVERLOADED', 'LLM_PROVIDER_UNAVAILABLE'].includes(shaped.code ?? '')) {
    return 'Layanan penyusunan rekomendasi sedang sibuk atau sementara tidak tersedia. Coba lagi beberapa saat.';
  }
  if (['LLM_INVALID_RESPONSE', 'LLM_RECOMMENDATION_REJECTED', 'LLM_PROVIDER_ERROR', 'LLM_REQUEST_REJECTED'].includes(shaped.code ?? '')) {
    return 'Hasil penyusunan belum dapat diproses. Silakan coba kembali.';
  }
  if (shaped.name === 'AbortError' || shaped.message.toLocaleLowerCase().includes('failed to fetch')) {
    return 'Koneksi terputus saat menyusun rekomendasi. Periksa jaringan, lalu coba kembali.';
  }
  if (/\b(?:gemini|google ai studio|api\s*key|token|quota|kuota|model)\b/i.test(shaped.message)) {
    return 'Layanan penyusunan rekomendasi sedang mengalami kendala. Silakan coba kembali beberapa saat lagi.';
  }
  if (shaped.status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
  if (shaped.status === 403) return 'Role OWNER/ADMIN organisasi diperlukan untuk membuat setup tanaman.';
  if (shaped.status === 409) return shaped.message || 'Draft atau identitas katalog bertentangan dengan data yang sudah ada.';
  if (shaped.status === 422 || shaped.status === 400) return shaped.message || 'Data setup tidak sesuai validasi backend.';
  if (shaped.status === 429) return 'Layanan sedang menerima terlalu banyak permintaan. Tunggu sebentar, lalu coba kembali.';
  if (typeof shaped.status === 'number' && shaped.status >= 500) return 'Terjadi gangguan sementara saat menyusun rekomendasi. Silakan coba kembali beberapa saat lagi.';
  return shaped.message || 'Permintaan gagal. Tidak ada keberhasilan yang diasumsikan.';
}

function deviceDeliveryLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: 'Menunggu pengiriman',
    PUBLISHING: 'Mengirim ke broker MQTT',
    SENT: 'Terkirim ke broker; menunggu perangkat',
    RECEIVED: 'Diterima perangkat; menunggu penerapan',
    APPLIED: 'Diterapkan dan dikonfirmasi ESP32',
    REJECTED: 'Ditolak ESP32',
    TIMEOUT: 'Waktu tunggu ACK habis',
    FAILED: 'Gagal mengirim',
  };
  return labels[status] ?? status;
}

async function generatePlantSetupWithSources(organizationId: string, payload: GeneratePlantSetupDto): Promise<PlantSetupCandidateResult> {
  const generated = await apiClient.generatePlantSetup(organizationId, payload);
  const method = cultivationMethods.find(({ value }) => value === payload.cultivationMethod)?.label ?? 'plant cultivation';
  const query = `${payload.scientificName?.trim() || generated.scientificNameSuggestion || payload.commonName} ${payload.commonName} ${method} nutrient environment`.slice(0, 200);
  try {
    const search = await apiClient.searchResearchSources({ query, providers: ['crossref', 'openalex'], limit: 5 });
    const sourceCandidates: PlantSetupCandidateResult['sourceCandidates'] = [];
    for (const source of search.sources) {
      const provider = source.metadataProvider;
      if (provider !== 'crossref' && provider !== 'openalex') continue;
      sourceCandidates.push({
        provider,
        title: source.title,
        authors: Array.isArray(source.authors) ? source.authors.filter((author): author is string => typeof author === 'string').slice(0, 5) : [],
        ...(source.doiNormalized ? { doi: source.doiNormalized } : {}),
        ...(source.publicationYear ? { publicationYear: source.publicationYear } : {}),
        ...(source.journal ? { journal: source.journal } : {}),
        ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
      });
    }
    const sourceSearchStatus = search.job.status === 'SUCCEEDED' ? 'COMPLETED'
      : search.job.status === 'PARTIAL' ? 'PARTIAL' : 'UNAVAILABLE';
    const sourceSearchWarning = search.errors.length
      ? 'Sebagian informasi referensi belum berhasil dimuat. Rekomendasi tetap hanya kandidat dan belum didukung bukti.'
      : sourceSearchStatus === 'UNAVAILABLE' ? 'Pencarian referensi tidak berhasil; kandidat AI tetap belum terverifikasi.' : undefined;
    return {
      ...generated,
      sourceCandidates,
      sourceSearchStatus,
      ...(sourceSearchWarning ? { sourceSearchWarning } : {}),
    };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    return {
      ...generated,
      sourceCandidates: [],
      sourceSearchStatus: 'UNAVAILABLE',
      sourceSearchWarning: status === 403
        ? 'Informasi referensi belum dapat dimuat. Rekomendasi tetap hanya kandidat dan belum didukung bukti.'
        : 'Pencarian referensi gagal. Periksa koneksi atau izin, lalu coba lagi; hasil AI tetap hanya kandidat.',
    };
  }
}

export default function PlantSetupPage() {
  const { currentOrg, currentMembership } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = currentOrg?.id;
  const canManage = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const [setupMode, setSetupMode] = useState<SetupMode>('new');
  const [form, setForm] = useState(initialForm);
  const [scientificNameConfirmed, setScientificNameConfirmed] = useState(false);
  const [candidate, setCandidate] = useState<PlantSetupCandidateResult | null>(null);
  const [parameters, setParameters] = useState<ParameterRow[]>([]);
  const [stages, setStages] = useState<SetupStage[]>([]);
  const [newParameterLabel, setNewParameterLabel] = useState('');
  const [newParameterUnit, setNewParameterUnit] = useState('');
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [deleteDraftNotice, setDeleteDraftNotice] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [approvalNotice, setApprovalNotice] = useState('');
  const [resumedDraft, setResumedDraft] = useState(false);
  const [selectedResumeDraft, setSelectedResumeDraft] = useState('');
  const [standardSearch, setStandardSearch] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedParameterKeys, setSelectedParameterKeys] = useState<string[]>([]);
  const [deviceApplyConfirmed, setDeviceApplyConfirmed] = useState(false);
  const [deviceConfigurationId, setDeviceConfigurationId] = useState('');
  const [deviceApplyError, setDeviceApplyError] = useState('');
  const [deviceApplyNotice, setDeviceApplyNotice] = useState('');
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [restoredOrgId, setRestoredOrgId] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: ['plant-catalog', organizationId],
    queryFn: () => apiClient.getPlantCatalog(organizationId!),
    enabled: Boolean(organizationId && canManage),
  });
  const devicesQuery = useQuery({
    queryKey: ['plant-config-devices', organizationId],
    queryFn: () => apiClient.getPlantConfigurationDevices(organizationId!),
    enabled: Boolean(organizationId && canManage),
    refetchInterval: 10_000,
  });
  const parameterValidationsQuery = useQuery({
    queryKey: ['plant-catalog-parameter-validations', organizationId, setupDraft?.catalogVersionId],
    queryFn: () => apiClient.getPlantCatalogParameterValidations(organizationId!, setupDraft!.catalogVersionId),
    enabled: Boolean(organizationId && canManage && setupDraft?.catalogVersionId && draftSaved),
  });
  const deviceConfigurationQuery = useQuery({
    queryKey: ['device-plant-configuration', organizationId, deviceConfigurationId],
    queryFn: () => apiClient.getDevicePlantConfiguration(organizationId!, deviceConfigurationId),
    enabled: Boolean(organizationId && canManage && deviceConfigurationId),
    refetchInterval: (query) => {
      const status = (query.state.data as DevicePlantConfigurationDelivery | undefined)?.status;
      return status && ['APPLIED', 'REJECTED', 'TIMEOUT', 'FAILED'].includes(status) ? false : 2_000;
    },
  });
  useEffect(() => {
    if (!organizationId) {
      setRestoredOrgId(null);
      return;
    }
    setRestoredOrgId(null);
    try {
      const saved = sessionStorage.getItem(`plant-setup-review:${organizationId}`);
      if (!saved) {
        setSetupMode('new');
        setForm(initialForm);
        setScientificNameConfirmed(false);
        setCandidate(null);
        setParameters([]);
        setStages([]);
        setSetupDraft(null);
        setDraftSaved(false);
        setSelectedParameterKeys([]);
        setSelectedDeviceId('');
      } else {
        const snapshot: unknown = JSON.parse(saved);
        if (!isSetupSessionSnapshot(snapshot)) throw new Error('Stored setup review is invalid');
        setSetupMode(snapshot.setupMode);
        setForm(snapshot.form);
        setScientificNameConfirmed(snapshot.scientificNameConfirmed);
        setCandidate(snapshot.candidate);
        setParameters(snapshot.parameters);
        setStages(snapshot.stages);
        setSetupDraft(snapshot.setupDraft);
        setDraftSaved(snapshot.draftSaved);
        setSelectedParameterKeys(snapshot.parameters.map(({ parameterKey }) => parameterKey));
        setSelectedDeviceId('');
      }
      setDraftError('');
    } catch {
      setSetupMode('new');
      setForm(initialForm);
      setScientificNameConfirmed(false);
      setCandidate(null);
      setParameters([]);
      setStages([]);
      setSetupDraft(null);
      setDraftSaved(false);
      setSelectedParameterKeys([]);
      setSelectedDeviceId('');
      setDraftError('Hasil review tersimpan di tab ini tidak dapat dipulihkan. Generate kembali atau lanjutkan draft yang tersimpan.');
    }
    setRestoredOrgId(organizationId);
  }, [organizationId]);
  useEffect(() => {
    if (!organizationId || restoredOrgId !== organizationId) return;
    const snapshot: SetupSessionSnapshot = {
      setupMode,
      form,
      scientificNameConfirmed,
      candidate,
      parameters,
      stages,
      setupDraft,
      draftSaved,
    };
    try {
      const storageKey = `plant-setup-review:${organizationId}`;
      if (setupDraft?.status === 'PUBLISHED') {
        sessionStorage.removeItem(storageKey);
        return;
      }
      sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      setDraftError('Browser tidak dapat menyimpan hasil review sementara. Nilai AI belum disimpan ke standar.');
    }
  }, [organizationId, restoredOrgId, setupMode, form, scientificNameConfirmed, candidate, parameters, stages, setupDraft, draftSaved]);
  function updateSetupContext(key: 'commonName' | 'scientificName' | 'cultivar' | 'cultivationMethod' | 'growthStageContext', value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setScientificNameConfirmed(false);
    setCandidate(null);
    setParameters([]);
    setStages([]);
    setSetupDraft(null);
    setDraftSaved(false);
    setResumedDraft(false);
    setSelectedParameterKeys([]);
    setDeviceApplyConfirmed(false);
    setDeviceConfigurationId('');
    setDeviceApplyNotice('');
  }
  const generate = useMutation({
    mutationFn: (payload: GeneratePlantSetupDto) => generatePlantSetupWithSources(organizationId!, payload),
    onSuccess: (result) => {
      setCandidate(result);
      setParameters(result.parameters.map((item) => ({
        parameterKey: item.parameterKey,
        label: item.label,
        unit: item.unit ?? '',
        dataType: item.dataType,
        recommendedValue: item.recommendedValue,
        minimumValue: item.minimumValue,
        maximumValue: item.maximumValue,
        note: item.note,
        evidenceStatus: item.evidenceStatus,
        manuallyEdited: false,
      })));
      setSelectedParameterKeys(result.parameters.map(({ parameterKey }) => parameterKey));
      setStages(result.growthStages);
      if (!form.scientificName.trim() && result.scientificNameSuggestion) {
        setForm((current) => ({ ...current, scientificName: result.scientificNameSuggestion! }));
        setScientificNameConfirmed(false);
      }
      setSetupDraft(null);
      setDraftSaved(false);
      setDraftError('');
      setResumedDraft(false);
      setDeviceApplyConfirmed(false);
      setDeviceConfigurationId('');
      setDeviceApplyNotice('');
    },
  });

  useEffect(() => {
    if (!generate.isPending) {
      setGenerationSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setGenerationSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [generate.isPending]);

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!organizationId || (!candidate && !setupDraft)) throw new Error('Generate kandidat atau lanjutkan draft setup sebelum menyimpan.');
      const scientificName = form.scientificName.trim();
      if (!scientificName) throw new Error('Isi nama ilmiah terlebih dahulu. Nama yang diusulkan AI boleh diperiksa atau diedit.');
      if (!parameters.length || !stages.length) throw new Error('Draft perlu minimal satu parameter dan satu growth stage.');
      if (parameters.some((parameter) => parameter.minimumValue !== null
        && parameter.maximumValue !== null
        && parameter.minimumValue > parameter.maximumValue)) {
        throw new Error('Periksa kembali rentang minimum dan maksimum setiap parameter.');
      }

      const code = setupDraft?.catalogCode ?? setupCode({ ...form, scientificName });
      if (!code) throw new Error('Kode katalog tidak dapat dibuat dari identitas tanaman ini.');
      const manualStageChanges = candidate ? JSON.stringify(stages) !== JSON.stringify(candidate.growthStages) : true;
      const catalogsNow = await apiClient.getPlantCatalog(organizationId);
      let catalog: PlantCatalog | undefined = setupDraft?.catalogCode === code
        ? catalogsNow.find((item) => item.id === setupDraft.catalogId)
        : catalogsNow.find((item) => item.code === code);
      if (catalog) {
        const identityMatches = normalized(catalog.scientificName) === normalized(scientificName)
          && normalized(catalog.commonName) === normalized(form.commonName)
          && normalized(catalog.cultivar ?? '') === normalized(form.cultivar);
        if (!identityMatches) throw new Error('Kode katalog sudah digunakan oleh identitas tanaman lain. Ubah nama varietas atau identitas tanaman.');
      } else {
        const payload: CreatePlantCatalogDto = {
          code,
          scientificName,
          commonName: form.commonName.trim(),
          ...(form.cultivar.trim() ? { cultivar: form.cultivar.trim() } : {}),
        };
        catalog = await apiClient.createPlantCatalog(organizationId, payload);
      }
      setSetupDraft((current) => ({ catalogId: catalog!.id, catalogVersionId: current?.catalogId === catalog!.id ? current.catalogVersionId : '', catalogCode: code, version: current?.version ?? 0, status: 'DRAFT' }));

      let detail = await apiClient.getPlantCatalogItem(organizationId, catalog.id);
      let version: PlantCatalogVersion | undefined = setupDraft?.catalogId === catalog.id
        ? detail.versions?.find((item) => item.id === setupDraft.catalogVersionId && item.status === 'DRAFT')
        : undefined;
      const expectedStageCodes = stages.map((item) => item.code);
      if (!version) {
        version = detail.versions
          ?.filter((item) => item.status === 'DRAFT')
          .sort((left, right) => right.version - left.version)
          .find((item) => {
            const existingKeys = (item.parameterDefinitions ?? []).map((definition) => definition.parameterKey);
            return existingKeys.every((key) => parameters.some((parameter) => parameter.parameterKey === key))
              && JSON.stringify(readStageCodes(item)) === JSON.stringify(expectedStageCodes);
          });
      }
      if (!version) {
        const versionPayload: CreatePlantCatalogVersionDto = {
          profileDefaults: {},
          stageTemplates: stages.map(({ code: stageCode, label, sequence, config }) => ({ code: stageCode, label, sequence, config: config ?? {} })),
          edgeCompatibility: defaultEdgeCompatibility,
          changeOrigin: manualStageChanges ? 'MANUAL_EDIT' : 'AI_PLANT_SETUP',
        };
        version = await apiClient.createPlantCatalogVersion(organizationId, catalog.id, versionPayload);
      } else {
        await apiClient.updatePlantCatalogVersion(organizationId, version.id, {
          profileDefaults: {},
          stageTemplates: stages.map(({ code: stageCode, label, sequence, config }) => ({ code: stageCode, label, sequence, config: config ?? {} })),
          changeOrigin: manualStageChanges ? 'MANUAL_EDIT' : 'AI_PLANT_SETUP',
        });
      }
      setSetupDraft({ catalogId: catalog.id, catalogVersionId: version.id, catalogCode: code, version: version.version, status: version.status });

      detail = await apiClient.getPlantCatalogItem(organizationId, catalog.id);
      const existingVersion = detail.versions?.find((item) => item.id === version!.id);
      if (!existingVersion || existingVersion.status !== 'DRAFT') throw new Error('Versi target tidak lagi DRAFT; standar terbit tidak pernah diubah.');
      for (const definition of existingVersion.parameterDefinitions ?? []) {
        if (!parameters.some((item) => item.parameterKey === definition.parameterKey)) {
          await apiClient.deletePlantParameterDefinition(organizationId, version.id, definition.id);
        }
      }
      const refreshed = await apiClient.getPlantCatalogItem(organizationId, catalog.id);
      const refreshedVersion = refreshed.versions?.find((item) => item.id === version!.id);
      const definitionsByKey = new Map((refreshedVersion?.parameterDefinitions ?? []).map((item) => [item.parameterKey, item]));
      for (const parameter of parameters) {
        const payload: CreatePlantParameterDefinitionDto = {
          parameterKey: parameter.parameterKey,
          label: parameter.label.trim(),
          dataType: parameter.dataType,
          ...(parameter.unit.trim() ? { unit: parameter.unit.trim() } : {}),
          valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' },
          metadataSchema: { required: false },
          ...((parameter.manuallyEdited || candidate) ? { changeOrigin: parameter.manuallyEdited ? 'MANUAL_EDIT' as const : 'AI_PLANT_SETUP' as const } : {}),
        };
        const existing = definitionsByKey.get(parameter.parameterKey);
        if (existing) {
          await apiClient.updatePlantParameterDefinition(organizationId, version.id, existing.id, {
            label: payload.label,
            dataType: payload.dataType,
            unit: payload.unit ?? null,
            valueSchema: payload.valueSchema,
            metadataSchema: payload.metadataSchema,
            ...((parameter.manuallyEdited || candidate) ? { changeOrigin: parameter.manuallyEdited ? 'MANUAL_EDIT' as const : 'AI_PLANT_SETUP' as const } : {}),
          });
        } else {
          await apiClient.createPlantParameterDefinition(organizationId, version.id, payload);
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['plant-catalog', organizationId] });
      setResumedDraft(false);
      return { catalogId: catalog.id, catalogVersionId: version.id, catalogCode: code, version: version.version, status: 'DRAFT' as const };
    },
    onSuccess: (result) => {
      setSetupDraft(result);
      setDraftSaved(true);
      setDraftError('');
      setDeviceConfigurationId('');
      setDeviceApplyConfirmed(false);
      setDeviceApplyNotice('');
    },
    onError: (error) => {
      setDraftSaved(false);
      setDraftError(errorMessage(error));
    },
  });

  const deleteDraft = useMutation({
    onMutate: () => setDeleteDraftNotice(''),
    mutationFn: async () => {
      if (!organizationId || !setupDraft) {
        throw new Error('Pilih draft atau standar tanaman sebelum menghapus.');
      }
      return apiClient.deletePlantCatalogVersion(organizationId, setupDraft.catalogVersionId);
    },
    onSuccess: async (result) => {
      setCandidate(null);
      setParameters([]);
      setStages([]);
      setSetupDraft(null);
      setSetupMode('new');
      setDraftSaved(false);
      setResumedDraft(false);
      setSelectedResumeDraft('');
      setScientificNameConfirmed(false);
      setNewParameterLabel('');
      setNewParameterUnit('');
      setSelectedParameterKeys([]);
      setDraftError('');
      setApprovalError('');
      setApprovalNotice('');
      setDeviceConfigurationId('');
      setDeviceApplyConfirmed(false);
      setDeviceApplyError('');
      setDeviceApplyNotice('');
      const deletedLabel = setupDraft?.status === 'PUBLISHED' ? 'Standar terbit' : 'Draft konfigurasi';
      setDeleteDraftNotice(`${deletedLabel} berhasil dihapus permanen. ${result.deletedProfileVersionCount} versi profile, ${result.deletedAssignmentCount} assignment zona, ${result.deletedProposalCount} proposal AI, dan ${result.deletedDeviceConfigurationCount} riwayat konfigurasi ESP di server ikut dihapus. Identitas tanaman tetap tersedia untuk setup baru.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plant-catalog', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['plant-catalog-parameter-validations', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['plant-profiles', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['plant-config-devices', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['device-plant-configuration', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['zone-plant-assignments', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['effective-zone-config', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['plant-proposals', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['plant-config-audit', organizationId] }),
      ]);
    },
  });

  const approveStandard = useMutation({
    mutationFn: async () => {
      if (!organizationId || !setupDraft) throw new Error('Simpan atau pulihkan draft sebelum menyetujui standar.');
      const catalog = await apiClient.getPlantCatalogItem(organizationId, setupDraft.catalogId);
      const version = catalog.versions?.find((item) => item.id === setupDraft.catalogVersionId);
      if (!version) throw new Error('Versi draft tidak ditemukan pada katalog organisasi.');
      const profileStages = readStageTemplates(version);
      if (profileStages.length === 0) throw new Error('Tambahkan setidaknya satu growth stage yang valid sebelum menerbitkan standar.');
      const published = version.status === 'PUBLISHED'
        ? version
        : version.status === 'DRAFT'
          ? await apiClient.publishPlantCatalogVersion(organizationId, version.id)
          : (() => { throw new Error(`Versi katalog berstatus ${version.status} dan tidak dapat diterbitkan.`); })();
      setSetupDraft((current) => current?.catalogVersionId === published.id ? { ...current, status: 'PUBLISHED' } : current);

      const profiles = await apiClient.getPlantProfiles(organizationId);
      const profileCode = `${setupDraft.catalogCode.slice(0, 55)}-profile`;
      const codeCollision = profiles.find((item) => item.code === profileCode && item.plantCatalogId !== setupDraft.catalogId);
      if (codeCollision) throw new Error('Kode profile setup telah digunakan katalog lain. Minta admin meninjau Plant Profiles sebelum menyetujui standar ini.');
      const catalogProfiles = profiles.filter((item) => item.plantCatalogId === setupDraft.catalogId);
      let profile: PlantProfile | undefined = catalogProfiles.find((item) => item.code === profileCode);
      if (!profile && catalogProfiles.length === 1) profile = catalogProfiles[0];
      if (!profile && catalogProfiles.length > 1) {
        throw new Error('Ada beberapa profile untuk tanaman ini. Pilih profile yang benar dari halaman Plant Profiles sebelum melanjutkan.');
      }
      if (profile) {
        const latest = profile.versions?.[0];
        if (!latest) throw new Error('Profil ditemukan tanpa versi. Periksa halaman Plant Profile sebelum melanjutkan.');
        if (latest.sourceCatalogVersionId !== published.id) {
          if (latest.status === 'DRAFT') throw new Error('Profil sudah memiliki draft dari standar lain. Selesaikan atau tinjau draft profil tersebut sebelum mengadopsi standar ini.');
          if (latest.status !== 'VALIDATED') throw new Error('Versi profil terbaru belum tervalidasi dan tidak dapat menjadi dasar adopsi.');
          await apiClient.adoptPlantCatalogVersion(organizationId, profile.id, { catalogVersionId: published.id });
        }
      } else {
        profile = await apiClient.createPlantProfile(organizationId, {
          catalogVersionId: published.id,
          code: profileCode,
          name: `Profil ${catalog.commonName}`.trim(),
          stages: profileStages.map(({ code: stageCode, label, sequence, config }) => ({ code: stageCode, label, sequence, config: config ?? {} })),
        });
      }

      if (!profile) {
        profile = (await apiClient.getPlantProfiles(organizationId)).find((item) => item.plantCatalogId === setupDraft.catalogId && item.code === profileCode);
      }
      if (!profile) throw new Error('Standar berhasil diterbitkan, tetapi profile belum tersedia. Buka Plant Profiles dan lanjutkan dari sana.');
      return { profileId: profile.id, catalogVersionId: published.id, version: published.version };
    },
    onSuccess: async (result) => {
      setApprovalError('');
      setApprovalNotice(`Standar diterbitkan. Profile disiapkan dari katalog v${result.version}; validasi profile tetap perlu dilakukan.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plant-catalog', organizationId] }),
        queryClient.invalidateQueries({ queryKey: ['plant-profiles', organizationId] }),
      ]);
    },
    onError: (error) => {
      setApprovalError(errorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ['plant-catalog', organizationId] });
      void queryClient.invalidateQueries({ queryKey: ['plant-profiles', organizationId] });
    },
  });

  const validateParameter = useMutation({
    mutationFn: async ({ parameterId }: { parameterId: string }) => {
      if (!organizationId || !setupDraft || !draftSaved) {
        throw new Error('Simpan draft terlebih dahulu sebelum memvalidasi parameter.');
      }
      return apiClient.validatePlantCatalogParameter(organizationId, setupDraft.catalogVersionId, parameterId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['plant-catalog-parameter-validations', organizationId, setupDraft?.catalogVersionId],
      });
    },
  });

  const applyDeviceConfiguration = useMutation({
    mutationFn: async () => {
      if (!organizationId || !setupDraft || setupDraft.status !== 'PUBLISHED') {
        throw new Error('Terbitkan standar secara eksplisit sebelum mengirim konfigurasi monitoring.');
      }
      const selectedDevice = devicesQuery.data?.find((device) => device.id === selectedDeviceId);
      if (!selectedDevice) throw new Error('Pilih perangkat terlebih dahulu.');
      const validatedKeys = new Set((parameterValidationsQuery.data ?? []).filter(({ validated }) => validated).map(({ parameterKey }) => parameterKey));
      const parameterKeys = selectedParameterKeys.filter((key) => validatedKeys.has(key)
        && selectedDevice.capability.supportedParameterKeys.includes(key));
      if (!parameterKeys.length) throw new Error('Validasi dan pilih setidaknya satu parameter yang didukung firmware dan sensor.');
      return apiClient.applyDevicePlantConfiguration(organizationId, selectedDevice.id, {
        configurationId: crypto.randomUUID(),
        catalogVersionId: setupDraft.catalogVersionId,
        parameterKeys,
      });
    },
    onSuccess: async (delivery) => {
      setDeviceConfigurationId(delivery.configurationId);
      setDeviceApplyError('');
      setDeviceApplyNotice(delivery.status === 'APPLIED'
        ? 'ESP32 mengonfirmasi konfigurasi monitoring telah diterapkan.'
        : 'Broker menerima publish. Ini belum berarti perangkat menerima atau menerapkan konfigurasi.');
      setDeviceApplyConfirmed(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['device-plant-configuration', organizationId, delivery.configurationId] }),
        queryClient.invalidateQueries({ queryKey: ['plant-config-devices', organizationId] }),
      ]);
    },
    onError: (error) => {
      setDeviceApplyError(errorMessage(error));
      setDeviceApplyNotice('');
    },
  });

  function resumeDraft(catalogId: string, versionId: string) {
    setDeleteDraftNotice('');
    const catalog = catalogQuery.data?.find((item) => item.id === catalogId);
    const version = catalog?.versions?.find((item) => item.id === versionId && (item.status === 'DRAFT' || item.status === 'PUBLISHED'));
    if (!catalog || !version) {
      setDraftError('Versi katalog tidak lagi tersedia. Muat ulang daftar katalog.');
      return;
    }
    const method = methodFromCatalogCode(catalog.code);
    setForm({
      commonName: catalog.commonName,
      scientificName: catalog.scientificName,
      cultivar: catalog.cultivar ?? '',
      cultivationMethod: method,
      growthStageContext: '',
    });
    setScientificNameConfirmed(false);
    setCandidate(null);
    setParameters((version.parameterDefinitions ?? []).map((parameter) => ({
      parameterKey: parameter.parameterKey,
      label: parameter.label,
      unit: parameter.unit ?? '',
      dataType: parameter.dataType,
      recommendedValue: null,
      minimumValue: null,
      maximumValue: null,
      note: '',
      evidenceStatus: 'NOT_ASSESSED',
      manuallyEdited: false,
    })));
    setSelectedParameterKeys((version.parameterDefinitions ?? []).map(({ parameterKey }) => parameterKey));
    setStages(readStageTemplates(version));
    setSetupDraft({ catalogId, catalogVersionId: versionId, catalogCode: catalog.code, version: version.version, status: version.status });
    setDraftSaved(true);
    setResumedDraft(true);
    setDraftError('');
    setApprovalError('');
    setApprovalNotice('');
    setDeviceConfigurationId('');
    setDeviceApplyConfirmed(false);
    setDeviceApplyNotice('');
    setDeviceApplyError('');
    setSetupMode(version.status === 'PUBLISHED' ? 'existing' : 'new');
  }

  function startNewSetup() {
    setDeleteDraftNotice('');
    setSetupMode('new');
    setForm(initialForm);
    setScientificNameConfirmed(false);
    setCandidate(null);
    setParameters([]);
    setStages([]);
    setSetupDraft(null);
    setDraftSaved(false);
    setDraftError('');
    setApprovalError('');
    setApprovalNotice('');
    setSelectedParameterKeys([]);
    setSelectedResumeDraft('');
    setDeviceConfigurationId('');
    setDeviceApplyConfirmed(false);
    setDeviceApplyError('');
    setDeviceApplyNotice('');
  }

  function startExistingSelection() {
    setDeleteDraftNotice('');
    setSetupMode('existing');
    setStandardSearch('');
    setCandidate(null);
    setParameters([]);
    setStages([]);
    setSetupDraft(null);
    setDraftSaved(false);
    setDraftError('');
    setApprovalError('');
    setApprovalNotice('');
    setSelectedParameterKeys([]);
    setSelectedDeviceId('');
    setSelectedResumeDraft('');
    setDeviceConfigurationId('');
    setDeviceApplyConfirmed(false);
    setDeviceApplyError('');
    setDeviceApplyNotice('');
  }

  function selectPublishedStandard(catalogId: string, versionId: string) {
    resumeDraft(catalogId, versionId);
  }

  function submitGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDraftError('');
    setApprovalError('');
    if (form.cultivationMethod === 'unknown') {
      setDraftError('Metode budidaya tidak tersimpan pada katalog lama. Pilih metode sebelum generate ulang.');
      return;
    }
    generate.mutate({
      commonName: form.commonName.trim(),
      ...(form.scientificName.trim() ? { scientificName: form.scientificName.trim() } : {}),
      ...(form.cultivar.trim() ? { cultivar: form.cultivar.trim() } : {}),
      cultivationMethod: form.cultivationMethod,
      ...(form.growthStageContext.trim() ? { growthStageContext: form.growthStageContext.trim() } : {}),
    });
  }

  function addParameter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = newParameterLabel.trim();
    if (!label) {
      setDraftError('Nama parameter wajib diisi.');
      return;
    }
    const parameterKey = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!parameterKey) {
      setDraftError('Nama parameter harus dapat dikonversi menjadi key ASCII.');
      return;
    }
    if (parameters.some((item) => item.parameterKey === parameterKey)) {
      setDraftError(`Parameter dengan key "${parameterKey}" sudah ada.`);
      return;
    }
    setParameters((current) => [...current, {
      parameterKey,
      label,
      unit: newParameterUnit.trim(),
      dataType: 'number',
      recommendedValue: null,
      minimumValue: null,
      maximumValue: null,
      note: '',
      evidenceStatus: 'NOT_ASSESSED',
      manuallyEdited: true,
    }]);
    setSelectedParameterKeys((current) => [...current, parameterKey]);
    setNewParameterLabel('');
    setNewParameterUnit('');
    setDraftSaved(false);
    setDraftError('');
  }

  function updateParameterNumber(index: number, field: 'recommendedValue' | 'minimumValue' | 'maximumValue', value: string) {
    const parsed = value.trim() ? Number(value) : null;
    if (parsed !== null && !Number.isFinite(parsed)) return;
    setParameters((current) => current.map((item, row) => row === index
      ? { ...item, [field]: parsed, manuallyEdited: true }
      : item));
    setDraftSaved(false);
  }

  const canGenerate = Boolean(organizationId && canManage && form.commonName.trim() && form.cultivationMethod !== 'unknown' && !generate.isPending);
  const resumableDrafts = (catalogQuery.data ?? []).flatMap((catalog) =>
    (catalog.versions ?? [])
      .filter((version) => version.status === 'DRAFT')
      .map((version) => ({ catalog, version })));
  const publishedStandards = (catalogQuery.data ?? []).flatMap((catalog) =>
    (catalog.versions ?? [])
      .filter((version) => version.status === 'PUBLISHED')
      .map((version) => ({ catalog, version })));
  const normalizedSearch = standardSearch.trim().toLocaleLowerCase();
  const matchingStandards = publishedStandards.filter(({ catalog, version }) => {
    const method = cultivationMethods.find(({ value }) => catalog.code.endsWith(`-${value}`))?.label ?? '';
    const searchableText = [
      catalog.commonName,
      catalog.scientificName,
      catalog.cultivar ?? '',
      catalog.code,
      method,
      `v${version.version}`,
    ].join(' ').toLocaleLowerCase();
    return !normalizedSearch || searchableText.includes(normalizedSearch);
  });
  const hasReview = Boolean(candidate || setupDraft);
  const immutableSetup = setupDraft?.status === 'PUBLISHED';
  function confirmDeleteSelectedVersion() {
    if (!setupDraft) return;
    const label = setupDraft.status === 'DRAFT' ? 'draft' : 'standar';
    const confirmation = `Hapus permanen ${label} ${setupDraft.catalogCode} v${setupDraft.version} beserta semua data yang merujuk: profile dan versi tervalidasi, assignment zona dan keputusan terkait, proposal AI, serta riwayat konfigurasi monitoring di server. Tidak ada perintah dikirim ke ESP; perangkat yang sudah menerima konfigurasi dapat tetap memakainya. Tindakan ini tidak dapat dibatalkan.`;
    if (!window.confirm(confirmation)) return;
    deleteDraft.mutate();
  }
  const selectedDevice = devicesQuery.data?.find((device) => device.id === selectedDeviceId);
  const deviceDelivery = deviceConfigurationQuery.data;
  const validationsByKey = new Map((parameterValidationsQuery.data ?? []).map((validation) => [validation.parameterKey, validation]));
  const validatedParameterKeys = new Set((parameterValidationsQuery.data ?? [])
    .filter(({ validated }) => validated)
    .map(({ parameterKey }) => parameterKey));
  const selectedSupportedParameters = parameters.filter((parameter) =>
    validatedParameterKeys.has(parameter.parameterKey)
      && selectedDevice?.capability.supportedParameterKeys.includes(parameter.parameterKey));
  const canApplyDeviceConfiguration = Boolean(
    organizationId
      && canManage
      && draftSaved
      && immutableSetup
      && selectedDevice?.status === 'ONLINE'
      && selectedDevice.capability.schema === 'plant-monitoring/v1'
      && selectedParameterKeys.some((key) => validatedParameterKeys.has(key)
        && selectedDevice.capability.supportedParameterKeys.includes(key))
      && deviceApplyConfirmed
      && !applyDeviceConfiguration.isPending,
  );

  return <DashboardLayout><main className="mx-auto max-w-6xl space-y-6">
    <header>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400"><Sparkles className="h-4 w-4" /> Plant Standardization</div>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Konfigurasi Tanaman</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">Isi identitas tanaman, buat kandidat parameter, lalu tinjau sebelum menyimpan dan menyetujui standar. Nilai rekomendasi adalah perkiraan awal yang belum terverifikasi; hanya parameter monitoring yang didukung perangkat dapat dikirim ke ESP32.</p>
    </header>
    {!organizationId && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Pilih organisasi terlebih dahulu.</p>}
    {organizationId && !canManage && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Role OWNER atau ADMIN diperlukan untuk membuat setup draft.</p>}

    {organizationId && canManage && setupMode === 'existing' && <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4" aria-labelledby="existing-standard-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="existing-standard-title" className="font-semibold text-white">Pilih standar tanaman yang sudah diterbitkan</h2>
          <p className="mt-1 text-xs text-slate-400">Standar PUBLISHED tidak diubah. Setelah dipilih, Anda langsung dapat memilih perangkat dan parameter monitoring.</p>
        </div>
        <button type="button" onClick={startNewSetup} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">Kembali ke konfigurasi AI</button>
      </div>
      <label className="block space-y-1.5 text-sm text-slate-300">
        <span>Cari nama tanaman, nama ilmiah, varietas, atau metode budidaya</span>
        <input
          type="search"
          value={standardSearch}
          onChange={(event) => setStandardSearch(event.target.value)}
          placeholder="Contoh: Tomat, Solanum lycopersicum, hidroponik tower"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"
        />
      </label>
      {catalogQuery.isLoading && <p role="status" className="text-sm text-slate-300">Memuat standar tanaman organisasi…</p>}
      {catalogQuery.isError && <p role="alert" className="text-sm text-rose-300">{errorMessage(catalogQuery.error)}</p>}
      {!catalogQuery.isLoading && !catalogQuery.isError && publishedStandards.length === 0 && <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Belum ada standar terbit. Gunakan formulir konfigurasi AI untuk memulai.</p>}
      {publishedStandards.length > 0 && matchingStandards.length === 0 && <p className="text-sm text-slate-400">Tidak ada standar terbit yang cocok dengan pencarian.</p>}
      {matchingStandards.length > 0 && <ul className="grid gap-3 md:grid-cols-2">
        {matchingStandards.map(({ catalog, version }) => {
          const method = cultivationMethods.find(({ value }) => catalog.code.endsWith(`-${value}`))?.label ?? 'Metode budidaya belum tercatat';
          const isSelected = setupDraft?.catalogVersionId === version.id;
          return <li key={version.id} className={`rounded-xl border p-4 ${isSelected ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-white">{catalog.commonName}{catalog.cultivar ? ` · ${catalog.cultivar}` : ''}</h3>
                <p className="mt-1 text-xs italic text-slate-400">{catalog.scientificName}</p>
                <p className="mt-1 text-xs text-slate-400">{method} · Katalog {catalog.code} · v{version.version}</p>
                <p className="mt-2 text-xs text-slate-300">{version.parameterDefinitions?.length ?? 0} parameter · {readStageTemplates(version).length} tahap pertumbuhan</p>
              </div>
              <span className="rounded bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200">PUBLISHED</span>
            </div>
            <button type="button" onClick={() => selectPublishedStandard(catalog.id, version.id)} className="mt-3 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/10">
              {isSelected ? 'Standar dipilih' : 'Gunakan standar ini'}
            </button>
          </li>;
        })}
      </ul>}
    </section>}

    {organizationId && canManage && setupMode === 'new' && <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-200">Konfigurasi tanaman baru</p>
        {publishedStandards.length > 0 && <button type="button" onClick={startExistingSelection} className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs text-emerald-100 hover:bg-emerald-500/10">Gunakan standar terbit</button>}
      </div>
      {!catalogQuery.isLoading && !catalogQuery.isError && publishedStandards.length === 0 && <p className="text-sm text-slate-400">Belum ada standar terbit di organisasi ini. Isi identitas tanaman lalu generate kandidat dengan AI.</p>}
      {resumableDrafts.length > 0 && <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 space-y-1.5 text-sm text-slate-300"><span>Lanjutkan draft yang tersimpan</span>
          <select value={selectedResumeDraft} onChange={(event) => setSelectedResumeDraft(event.target.value)} disabled={catalogQuery.isLoading} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white disabled:opacity-60">
            <option value="">{catalogQuery.isLoading ? 'Memuat draft…' : 'Pilih draft DRAFT'}</option>
            {resumableDrafts.map(({ catalog, version }) => <option key={version.id} value={`${catalog.id}:${version.id}`}>{catalog.commonName} · {catalog.scientificName} · v{version.version}</option>)}
          </select>
        </label>
        <button type="button" disabled={!selectedResumeDraft || catalogQuery.isLoading} onClick={() => {
          const [catalogId, versionId] = selectedResumeDraft.split(':');
          if (catalogId && versionId) resumeDraft(catalogId, versionId);
        }} className="rounded-lg border border-slate-700 px-3 py-2.5 text-sm text-slate-200 disabled:opacity-50">Lanjutkan draft</button>
      </div>}
      {catalogQuery.isError && <p role="alert" className="text-sm text-rose-300">{errorMessage(catalogQuery.error)}</p>}
    </section>}

    {setupMode === 'new' && <form onSubmit={submitGenerate} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
      <h2 className="font-semibold text-white">1. Identifikasi tanaman</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm text-slate-300">Nama tanaman *<input required disabled={generate.isPending || saveDraft.isPending} maxLength={120} value={form.commonName} onChange={(event) => updateSetupContext('commonName', event.target.value)} placeholder="Contoh: Tomat" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white disabled:opacity-60" /></label>
        <label className="space-y-1.5 text-sm text-slate-300">Nama ilmiah (opsional)<input disabled={generate.isPending || saveDraft.isPending} maxLength={180} value={form.scientificName} onChange={(event) => updateSetupContext('scientificName', event.target.value)} placeholder="Boleh dikosongkan agar AI mengusulkan kandidat" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white disabled:opacity-60" /></label>
        <label className="space-y-1.5 text-sm text-slate-300">Metode budidaya<select disabled={generate.isPending || saveDraft.isPending} value={form.cultivationMethod} onChange={(event) => updateSetupContext('cultivationMethod', event.target.value as SetupForm['cultivationMethod'])} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white disabled:opacity-60"><option value="unknown">Tidak tercatat pada versi katalog ini</option><option value="hydroponic_tower">Hidroponik tower</option><option value="hydroponic_nft">Hidroponik NFT</option><option value="hydroponic_dwc">Hidroponik DWC</option><option value="soil">Media tanah</option><option value="other">Lainnya</option></select></label>
        <label className="space-y-1.5 text-sm text-slate-300">Varietas (opsional)<input disabled={generate.isPending || saveDraft.isPending} maxLength={120} value={form.cultivar} onChange={(event) => updateSetupContext('cultivar', event.target.value)} placeholder="Masukkan jika diketahui" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white disabled:opacity-60" /></label>
        <label className="space-y-1.5 text-sm text-slate-300 md:col-span-2">Tahap pertumbuhan (opsional)<select disabled={generate.isPending || saveDraft.isPending} value={form.growthStageContext} onChange={(event) => updateSetupContext('growthStageContext', event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white disabled:opacity-60"><option value="">Biarkan AI mengusulkan tahapan</option><option value="Bibit">Bibit</option><option value="Vegetatif">Vegetatif</option><option value="Berbunga">Berbunga</option><option value="Pembentukan buah">Pembentukan buah</option><option value="Berbuah">Berbuah</option><option value="Panen">Panen</option></select></label>
        <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3 text-sm md:col-span-2"><p className="font-medium text-emerald-200">Tujuan konfigurasi</p><p className="mt-1 text-slate-300">Monitoring dan rekomendasi (default). Generate dan simpan draft tidak mengirim MQTT; pengiriman konfigurasi monitoring memerlukan persetujuan terpisah di langkah perangkat.</p></div>
      </div>
      {generate.isError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{errorMessage(generate.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={!canGenerate || generate.isPending || saveDraft.isPending} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{generate.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Sedang menyusun…</> : hasReview ? <><RefreshCw className="h-4 w-4" />Generate Parameter dengan AI</> : <><Sparkles className="h-4 w-4" />Generate Parameter dengan AI</>}</button>
      </div>
      {generate.isPending && <section
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Sedang menyusun rekomendasi"
        className="relative isolate overflow-hidden space-y-4 rounded-2xl border border-emerald-300/25 bg-gradient-to-br from-emerald-950/90 via-slate-900 to-cyan-950/60 p-4 shadow-lg shadow-emerald-950/30 sm:p-5"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-200/20 bg-emerald-300/10">
            <span className="absolute inset-0 animate-ping rounded-2xl bg-emerald-300/10 motion-reduce:animate-none" />
            <Sparkles aria-hidden="true" className="relative h-5 w-5 animate-pulse text-emerald-200 motion-reduce:animate-none" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-emerald-50">Sedang menyiapkan rekomendasi tanaman</p>
              <span aria-hidden="true" className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[11px] text-emerald-100/80">{generationSeconds} dtk</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-300">Kami sedang menyiapkan parameter dan tahap pertumbuhan. Proses dapat memerlukan waktu hingga sekitar satu menit.</p>
          </div>
        </div>
        <div aria-hidden="true" className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-gradient-to-r from-emerald-300 via-cyan-200 to-emerald-300 motion-reduce:animate-none" />
        </div>
        <div aria-hidden="true" className="grid gap-2 sm:grid-cols-3">
          {['Identitas tanaman', 'Parameter', 'Tahap pertumbuhan'].map((step, index) => <div key={step} className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/15 px-3 py-2 text-[11px] text-slate-300">
            <span style={{ animationDelay: `${index * 180}ms` }} className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 motion-reduce:animate-none" />
            {step}
          </div>)}
        </div>
      </section>}
    </form>}

    {hasReview && <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
      <div><h2 className="font-semibold text-white">{immutableSetup ? 'Standar terbit dipilih' : '2. Tinjau parameter dan growth stage'}</h2><p className="mt-1 text-xs text-slate-400">{immutableSetup ? <>Standar ini sudah diterbitkan dan tidak dapat diedit. Pilih parameter yang didukung lalu kirim ke perangkat.</> : candidate ? <>Rekomendasi otomatis · nilai yang ditampilkan masih kandidat dan perlu ditinjau.</> : <>Draft parameter dipulihkan; hasil AI sebelumnya tidak disimpan dalam standar.</>}</p></div>
      <ol className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5" aria-label="Status proses setup">
        <li className="rounded-lg bg-emerald-500/10 p-3 text-emerald-200">✓ Tanaman diidentifikasi</li>
        <li className="rounded-lg bg-amber-500/10 p-3 text-amber-200">! Referensi/evidence belum diperiksa</li>
        <li className="rounded-lg bg-emerald-500/10 p-3 text-emerald-200">{candidate ? '✓ Kandidat parameter disusun' : 'Draft parameter dipulihkan'}</li>
        <li className="rounded-lg bg-amber-500/10 p-3 text-amber-200">Menunggu review manusia</li>
        <li className={`rounded-lg p-3 ${draftSaved ? 'bg-emerald-500/10 text-emerald-200' : 'bg-slate-950 text-slate-400'}`}>{draftSaved ? '✓ Draft siap ditinjau untuk persetujuan' : 'Belum siap disetujui sebelum draft disimpan'}</li>
      </ol>
      {!immutableSetup && !form.scientificName.trim() && <p role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Isi nama ilmiah di formulir untuk menyimpan draft. Jika AI mengusulkan nama, periksa atau edit terlebih dahulu.</p>}
      {!immutableSetup && form.scientificName.trim() && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-sm text-amber-100">{candidate?.scientificNameSuggestion ? <>Usulan nama ilmiah AI: <em>{candidate.scientificNameSuggestion}</em>.</> : <>Nama ilmiah: <em>{form.scientificName}</em>.</>} Simpan draft tidak memerlukan konfirmasi ini. Periksa nama sebelum menyetujui standar.</p>
        <label className="mt-2 flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={scientificNameConfirmed} onChange={(event) => setScientificNameConfirmed(event.target.checked)} className="mt-0.5 accent-emerald-500" />Saya sudah memeriksa nama ilmiah dan menyetujuinya untuk publikasi standar.</label>
      </div>}
      {!immutableSetup && <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-400/30 bg-slate-950/95 p-3 shadow-xl shadow-black/30 backdrop-blur">
        <p className="text-xs text-slate-300">Langkah berikut: simpan kandidat sebagai draft. Belum ada standar yang diterbitkan atau konfigurasi yang dikirim ke perangkat.</p>
        <div className="flex flex-wrap gap-2">
          {setupDraft && setupDraft.status === 'DRAFT' && <button type="button" disabled={deleteDraft.isPending || saveDraft.isPending || !canManage} onClick={confirmDeleteSelectedVersion} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-rose-500/40 px-4 py-2.5 text-sm font-semibold text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50">
            {deleteDraft.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Menghapus draft…</> : <><Trash2 className="h-4 w-4" />Hapus draft</>}
          </button>}
          <button type="button" disabled={saveDraft.isPending || deleteDraft.isPending || !canManage || !form.scientificName.trim() || parameters.length === 0 || stages.length === 0} onClick={() => { setDraftError(''); setDraftSaved(false); saveDraft.mutate(); }} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50">{saveDraft.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Menyimpan draft…</> : 'Simpan draft setup'}</button>
        </div>
      </div>}
      {candidate?.findings.map((item) => <p key={item.code} className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{item.code}: {item.explanation}</p>)}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase text-slate-400"><tr><th className="px-3 py-3">Parameter / key</th><th className="px-3 py-3">Rekomendasi</th><th className="px-3 py-3">Rentang</th><th className="px-3 py-3">Satuan</th><th className="px-3 py-3">Tahap</th><th className="px-3 py-3">Evidence</th><th className="px-3 py-3">Validasi pengguna</th><th className="px-3 py-3">Aksi</th></tr></thead>
          <tbody>{parameters.map((parameter, index) => <tr key={parameter.parameterKey} className="border-t border-slate-800">
            <td className="space-y-1 px-3 py-3"><input disabled={saveDraft.isPending || immutableSetup} aria-label={`Nama ${parameter.parameterKey}`} value={parameter.label} onChange={(event) => { setParameters((current) => current.map((item, row) => row === index ? { ...item, label: event.target.value, manuallyEdited: true } : item)); setDraftSaved(false); }} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white disabled:opacity-60" /><span className="block font-mono text-[11px] text-slate-500">{parameter.parameterKey}{parameter.manuallyEdited ? ' · diubah manual' : ''}</span></td>
            <td className="px-3 py-3"><input type="number" step="any" disabled={saveDraft.isPending || immutableSetup} aria-label={`Rekomendasi ${parameter.parameterKey}`} value={parameter.recommendedValue ?? ''} onChange={(event) => updateParameterNumber(index, 'recommendedValue', event.target.value)} placeholder="Belum diusulkan" className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white disabled:opacity-60" /><p className="mt-1 max-w-48 text-[11px] text-amber-300">{parameter.note || 'Kandidat AI · belum diverifikasi'}{parameter.manuallyEdited ? ' · perubahan manusia perlu ditinjau' : ''}</p></td>
            <td className="space-y-1 px-3 py-3"><label className="flex items-center gap-1 text-[10px] text-slate-500">Min<input type="number" step="any" disabled={saveDraft.isPending || immutableSetup} aria-label={`Minimum ${parameter.parameterKey}`} value={parameter.minimumValue ?? ''} onChange={(event) => updateParameterNumber(index, 'minimumValue', event.target.value)} className="w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-white disabled:opacity-60" /></label><label className="flex items-center gap-1 text-[10px] text-slate-500">Maks<input type="number" step="any" disabled={saveDraft.isPending || immutableSetup} aria-label={`Maksimum ${parameter.parameterKey}`} value={parameter.maximumValue ?? ''} onChange={(event) => updateParameterNumber(index, 'maximumValue', event.target.value)} className="w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-white disabled:opacity-60" /></label>{parameter.minimumValue !== null && parameter.maximumValue !== null && parameter.minimumValue > parameter.maximumValue && <p role="alert" className="text-[11px] text-rose-300">Rentang tidak valid</p>}</td>
            <td className="px-3 py-3"><input disabled={saveDraft.isPending || immutableSetup} aria-label={`Unit ${parameter.parameterKey}`} value={parameter.unit} onChange={(event) => { setParameters((current) => current.map((item, row) => row === index ? { ...item, unit: event.target.value, manuallyEdited: true } : item)); setDraftSaved(false); }} placeholder="Belum ditetapkan" className="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white disabled:opacity-60" /></td>
            <td className="px-3 py-3 text-xs text-slate-300">{stages.map((item) => item.label).join(', ') || '—'}</td>
            <td className="px-3 py-3"><span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-200">Belum diperiksa</span></td>
            <td className="space-y-1 px-3 py-3">
              {validationsByKey.get(parameter.parameterKey)?.validated
                ? <span className="block text-xs text-emerald-300">Divalidasi oleh user {validationsByKey.get(parameter.parameterKey)?.validatedByUserId} · {validationsByKey.get(parameter.parameterKey)?.validatedAt ? new Date(validationsByKey.get(parameter.parameterKey)!.validatedAt!).toLocaleString() : ''}</span>
                : <span className="block text-xs text-amber-300">{draftSaved ? 'Belum divalidasi atau perlu validasi ulang.' : 'Simpan draft untuk mencatat validasi.'}</span>}
              <button
                type="button"
                disabled={!draftSaved || !setupDraft || !validationsByKey.get(parameter.parameterKey)?.parameterId || validateParameter.isPending || parameterValidationsQuery.isLoading}
                onClick={() => {
                  const parameterId = validationsByKey.get(parameter.parameterKey)?.parameterId;
                  if (parameterId) validateParameter.mutate({ parameterId });
                }}
                aria-label={`Validasi ${parameter.parameterKey} oleh saya`}
                className="rounded border border-emerald-500/30 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validateParameter.isPending && validateParameter.variables?.parameterId === validationsByKey.get(parameter.parameterKey)?.parameterId
                  ? 'Mencatat…'
                  : validationsByKey.get(parameter.parameterKey)?.validated ? 'Validasi ulang' : 'Validasi oleh saya'}
              </button>
            </td>
            <td className="px-3 py-3"><button type="button" disabled={saveDraft.isPending || immutableSetup} aria-label={`Hapus ${parameter.parameterKey}`} onClick={() => { setParameters((current) => current.filter((_, row) => row !== index)); setSelectedParameterKeys((current) => current.filter((key) => key !== parameter.parameterKey)); setDraftSaved(false); }} className="rounded p-2 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {parameterValidationsQuery.isError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{errorMessage(parameterValidationsQuery.error)}</p>}
      {validateParameter.isError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{errorMessage(validateParameter.error)}</p>}
      <p className="text-xs text-slate-500">Validasi ini mencatat bahwa pengguna meninjau definisi parameter. Ini bukan verifikasi evidence agronomi. Jika definisi berubah, validasi lama tidak berlaku dan perlu diulang.</p>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
        <h3 className="font-medium text-amber-100">Nilai AI belum didukung bukti terverifikasi</h3>
        <p className="mt-1 text-xs text-slate-300">Anda dapat mengubah nilai dan satuan untuk ditinjau. Perubahan ditandai sebagai manual dan tidak menaikkan status evidence. Nilai kandidat tidak disimpan ke standar atau dikirim ke ESP32; draft menyimpan identitas parameter dan tahap saja. Hanya rekomendasi yang didukung evidence terverifikasi dapat masuk alur standar agronomi.</p>
      </div>
      {candidate && <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4" aria-labelledby="source-candidates-title">
        <div>
          <h3 id="source-candidates-title" className="font-medium text-slate-100">Referensi publik yang ditemukan — perlu diperiksa</h3>
          <p className="mt-1 text-xs text-slate-400">Metadata berikut berasal dari Crossref/OpenAlex. Judul dan tautan tidak membuktikan bahwa isi sumber mendukung suatu angka; belum ada evidence yang diverifikasi.</p>
        </div>
        {candidate.sourceSearchWarning && <p role="status" className="text-xs text-amber-200">{candidate.sourceSearchWarning}</p>}
        {candidate.sourceCandidates.length === 0
          ? <p className="text-xs text-slate-400">{candidate.sourceSearchStatus === 'UNAVAILABLE' ? 'Pencarian sumber sementara tidak tersedia.' : 'Belum ada metadata publik yang ditemukan untuk pencarian ini.'}</p>
          : <ul className="space-y-2">{candidate.sourceCandidates.map((source, index) => <li key={`${source.provider}-${source.doi ?? source.title}-${index}`} className="rounded-lg border border-slate-800 p-3">
            <p className="text-sm text-slate-200">{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-slate-500 underline-offset-2 hover:text-emerald-200">{source.title}</a> : source.title}</p>
            <p className="mt-1 text-xs text-slate-500">{source.authors.join(', ')}{source.publicationYear ? ` · ${source.publicationYear}` : ''}{source.journal ? ` · ${source.journal}` : ''} · {source.provider}{source.doi ? ` · DOI: ${source.doi}` : ''}</p>
          </li>)}</ul>}
      </section>}
      <form onSubmit={addParameter} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 sm:flex-row">
        <input required disabled={saveDraft.isPending || immutableSetup} value={newParameterLabel} onChange={(event) => setNewParameterLabel(event.target.value)} placeholder="Tambah parameter draft" aria-label="Nama parameter baru" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60" />
        <input disabled={saveDraft.isPending || immutableSetup} value={newParameterUnit} onChange={(event) => setNewParameterUnit(event.target.value)} placeholder="Unit bila sudah diketahui" aria-label="Unit parameter baru" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60" />
        <button disabled={saveDraft.isPending || immutableSetup} className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-60"><Plus className="h-4 w-4" />Tambah</button>
      </form>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-slate-200">Growth stage kandidat (dapat diedit)</h3>
        {stages.map((stage, index) => <div key={stage.code} className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto]">
          <input disabled={saveDraft.isPending || immutableSetup} aria-label={`Kode stage ${stage.sequence}`} value={stage.code} onChange={(event) => { setStages((current) => current.map((item, row) => row === index ? { ...item, code: event.target.value } : item)); setDraftSaved(false); }} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-white disabled:opacity-60" />
          <input disabled={saveDraft.isPending || immutableSetup} aria-label={`Label stage ${stage.sequence}`} value={stage.label} onChange={(event) => { setStages((current) => current.map((item, row) => row === index ? { ...item, label: event.target.value } : item)); setDraftSaved(false); }} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60" />
          <input disabled={saveDraft.isPending || immutableSetup} aria-label={`Urutan stage ${stage.sequence}`} type="number" min="1" value={stage.sequence} onChange={(event) => { setStages((current) => current.map((item, row) => row === index ? { ...item, sequence: Number(event.target.value) } : item)); setDraftSaved(false); }} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60" />
          <button type="button" disabled={saveDraft.isPending || immutableSetup} aria-label={`Hapus stage ${stage.code}`} onClick={() => { setStages((current) => current.filter((_, row) => row !== index)); setDraftSaved(false); }} className="rounded p-2 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
        </div>)}
      </div>
      {draftError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{draftError}</p>}
      {draftSaved && setupDraft && <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-100">
        <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" />{immutableSetup ? 'Standar terbit siap digunakan.' : resumedDraft ? 'Draft dipulihkan dari penyimpanan.' : 'Draft tersimpan — belum divalidasi atau diterbitkan.'}</p>
        <p className="mt-1 text-xs text-slate-300">Katalog {setupDraft.catalogCode}, versi {setupDraft.version} · {setupDraft.status}.{immutableSetup ? ' Standar terbit bersifat tetap; Anda dapat langsung memilih perangkat monitoring.' : ' Publish memakai validator backend; profile hasilnya tetap DRAFT dan perlu divalidasi terpisah.'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!immutableSetup && <button type="button" disabled={!scientificNameConfirmed || !canManage || approveStandard.isPending || saveDraft.isPending || !draftSaved} onClick={() => {
            if (!window.confirm(`Setujui dan terbitkan Plant Standard ${setupDraft.catalogCode} v${setupDraft.version}? Versi yang terbit tidak dapat diedit. Ini menerbitkan identitas parameter/stage tanpa nilai agronomi atau bukti baru.`)) return;
            setApprovalError('');
            setApprovalNotice('');
            approveStandard.mutate();
          }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{approveStandard.isPending ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Memvalidasi dan menerbitkan…</> : 'Setujui & terbitkan standar'}</button>}
        </div>
      </div>}
      {approvalError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{approvalError} Jika standar sudah terbit, lanjutkan dengan tombol yang sama untuk melanjutkan penyiapan profile.</p>}
      {approvalNotice && <div role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">{approvalNotice}</div>}
      {immutableSetup && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-xs text-amber-100">Versi ini sudah PUBLISHED dan tidak dapat diedit. Perubahan standar memerlukan versi katalog baru.</p>
        <button type="button" disabled={deleteDraft.isPending || !canManage} onClick={confirmDeleteSelectedVersion} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-rose-500/40 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50">
          {deleteDraft.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Menghapus…</> : <><Trash2 className="h-4 w-4" />Hapus standar terbit</>}
        </button>
      </div>}
      {immutableSetup && <section className="space-y-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4" aria-labelledby="device-config-title">
        <div>
          <h2 id="device-config-title" className="font-semibold text-cyan-100">4. Pilih perangkat monitoring</h2>
          <p className="mt-1 text-xs text-slate-300">Konfigurasi hanya mengatur sensor telemetry yang dikirim ESP32. Pengiriman dilakukan setelah konfirmasi terpisah di bawah ini; topic dan handler aktuator ON/OFF tidak digunakan.</p>
        </div>
        {devicesQuery.isLoading && <p role="status" className="text-sm text-slate-300">Memuat daftar ESP32-S3 dan status firmware…</p>}
        {devicesQuery.isError && <p role="alert" className="text-sm text-rose-300">{errorMessage(devicesQuery.error)}</p>}
        {!devicesQuery.isLoading && !devicesQuery.isError && <label className="block space-y-1.5 text-sm text-slate-300">
          <span>Perangkat dari organisasi ini</span>
          <select value={selectedDeviceId} onChange={(event) => {
            const id = event.target.value;
            const selected = devicesQuery.data?.find((device) => device.id === id);
            setSelectedDeviceId(id);
            setDeviceConfigurationId(selected?.lastConfiguration?.configurationId ?? '');
            setDeviceApplyConfirmed(false);
            setDeviceApplyError('');
            setDeviceApplyNotice('');
          }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white">
            <option value="">Pilih perangkat</option>
            {(devicesQuery.data ?? []).map((device) => <option key={device.id} value={device.id}>
              {device.name} · {device.greenhouse.code} · {device.status}
            </option>)}
          </select>
        </label>}
        {selectedDevice && <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/70 p-3">
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <p className="text-slate-200">{selectedDevice.name} · ID {selectedDevice.deviceId} · firmware {selectedDevice.firmwareVersion ?? 'belum dilaporkan'}</p>
            <p className={selectedDevice.status === 'ONLINE' ? 'text-emerald-300' : 'text-amber-300'}>
              {selectedDevice.status} · heartbeat {selectedDevice.lastSeenAt ? new Date(selectedDevice.lastSeenAt).toLocaleString() : 'belum ada'}
            </p>
          </div>
          {selectedDevice.capability.schema !== 'plant-monitoring/v1'
            ? <div role="alert" className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">
              <p>Perangkat belum mengiklankan dukungan konfigurasi monitoring pada heartbeat terakhir. Versi terdeteksi: {selectedDevice.firmwareVersion ?? 'tidak diketahui'} · heartbeat: {selectedDevice.lastSeenAt ? new Date(selectedDevice.lastSeenAt).toLocaleString() : 'belum ada'}.</p>
              <p className="text-xs text-amber-200">Firmware 1.1.0 atau lebih baru diperlukan. Upload firmware dari folder <code>firmware/esp32_s3_greenhouse</code> ke ESP32, pastikan perangkat tersambung ke broker, lalu tunggu heartbeat berikutnya. Tidak ada konfigurasi yang dikirim sebelum dukungan terdeteksi.</p>
            </div>
            : <>
              {selectedDevice.capability.sensorDataMode === 'SIMULATED' && <p className="rounded border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-200">Firmware melaporkan data sensor SIMULASI, bukan pembacaan sensor fisik. Konfigurasi ini tidak membuktikan sensor fisik terpasang atau terkalibrasi.</p>}
              <p className="text-xs text-slate-400">Kanal sensor firmware: {selectedDevice.capability.sensorCodes.join(', ') || 'belum dilaporkan'}</p>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-200">Parameter katalog yang dipantau</legend>
                {parameters.map((parameter) => {
                  const supported = selectedDevice.capability.supportedParameterKeys.includes(parameter.parameterKey);
                  return <label key={parameter.parameterKey} className={`flex items-center gap-2 text-sm ${supported ? 'text-slate-200' : 'text-slate-500'}`}>
                    <input
                      type="checkbox"
                      disabled={!supported || !validatedParameterKeys.has(parameter.parameterKey) || applyDeviceConfiguration.isPending}
                      checked={selectedParameterKeys.includes(parameter.parameterKey)}
                      onChange={(event) => {
                        setSelectedParameterKeys((current) => event.target.checked
                          ? [...current, parameter.parameterKey]
                          : current.filter((key) => key !== parameter.parameterKey));
                        setDeviceApplyConfirmed(false);
                        setDeviceApplyError('');
                      }}
                      className="accent-cyan-500 disabled:opacity-40"
                    />
                    <span>{parameter.label} <span className="font-mono text-xs text-slate-500">({parameter.parameterKey})</span></span>
                    {!supported
                      ? <span className="text-xs">— belum didukung firmware/sensor perangkat ini</span>
                      : !validatedParameterKeys.has(parameter.parameterKey) && <span className="text-xs">— validasi pengguna diperlukan</span>}
                  </label>;
                })}
                {selectedSupportedParameters.length === 0 && <p className="text-xs text-amber-200">Belum ada parameter yang sekaligus didukung perangkat dan divalidasi pengguna.</p>}
              </fieldset>
            </>}
        </div>}
        {selectedDevice?.lastConfiguration && <p className="text-xs text-slate-300">Pengiriman terakhir v{selectedDevice.lastConfiguration.version}: {deviceDeliveryLabel(selectedDevice.lastConfiguration.status)}</p>}
        {deviceConfigurationQuery.isError && <p role="alert" className="text-sm text-rose-300">{errorMessage(deviceConfigurationQuery.error)}</p>}
        {deviceDelivery && <div role="status" className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
          <p className="font-medium">{deviceDeliveryLabel(deviceDelivery.status)}</p>
          <p className="mt-1 text-xs text-slate-300">Konfigurasi v{deviceDelivery.version} · broker publish {deviceDelivery.sentAt ? 'terkonfirmasi' : 'belum terkonfirmasi'} · ACK perangkat {deviceDelivery.receivedAt ? 'diterima' : 'belum diterima'} · penerapan {deviceDelivery.appliedAt ? 'dikonfirmasi ESP32' : 'belum dikonfirmasi'}.</p>
          {deviceDelivery.error && <p className="mt-1 text-xs text-rose-200">{deviceDelivery.error}</p>}
        </div>}
        {deviceApplyNotice && !deviceDelivery && <p role="status" className="text-xs text-cyan-200">{deviceApplyNotice}</p>}
        {deviceApplyError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{deviceApplyError}</p>}
        {selectedDevice?.capability.schema === 'plant-monitoring/v1' && <div className="space-y-3 border-t border-slate-800 pt-3">
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={deviceApplyConfirmed} onChange={(event) => setDeviceApplyConfirmed(event.target.checked)} className="mt-0.5 accent-cyan-500" />
            Saya menyetujui pengiriman konfigurasi monitoring untuk standar yang sudah diterbitkan. Ini hanya memilih sensor telemetry; tidak mengirim perintah ON/OFF, tidak mengubah relay, dan tidak mengaktifkan kendali otomatis.
          </label>
          <button type="button" disabled={!canApplyDeviceConfiguration} onClick={() => applyDeviceConfiguration.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {applyDeviceConfiguration.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Mengirim konfigurasi monitoring…</> : 'Terapkan konfigurasi monitoring ke ESP32'}
          </button>
        </div>}
      </section>}
      {!immutableSetup && <p className="text-xs text-slate-500">Draft menyimpan identitas parameter dan tahap pertumbuhan. Angka AI serta metadata referensi tetap kandidat sementara dan tidak menjadi nilai standar, evidence, atau perintah aktuator.</p>}
      {saveDraft.isError && !draftError && <p role="alert" className="text-sm text-rose-300">{errorMessage(saveDraft.error)}</p>}
    </section>}
    {deleteDraft.isError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{errorMessage(deleteDraft.error)}</p>}
    {deleteDraftNotice && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-100">{deleteDraftNotice}</p>}
    {!hasReview && <section className="grid gap-4 md:grid-cols-3">
      {[['Identifikasi', 'Nama tanaman dan metode budidaya menjadi konteks prompt AI.'], ['Sumber & evidence', 'Sumber ilmiah harus ditinjau dan dimasukkan melalui workflow evidence terpisah.'], ['Draft aman', 'Output disimpan sebagai konfigurasi DRAFT; tidak ada standard publish otomatis.']].map(([title, detail], index) => <article key={title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><p className="text-xs font-semibold uppercase text-emerald-300">Langkah {index + 1}</p><h2 className="mt-2 text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-slate-400">{detail}</p></article>)}
    </section>}
  </main></DashboardLayout>;
}
