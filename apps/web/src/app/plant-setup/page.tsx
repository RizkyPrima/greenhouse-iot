'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
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
type ParameterRow = { parameterKey: string; label: string; unit: string; dataType: string; evidenceStatus: 'NOT_ASSESSED'; manuallyEdited: boolean };
type SetupDraft = { catalogId: string; catalogVersionId: string; catalogCode: string; version: number; status: PlantCatalogVersion['status'] };
type SetupStage = { code: string; label: string; sequence: number; config?: PlantJsonObject };

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
  const shaped = error as Error & { status?: number; code?: string };
  if (shaped.status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
  if (shaped.status === 403) return 'Role OWNER/ADMIN organisasi diperlukan untuk membuat setup tanaman.';
  if (shaped.status === 409) return shaped.message || 'Draft atau identitas katalog bertentangan dengan data yang sudah ada.';
  if (shaped.status === 422 || shaped.status === 400) return shaped.message || 'Data setup tidak sesuai validasi backend.';
  if (shaped.code === 'LLM_PROVIDER_TIMEOUT') return 'Gemini tidak merespons tepat waktu. Tidak ada draft yang disimpan.';
  if (shaped.code === 'LLM_QUOTA_EXCEEDED') return 'Kuota Gemini untuk project ini habis. Tidak ada draft yang disimpan.';
  if (shaped.code === 'LLM_MODEL_UNAVAILABLE') return 'Model Gemini yang dikonfigurasi tidak tersedia untuk project ini.';
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

export default function PlantSetupPage() {
  const { currentOrg, currentMembership } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = currentOrg?.id;
  const canManage = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const [form, setForm] = useState(initialForm);
  const [scientificNameConfirmed, setScientificNameConfirmed] = useState(false);
  const [candidate, setCandidate] = useState<PlantSetupCandidateResult | null>(null);
  const [parameters, setParameters] = useState<ParameterRow[]>([]);
  const [stages, setStages] = useState<SetupStage[]>([]);
  const [newParameterLabel, setNewParameterLabel] = useState('');
  const [newParameterUnit, setNewParameterUnit] = useState('');
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [approvalNotice, setApprovalNotice] = useState('');
  const [resumedDraft, setResumedDraft] = useState(false);
  const [selectedResumeDraft, setSelectedResumeDraft] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedParameterKeys, setSelectedParameterKeys] = useState<string[]>([]);
  const [deviceApplyConfirmed, setDeviceApplyConfirmed] = useState(false);
  const [deviceConfigurationId, setDeviceConfigurationId] = useState('');
  const [deviceApplyError, setDeviceApplyError] = useState('');
  const [deviceApplyNotice, setDeviceApplyNotice] = useState('');
  const [approvedProfileId, setApprovedProfileId] = useState<string | null>(null);

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
  const deviceConfigurationQuery = useQuery({
    queryKey: ['device-plant-configuration', organizationId, deviceConfigurationId],
    queryFn: () => apiClient.getDevicePlantConfiguration(organizationId!, deviceConfigurationId),
    enabled: Boolean(organizationId && canManage && deviceConfigurationId),
    refetchInterval: (query) => {
      const status = (query.state.data as DevicePlantConfigurationDelivery | undefined)?.status;
      return status && ['APPLIED', 'REJECTED', 'TIMEOUT', 'FAILED'].includes(status) ? false : 2_000;
    },
  });
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
    setApprovedProfileId(null);
  }
  const generate = useMutation({
    mutationFn: (payload: GeneratePlantSetupDto) => apiClient.generatePlantSetup(organizationId!, payload),
    onSuccess: (result) => {
      setCandidate(result);
      setParameters(result.parameters.map((item) => ({
        parameterKey: item.parameterKey,
        label: item.label,
        unit: '',
        dataType: item.dataType,
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
      setApprovedProfileId(null);
      setDeviceApplyConfirmed(false);
      setDeviceConfigurationId('');
      setDeviceApplyNotice('');
    },
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!organizationId || (!candidate && !setupDraft)) throw new Error('Generate kandidat atau lanjutkan draft setup sebelum menyimpan.');
      const scientificName = form.scientificName.trim();
      if (!scientificName || !scientificNameConfirmed) throw new Error('Konfirmasi nama ilmiah yang akan disimpan setelah memeriksanya.');
      if (!parameters.length || !stages.length) throw new Error('Draft perlu minimal satu parameter dan satu growth stage.');

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
      setApprovedProfileId(null);
      setDeviceConfigurationId('');
      setDeviceApplyConfirmed(false);
      setDeviceApplyNotice('');
    },
    onError: (error) => {
      setDraftSaved(false);
      setDraftError(errorMessage(error));
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
      setApprovedProfileId(result.profileId);
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

  const applyDeviceConfiguration = useMutation({
    mutationFn: async () => {
      if (!organizationId || !setupDraft || setupDraft.status !== 'PUBLISHED') {
        throw new Error('Terbitkan standar secara eksplisit sebelum mengirim konfigurasi monitoring.');
      }
      const selectedDevice = devicesQuery.data?.find((device) => device.id === selectedDeviceId);
      if (!selectedDevice) throw new Error('Pilih perangkat terlebih dahulu.');
      const parameterKeys = selectedParameterKeys.filter((key) => selectedDevice.capability.supportedParameterKeys.includes(key));
      if (!parameterKeys.length) throw new Error('Pilih setidaknya satu parameter yang didukung oleh firmware dan sensor terdaftar.');
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
    setApprovedProfileId(null);
    setDeviceConfigurationId('');
    setDeviceApplyConfirmed(false);
    setDeviceApplyNotice('');
    setDeviceApplyError('');
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
    setParameters((current) => [...current, { parameterKey, label, unit: newParameterUnit.trim(), dataType: 'number', evidenceStatus: 'NOT_ASSESSED', manuallyEdited: true }]);
    setSelectedParameterKeys((current) => [...current, parameterKey]);
    setNewParameterLabel('');
    setNewParameterUnit('');
    setDraftSaved(false);
    setDraftError('');
  }

  const canGenerate = Boolean(organizationId && canManage && form.commonName.trim() && form.cultivationMethod !== 'unknown' && !generate.isPending);
  const resumableDrafts = (catalogQuery.data ?? []).flatMap((catalog) =>
    (catalog.versions ?? [])
      .filter((version) => version.status === 'DRAFT' || version.status === 'PUBLISHED')
      .map((version) => ({ catalog, version })));
  const hasReview = Boolean(candidate || setupDraft);
  const immutableSetup = setupDraft?.status === 'PUBLISHED';
  const selectedDevice = devicesQuery.data?.find((device) => device.id === selectedDeviceId);
  const deviceDelivery = deviceConfigurationQuery.data;
  const selectedSupportedParameters = parameters.filter((parameter) =>
    selectedDevice?.capability.supportedParameterKeys.includes(parameter.parameterKey));
  const canApplyDeviceConfiguration = Boolean(
    organizationId
      && canManage
      && draftSaved
      && immutableSetup
      && selectedDevice?.status === 'ONLINE'
      && selectedDevice.capability.schema === 'plant-monitoring/v1'
      && selectedParameterKeys.some((key) => selectedDevice.capability.supportedParameterKeys.includes(key))
      && deviceApplyConfirmed
      && !applyDeviceConfiguration.isPending,
  );

  return <DashboardLayout><main className="mx-auto max-w-6xl space-y-6">
    <header>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400"><Sparkles className="h-4 w-4" /> Plant Standardization</div>
      <h1 className="text-2xl font-bold text-white sm:text-3xl">Konfigurasi Tanaman</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">Satu alur untuk menyusun Plant Standard dengan bantuan Gemini, meninjau parameter, menerbitkan standar secara eksplisit, lalu memilih sensor ESP32-S3 untuk monitoring. Gemini tidak menghasilkan setpoint, rentang, satuan, kutipan, atau evidence.</p>
    </header>
    {!organizationId && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Pilih organisasi terlebih dahulu.</p>}
    {organizationId && !canManage && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200">Role OWNER atau ADMIN diperlukan untuk membuat setup draft.</p>}

    {organizationId && canManage && <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <label className="block space-y-2 text-sm text-slate-300"><span>Lanjutkan setup tersimpan</span>
        <select value={selectedResumeDraft} onChange={(event) => setSelectedResumeDraft(event.target.value)} disabled={catalogQuery.isLoading || !resumableDrafts.length} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white disabled:opacity-60">
          <option value="">{catalogQuery.isLoading ? 'Memuat draft…' : resumableDrafts.length ? 'Pilih draft katalog' : 'Belum ada draft katalog'}</option>
          {resumableDrafts.map(({ catalog, version }) => <option key={version.id} value={`${catalog.id}:${version.id}`}>{catalog.commonName} · {catalog.scientificName} · v{version.version} · {version.status}</option>)}
        </select>
      </label>
      <button type="button" disabled={!selectedResumeDraft || catalogQuery.isLoading} onClick={() => {
        const [catalogId, versionId] = selectedResumeDraft.split(':');
        if (catalogId && versionId) resumeDraft(catalogId, versionId);
      }} className="mt-3 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">Buka draft tersimpan</button>
      {catalogQuery.isError && <p role="alert" className="mt-3 text-sm text-rose-300">{errorMessage(catalogQuery.error)}</p>}
    </section>}

    <form onSubmit={submitGenerate} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
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
        <button disabled={!canGenerate || saveDraft.isPending} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{generate.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Meminta kandidat ke Gemini…</> : hasReview ? <><RefreshCw className="h-4 w-4" />Generate Parameter dengan AI</> : <><Sparkles className="h-4 w-4" />Generate Parameter dengan AI</>}</button>
      </div>
      {generate.isPending && <ol aria-live="polite" className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <li className="rounded-lg bg-slate-950 p-3 text-emerald-300">1. Mengidentifikasi tanaman dan konteks budidaya</li>
        <li className="rounded-lg bg-slate-950 p-3">2. Meminta Gemini menyusun kandidat parameter dan stage</li>
      </ol>}
    </form>

    {hasReview && <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
      <div><h2 className="font-semibold text-white">2. Tinjau parameter dan growth stage</h2><p className="mt-1 text-xs text-slate-400">{candidate ? <>Provider: {candidate.provider.name}{candidate.provider.model ? ` · ${candidate.provider.model}` : ''} · kandidat AI.</> : <>Draft dipulihkan dari katalog · belum ada hasil generasi AI yang dipulihkan.</>} Hasil AI adalah identitas kandidat, bukan rekomendasi nilai.</p></div>
      <ol className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5" aria-label="Status proses setup">
        <li className="rounded-lg bg-emerald-500/10 p-3 text-emerald-200">✓ Tanaman diidentifikasi</li>
        <li className="rounded-lg bg-amber-500/10 p-3 text-amber-200">! Referensi/evidence belum diperiksa</li>
        <li className="rounded-lg bg-emerald-500/10 p-3 text-emerald-200">{candidate ? '✓ Kandidat parameter disusun' : 'Draft parameter dipulihkan'}</li>
        <li className="rounded-lg bg-amber-500/10 p-3 text-amber-200">Menunggu review manusia</li>
        <li className={`rounded-lg p-3 ${draftSaved ? 'bg-emerald-500/10 text-emerald-200' : 'bg-slate-950 text-slate-400'}`}>{draftSaved ? '✓ Draft siap ditinjau untuk persetujuan' : 'Belum siap disetujui sebelum draft disimpan'}</li>
      </ol>
      {!form.scientificName.trim() && <p role="alert" className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Isi nama ilmiah pada formulir dan tinjau sumber taksonomi sebelum menyimpan draft.</p>}
      {form.scientificName.trim() && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-sm text-amber-100">{candidate?.scientificNameSuggestion ? <>Kandidat nama ilmiah AI: <em>{candidate.scientificNameSuggestion}</em>.</> : <>Nama ilmiah yang akan disimpan: <em>{form.scientificName}</em>.</>} Periksa referensi taksonomi sebelum menyimpannya.</p>
        <label className="mt-2 flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={scientificNameConfirmed} onChange={(event) => setScientificNameConfirmed(event.target.checked)} className="mt-0.5 accent-emerald-500" />Saya sudah memeriksa dan mengonfirmasi nama ilmiah pada formulir.</label>
      </div>}
      {candidate?.findings.map((item) => <p key={item.code} className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{item.code}: {item.explanation}</p>)}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase text-slate-400"><tr><th className="px-3 py-3">Parameter / key</th><th className="px-3 py-3">Rekomendasi</th><th className="px-3 py-3">Rentang</th><th className="px-3 py-3">Satuan</th><th className="px-3 py-3">Tahap</th><th className="px-3 py-3">Evidence</th><th className="px-3 py-3">Aksi</th></tr></thead>
          <tbody>{parameters.map((parameter, index) => <tr key={parameter.parameterKey} className="border-t border-slate-800">
            <td className="space-y-1 px-3 py-3"><input disabled={saveDraft.isPending || immutableSetup} aria-label={`Nama ${parameter.parameterKey}`} value={parameter.label} onChange={(event) => { setParameters((current) => current.map((item, row) => row === index ? { ...item, label: event.target.value, manuallyEdited: true } : item)); setDraftSaved(false); }} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white disabled:opacity-60" /><span className="block font-mono text-[11px] text-slate-500">{parameter.parameterKey}{parameter.manuallyEdited ? ' · diubah manual' : ''}</span></td>
            <td className="px-3 py-3 text-xs text-slate-500">Belum didukung evidence</td>
            <td className="px-3 py-3 text-xs text-slate-500">Tidak tersedia</td>
            <td className="px-3 py-3"><input disabled={saveDraft.isPending || immutableSetup} aria-label={`Unit ${parameter.parameterKey}`} value={parameter.unit} onChange={(event) => { setParameters((current) => current.map((item, row) => row === index ? { ...item, unit: event.target.value, manuallyEdited: true } : item)); setDraftSaved(false); }} placeholder="Belum ditetapkan" className="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white disabled:opacity-60" /></td>
            <td className="px-3 py-3 text-xs text-slate-300">{stages.map((item) => item.label).join(', ') || '—'}</td>
            <td className="px-3 py-3"><span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-200">Belum diperiksa</span></td>
            <td className="px-3 py-3"><button type="button" disabled={saveDraft.isPending || immutableSetup} aria-label={`Hapus ${parameter.parameterKey}`} onClick={() => { setParameters((current) => current.filter((_, row) => row !== index)); setSelectedParameterKeys((current) => current.filter((key) => key !== parameter.parameterKey)); setDraftSaved(false); }} className="rounded p-2 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
        <h3 className="font-medium text-amber-100">Belum ada dukungan agronomi terverifikasi</h3>
        <p className="mt-1 text-xs text-slate-300">Nilai rekomendasi dan rentang belum dapat diedit karena generator setup hanya mengusulkan identitas parameter. Status evidence dan dukungan sensor belum diperiksa oleh halaman setup. Mengisi satuan tidak menghasilkan rekomendasi dan tidak mengubah status evidence. Setelah sumber diverifikasi, engine rekomendasi pada Plant Profile tervalidasi dapat menghasilkan kandidat berbasis evidence.</p>
        <Link href="/plant-ai-recommendations" className="mt-2 inline-block text-xs text-amber-200 underline">Buka evidence dan rekomendasi</Link>
      </div>
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
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-sky-100">
        <h3 className="font-medium">Evidence dan rekomendasi</h3>
        <p className="mt-1 text-xs text-slate-300">Pencarian sumber tidak dijalankan oleh permintaan setup ini. Source Registry yang tersedia memiliki otorisasi platform tersendiri. Masukkan sumber yang sudah Anda periksa pada halaman Evidence; URL, kandidat Gemini, dan perubahan manual bukan evidence VERIFIED.</p>
        <Link href="/plant-ai-recommendations" className="mt-2 inline-block text-xs text-sky-300 underline">Buka pengelolaan evidence dan rekomendasi</Link>
      </div>
      {draftError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{draftError}</p>}
      {draftSaved && setupDraft && <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-100">
        <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" />{resumedDraft ? 'Draft dipulihkan dari penyimpanan.' : 'Draft tersimpan — belum divalidasi atau diterbitkan.'}</p>
        <p className="mt-1 text-xs text-slate-300">Katalog {setupDraft.catalogCode}, versi {setupDraft.version} · {setupDraft.status}. Publish memakai validator backend; profile hasilnya tetap DRAFT dan perlu divalidasi terpisah.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!scientificNameConfirmed || !canManage || approveStandard.isPending || saveDraft.isPending || !draftSaved} onClick={() => {
            if (!window.confirm(`Setujui dan terbitkan Plant Standard ${setupDraft.catalogCode} v${setupDraft.version}? Versi yang terbit tidak dapat diedit. Ini menerbitkan identitas parameter/stage tanpa nilai agronomi atau bukti baru.`)) return;
            setApprovalError('');
            setApprovalNotice('');
            approveStandard.mutate();
          }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{approveStandard.isPending ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Memvalidasi dan menerbitkan…</> : 'Setujui & terbitkan standar'}</button>
          <Link href={`/plant-catalog/${setupDraft.catalogId}`} className="text-xs text-emerald-300 underline">Tinjau detail teknis</Link>
          <Link href="/plant-profiles" className="text-xs text-emerald-300 underline">Buka Plant Profiles</Link>
        </div>
      </div>}
      {approvalError && <p role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-200">{approvalError} Jika standar sudah terbit, lanjutkan dengan tombol yang sama untuk melanjutkan penyiapan profile.</p>}
      {approvalNotice && <div role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">{approvalNotice}{approvedProfileId && <> <Link href={`/plant-profiles/${encodeURIComponent(approvedProfileId)}`} className="underline">Buka profile</Link></>}</div>}
      {immutableSetup && <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100">Versi ini sudah PUBLISHED dan immutable. Perubahan standar memerlukan versi katalog baru melalui workflow admin.</p>}
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
            ? <p role="alert" className="text-sm text-amber-200">Firmware belum melaporkan dukungan konfigurasi monitoring terpisah. Perbarui firmware, lalu tunggu heartbeat baru. Tidak ada konfigurasi yang dikirim.</p>
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
                      disabled={!supported || applyDeviceConfiguration.isPending}
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
                    {!supported && <span className="text-xs">— belum didukung firmware/sensor perangkat ini</span>}
                  </label>;
                })}
                {selectedSupportedParameters.length === 0 && <p className="text-xs text-amber-200">Tidak ada parameter katalog yang didukung oleh kanal sensor yang terdaftar dan dilaporkan firmware.</p>}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-slate-500">Simpan hanya definisi parameter dan stage sebagai draft. Nilai, rentang, unit yang tidak diketahui, kutipan, evidence, status verifikasi, publikasi, dan kontrol aktuator tidak dibuat otomatis.</p>
        <button type="button" disabled={saveDraft.isPending || !canManage || immutableSetup || !scientificNameConfirmed || parameters.length === 0 || stages.length === 0} onClick={() => { setDraftError(''); setDraftSaved(false); saveDraft.mutate(); }} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saveDraft.isPending ? <><LoaderCircle className="h-4 w-4 animate-spin" />Menyimpan draft…</> : 'Simpan draft setup'}</button>
      </div>
      {saveDraft.isError && !draftError && <p role="alert" className="text-sm text-rose-300">{errorMessage(saveDraft.error)}</p>}
    </section>}
    {!hasReview && <section className="grid gap-4 md:grid-cols-3">
      {[['Identifikasi', 'Nama tanaman dan metode budidaya menjadi konteks prompt AI.'], ['Sumber & evidence', 'Sumber ilmiah harus ditinjau dan dimasukkan melalui workflow evidence terpisah.'], ['Draft aman', 'Output disimpan sebagai konfigurasi DRAFT; tidak ada standard publish otomatis.']].map(([title, detail], index) => <article key={title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><p className="text-xs font-semibold uppercase text-emerald-300">Langkah {index + 1}</p><h2 className="mt-2 text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-slate-400">{detail}</p></article>)}
    </section>}
  </main></DashboardLayout>;
}
