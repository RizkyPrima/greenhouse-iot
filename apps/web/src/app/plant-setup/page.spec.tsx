import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlantSetupPage from './page';

const mocks = vi.hoisted(() => ({
  generatePlantSetup: vi.fn(),
  getPlantCatalog: vi.fn(),
  getPlantCatalogItem: vi.fn(),
  updatePlantCatalogVersion: vi.fn(),
  updatePlantParameterDefinition: vi.fn(),
  publishPlantCatalogVersion: vi.fn(),
  getPlantProfiles: vi.fn(),
  adoptPlantCatalogVersion: vi.fn(),
  getPlantConfigurationDevices: vi.fn(),
  applyDevicePlantConfiguration: vi.fn(),
  getDevicePlantConfiguration: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    generatePlantSetup: mocks.generatePlantSetup,
    getPlantCatalog: mocks.getPlantCatalog,
    getPlantCatalogItem: mocks.getPlantCatalogItem,
    updatePlantCatalogVersion: mocks.updatePlantCatalogVersion,
    updatePlantParameterDefinition: mocks.updatePlantParameterDefinition,
    publishPlantCatalogVersion: mocks.publishPlantCatalogVersion,
    getPlantProfiles: mocks.getPlantProfiles,
    adoptPlantCatalogVersion: mocks.adoptPlantCatalogVersion,
    getPlantConfigurationDevices: mocks.getPlantConfigurationDevices,
    applyDevicePlantConfiguration: mocks.applyDevicePlantConfiguration,
    getDevicePlantConfiguration: mocks.getDevicePlantConfiguration,
  },
}));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ currentOrg: { id: 'org-1' }, currentMembership: { role: 'OWNER' } }),
}));
vi.mock('@/components/layout/dashboard-layout', () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
const generatedCandidates = {
  status: 'CANDIDATES_FOR_REVIEW' as const,
  scientificNameSuggestion: 'Solanum lycopersicum',
  parameters: [
    { parameterKey: 'nutrient_solution_ph', label: 'pH larutan nutrisi', dataType: 'number' as const, unit: null, evidenceStatus: 'NOT_ASSESSED' as const },
  ],
  growthStages: [{ code: 'seedling', label: 'Bibit', sequence: 1 }],
  provider: { name: 'Google Gemini API', model: 'configured-text-model' },
  findings: [{ code: 'HUMAN_REVIEW_REQUIRED', explanation: 'Kandidat saja.' }],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><PlantSetupPage /></QueryClientProvider>);
}

describe('AI Plant Setup page', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlantCatalog.mockResolvedValue([]);
    mocks.getPlantConfigurationDevices.mockResolvedValue([]);
  });

  it('keeps the previous review available when regenerate fails and does not invent agronomic values', async () => {
    mocks.generatePlantSetup
      .mockResolvedValueOnce(generatedCandidates)
      .mockRejectedValueOnce(new Error('Gemini is temporarily unavailable'));
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.change(screen.getByLabelText('Nama ilmiah (opsional)'), { target: { value: 'Solanum lycopersicum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));

    expect(await screen.findByText(/Google Gemini API/)).toBeTruthy();
    expect(screen.getByText('Belum diperiksa')).toBeTruthy();
    expect(screen.getByText('Tidak tersedia')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Gemini is temporarily unavailable');
    expect(screen.getByText(/Google Gemini API/)).toBeTruthy();
    expect(mocks.generatePlantSetup).toHaveBeenCalledTimes(2);
  });

  it('restores a saved catalog draft and growth stages for continued review', async () => {
    mocks.getPlantCatalog.mockResolvedValue([{
      id: 'catalog-1',
      organizationId: 'org-1',
      code: 'tmt-01',
      scientificName: 'Solanum lycopersicum',
      commonName: 'Tomat',
      cultivar: null,
      status: 'ACTIVE',
      createdAt: '',
      updatedAt: '',
      versions: [{
        id: 'catalog-version-2',
        plantCatalogId: 'catalog-1',
        version: 2,
        status: 'DRAFT',
        configSchemaVersion: 'plant-config/v1',
        profileDefaults: {},
        stageTemplates: [{ code: 'seedling', label: 'Bibit', sequence: 1, config: {} }],
        edgeCompatibility: {},
        checksumAlgorithm: 'SHA-256/JCS-RFC8785',
        checksum: null,
        createdByUserId: 'owner-1',
        publishedByUserId: null,
        createdAt: '',
        publishedAt: null,
        parameterDefinitions: [{
          id: 'parameter-1',
          plantCatalogVersionId: 'catalog-version-2',
          parameterKey: 'nutrient_solution_ph',
          label: 'pH larutan nutrisi',
          dataType: 'number',
          unit: null,
          valueSchema: { type: 'number' },
          metadataSchema: {},
          createdAt: '',
        }],
      }],
    }]);
    renderPage();

    await screen.findByRole('option', { name: /Tomat · Solanum lycopersicum · v2 · DRAFT/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Lanjutkan setup tersimpan' }), {
      target: { value: 'catalog-1:catalog-version-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buka draft tersimpan' }));

    await waitFor(() => expect(screen.getByText(/Draft dipulihkan dari katalog/)).toBeTruthy());
    expect(screen.getByDisplayValue('pH larutan nutrisi')).toBeTruthy();
    expect(screen.getByDisplayValue('Bibit')).toBeTruthy();
    expect((screen.getByLabelText('Metode budidaya') as HTMLSelectElement).value).toBe('unknown');
    expect(screen.queryByText(/diubah manual/)).toBeNull();
    expect(screen.queryByText(/Provider: Google Gemini API/)).toBeNull();
  });

  it('saves reviewed edits, publishes explicitly, and adopts the published version to the existing profile', async () => {
    const draftVersion = {
      id: 'catalog-version-2',
      plantCatalogId: 'catalog-1',
      version: 2,
      status: 'DRAFT',
      configSchemaVersion: 'plant-config/v1',
      profileDefaults: {},
      stageTemplates: [{ code: 'seedling', label: 'Bibit', sequence: 1, config: {} }],
      edgeCompatibility: {},
      checksumAlgorithm: 'SHA-256/JCS-RFC8785',
      checksum: null,
      createdByUserId: 'owner-1',
      publishedByUserId: null,
      createdAt: '',
      publishedAt: null,
      parameterDefinitions: [{
        id: 'parameter-1',
        plantCatalogVersionId: 'catalog-version-2',
        parameterKey: 'nutrient_solution_ph',
        label: 'pH larutan nutrisi',
        dataType: 'number',
        unit: null,
        valueSchema: { type: 'number' },
        metadataSchema: {},
        createdAt: '',
      }],
    };
    const catalog = {
      id: 'catalog-1',
      organizationId: 'org-1',
      code: 'tmt-01',
      scientificName: 'Solanum lycopersicum',
      commonName: 'Tomat',
      cultivar: null,
      status: 'ACTIVE',
      createdAt: '',
      updatedAt: '',
      versions: [draftVersion],
    };
    mocks.getPlantCatalog.mockResolvedValue([catalog]);
    mocks.getPlantCatalogItem.mockResolvedValue(catalog);
    mocks.updatePlantCatalogVersion.mockResolvedValue(draftVersion);
    mocks.updatePlantParameterDefinition.mockResolvedValue(draftVersion.parameterDefinitions[0]);
    mocks.publishPlantCatalogVersion.mockResolvedValue({ ...draftVersion, status: 'PUBLISHED' });
    mocks.getPlantProfiles.mockResolvedValue([{
      id: 'profile-1',
      organizationId: 'org-1',
      plantCatalogId: 'catalog-1',
      code: 'tomat-hydro-01',
      name: 'Tomat Hidroponik Tower',
      status: 'ACTIVE',
      createdByUserId: 'owner-1',
      createdAt: '',
      updatedAt: '',
      versions: [{
        id: 'profile-version-1',
        version: 1,
        status: 'VALIDATED',
        sourceCatalogVersionId: 'catalog-version-1',
      }],
    }]);
    mocks.adoptPlantCatalogVersion.mockResolvedValue({});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByRole('option', { name: /Tomat · Solanum lycopersicum · v2 · DRAFT/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Lanjutkan setup tersimpan' }), {
      target: { value: 'catalog-1:catalog-version-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buka draft tersimpan' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Saya sudah memeriksa dan mengonfirmasi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft setup' }));
    await screen.findByText(/Draft tersimpan/);

    fireEvent.click(screen.getByRole('button', { name: 'Setujui & terbitkan standar' }));
    await waitFor(() => expect(mocks.publishPlantCatalogVersion).toHaveBeenCalledWith('org-1', 'catalog-version-2'));
    await waitFor(() => expect(mocks.adoptPlantCatalogVersion).toHaveBeenCalledWith('org-1', 'profile-1', { catalogVersionId: 'catalog-version-2' }));
    expect(mocks.updatePlantParameterDefinition).toHaveBeenCalledOnce();
    expect((await screen.findByRole('link', { name: 'Buka profile' })).getAttribute('href')).toBe('/plant-profiles/profile-1');
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('sends an explicitly approved monitoring-only configuration and distinguishes ESP32 application ACK', async () => {
    const publishedVersion = {
      id: 'catalog-version-1',
      plantCatalogId: 'catalog-1',
      version: 1,
      status: 'PUBLISHED',
      configSchemaVersion: 'plant-config/v1',
      profileDefaults: {},
      stageTemplates: [{ code: 'seedling', label: 'Bibit', sequence: 1, config: {} }],
      edgeCompatibility: {},
      checksumAlgorithm: 'SHA-256/JCS-RFC8785',
      checksum: 'a'.repeat(64),
      createdByUserId: 'owner-1',
      publishedByUserId: 'owner-1',
      createdAt: '',
      publishedAt: '',
      parameterDefinitions: [{
        id: 'parameter-1',
        plantCatalogVersionId: 'catalog-version-1',
        parameterKey: 'air_temperature',
        label: 'Suhu udara',
        dataType: 'number',
        unit: null,
        valueSchema: { type: 'number' },
        metadataSchema: {},
        createdAt: '',
      }],
    };
    mocks.getPlantCatalog.mockResolvedValue([{
      id: 'catalog-1',
      organizationId: 'org-1',
      code: 'tomat-hydroponic_tower',
      scientificName: 'Solanum lycopersicum',
      commonName: 'Tomat',
      cultivar: null,
      status: 'ACTIVE',
      createdAt: '',
      updatedAt: '',
      versions: [publishedVersion],
    }]);
    mocks.getPlantConfigurationDevices.mockResolvedValue([{
      id: 'device-1',
      deviceId: 'esp-1',
      name: 'ESP32-S3',
      greenhouse: { code: 'GH-1', name: 'Greenhouse' },
      status: 'ONLINE',
      lastSeenAt: new Date().toISOString(),
      firmwareVersion: '1.1.0',
      sensors: [{ code: 'temperature', name: 'Temperature', unit: '°C' }],
      capability: {
        schema: 'plant-monitoring/v1',
        sensorCodes: ['temperature'],
        supportedParameterKeys: ['air_temperature'],
        sensorDataMode: 'SIMULATED',
        reportedAt: new Date().toISOString(),
      },
      lastConfiguration: null,
    }]);
    mocks.applyDevicePlantConfiguration.mockResolvedValue({
      id: 'delivery-1',
      configurationId: 'c5748e28-4c7a-48ef-a742-24bdf37d48e3',
      organizationId: 'org-1',
      deviceId: 'device-1',
      deviceMqttId: 'esp-1',
      catalogVersionId: 'catalog-version-1',
      version: 1,
      status: 'SENT',
      payload: { mode: 'monitoring_only' },
      error: null,
      createdAt: '',
      sentAt: '',
      receivedAt: null,
      appliedAt: null,
      completedAt: null,
    });
    mocks.getDevicePlantConfiguration.mockResolvedValue({
      id: 'delivery-1',
      configurationId: 'c5748e28-4c7a-48ef-a742-24bdf37d48e3',
      organizationId: 'org-1',
      deviceId: 'device-1',
      deviceMqttId: 'esp-1',
      catalogVersionId: 'catalog-version-1',
      version: 1,
      status: 'APPLIED',
      payload: { mode: 'monitoring_only' },
      error: null,
      createdAt: '',
      sentAt: '',
      receivedAt: '',
      appliedAt: '',
      completedAt: '',
    });
    renderPage();

    await screen.findByRole('option', { name: /Tomat · Solanum lycopersicum · v1 · PUBLISHED/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Lanjutkan setup tersimpan' }), {
      target: { value: 'catalog-1:catalog-version-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buka draft tersimpan' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Perangkat dari organisasi ini' }), { target: { value: 'device-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Saya menyetujui pengiriman konfigurasi monitoring/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan konfigurasi monitoring ke ESP32' }));

    await waitFor(() => expect(mocks.applyDevicePlantConfiguration).toHaveBeenCalledWith('org-1', 'device-1', expect.objectContaining({
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['air_temperature'],
    })));
    expect(await screen.findByText('Diterapkan dan dikonfirmasi ESP32')).toBeTruthy();
  });
});
