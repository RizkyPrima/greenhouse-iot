import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlantSetupPage from './page';

const mocks = vi.hoisted(() => ({
  generatePlantSetup: vi.fn(),
  searchResearchSources: vi.fn(),
  getPlantCatalog: vi.fn(),
  getPlantCatalogItem: vi.fn(),
  getPlantCatalogParameterValidations: vi.fn(),
  validatePlantCatalogParameter: vi.fn(),
  createPlantCatalog: vi.fn(),
  createPlantCatalogVersion: vi.fn(),
  deletePlantCatalogVersion: vi.fn(),
  createPlantParameterDefinition: vi.fn(),
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
    searchResearchSources: mocks.searchResearchSources,
    getPlantCatalog: mocks.getPlantCatalog,
    getPlantCatalogItem: mocks.getPlantCatalogItem,
    getPlantCatalogParameterValidations: mocks.getPlantCatalogParameterValidations,
    validatePlantCatalogParameter: mocks.validatePlantCatalogParameter,
    createPlantCatalog: mocks.createPlantCatalog,
    createPlantCatalogVersion: mocks.createPlantCatalogVersion,
    deletePlantCatalogVersion: mocks.deletePlantCatalogVersion,
    createPlantParameterDefinition: mocks.createPlantParameterDefinition,
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
    {
      parameterKey: 'nutrient_solution_ph',
      label: 'pH larutan nutrisi',
      dataType: 'number' as const,
      unit: 'pH',
      recommendedValue: 5.8,
      minimumValue: 5.5,
      maximumValue: 6.2,
      note: 'Kandidat AI, belum diverifikasi.',
      evidenceStatus: 'NOT_ASSESSED' as const,
    },
  ],
  growthStages: [{ code: 'seedling', label: 'Bibit', sequence: 1 }],
  provider: { name: 'Google Gemini API', model: 'configured-text-model' },
  findings: [{ code: 'HUMAN_REVIEW_REQUIRED', explanation: 'Kandidat saja.' }],
  sourceCandidates: [{
    provider: 'crossref' as const,
    title: 'Research metadata example',
    authors: ['Author'],
    doi: '10.1234/example',
    publicationYear: 2024,
    sourceUrl: 'https://doi.org/10.1234/example',
  }],
  sourceSearchStatus: 'COMPLETED' as const,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><PlantSetupPage /></QueryClientProvider>);
}

describe('AI Plant Setup page', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    mocks.getPlantCatalog.mockResolvedValue([]);
    mocks.getPlantConfigurationDevices.mockResolvedValue([]);
    mocks.getPlantCatalogParameterValidations.mockResolvedValue([]);
    mocks.validatePlantCatalogParameter.mockImplementation(async (_organizationId: string, _versionId: string, parameterId: string) => ({
      parameterId,
      parameterKey: 'air_temperature',
      validated: true,
      validatedByUserId: 'owner-1',
      validatedAt: new Date().toISOString(),
    }));
    mocks.searchResearchSources.mockResolvedValue({
      job: { status: 'SUCCEEDED' },
      sources: [{
        title: 'Research metadata example',
        authors: ['Author'],
        metadataProvider: 'crossref',
        doiNormalized: '10.1234/example',
        publicationYear: 2024,
        journal: null,
        sourceUrl: 'https://doi.org/10.1234/example',
      }],
      errors: [],
    });
  });

  it('keeps provisional AI values and source metadata available when regenerate fails', async () => {
    mocks.generatePlantSetup
      .mockResolvedValueOnce(generatedCandidates)
      .mockRejectedValueOnce(new Error('Gemini is temporarily unavailable'));
    renderPage();

    expect(screen.getByRole('heading', { name: '1. Identifikasi tanaman' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.change(screen.getByLabelText('Nama ilmiah (opsional)'), { target: { value: 'Solanum lycopersicum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));

    expect(await screen.findByText(/Rekomendasi otomatis/)).toBeTruthy();
    expect(screen.getByText('Belum diperiksa')).toBeTruthy();
    expect(screen.getByDisplayValue('5.8')).toBeTruthy();
    expect(screen.getByText('Kandidat AI, belum diverifikasi.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Research metadata example' }).getAttribute('href')).toBe('https://doi.org/10.1234/example');
    expect(screen.getByText(/tidak membuktikan bahwa isi sumber mendukung/i)).toBeTruthy();
    expect(mocks.searchResearchSources).toHaveBeenCalledWith(expect.objectContaining({
      providers: ['crossref', 'openalex'],
      limit: 5,
    }));
    fireEvent.change(screen.getByLabelText('Rekomendasi nutrient_solution_ph'), { target: { value: '6.1' } });
    expect(screen.getByDisplayValue('6.1')).toBeTruthy();
    expect(screen.getByText(/perubahan manusia perlu ditinjau/)).toBeTruthy();
    expect(screen.getByText('Belum diperiksa')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Layanan penyusunan rekomendasi sedang mengalami kendala.');
    expect(alert.textContent).not.toMatch(/Gemini|token|API key|model/i);
    expect(screen.getByText(/Rekomendasi otomatis/)).toBeTruthy();
    expect(mocks.generatePlantSetup).toHaveBeenCalledTimes(2);
  });

  it('shows a general timeout message without internal provider details', async () => {
    mocks.generatePlantSetup.mockRejectedValueOnce(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Proses penyusunan memerlukan waktu terlalu lama');
    expect(alert.textContent).not.toMatch(/Gemini|token|API key|model/i);
  });

  it('explains usage limits without exposing provider or credential details', async () => {
    mocks.generatePlantSetup.mockRejectedValueOnce(Object.assign(new Error('Internal quota error'), { code: 'LLM_QUOTA_EXCEEDED' }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('sedang mencapai batas penggunaan');
    expect(alert.textContent).not.toMatch(/Gemini|token|API key|model|kuota/i);
  });

  it('keeps AI candidates visible when source search is forbidden by research permissions', async () => {
    mocks.generatePlantSetup.mockResolvedValueOnce(generatedCandidates);
    mocks.searchResearchSources.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));

    expect(await screen.findByText(/Informasi referensi belum dapat dimuat/)).toBeTruthy();
    expect(screen.getByDisplayValue('5.8')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Research metadata example' })).toBeNull();
  });

  it('lets an owner save generated candidates as a draft without requiring publication confirmation', async () => {
    const catalog = {
      id: 'catalog-1',
      organizationId: 'org-1',
      code: 'tomat-unknown',
      scientificName: 'Solanum lycopersicum',
      commonName: 'Tomat',
      cultivar: null,
      status: 'ACTIVE',
      createdAt: '',
      updatedAt: '',
      versions: [],
    };
    const version = {
      id: 'catalog-version-1',
      plantCatalogId: 'catalog-1',
      version: 1,
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
      parameterDefinitions: [],
    };
    mocks.createPlantCatalog.mockResolvedValue(catalog);
    mocks.getPlantCatalogItem
      .mockResolvedValueOnce(catalog)
      .mockResolvedValue({ ...catalog, versions: [version] });
    mocks.createPlantCatalogVersion.mockResolvedValue(version);
    mocks.createPlantParameterDefinition.mockResolvedValue({});
    mocks.generatePlantSetup.mockResolvedValueOnce(generatedCandidates);
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));
    await screen.findByText(/Rekomendasi otomatis/);

    const saveButton = screen.getByRole('button', { name: 'Simpan draft setup' });
    expect(saveButton).toBeTruthy();
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('checkbox', { name: /menyetujuinya untuk publikasi standar/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(saveButton);

    expect(await screen.findByText(/Draft tersimpan/)).toBeTruthy();
    expect(mocks.createPlantCatalog).toHaveBeenCalledOnce();
    expect(mocks.createPlantCatalogVersion).toHaveBeenCalledOnce();
    expect(mocks.createPlantParameterDefinition).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Setujui & terbitkan standar' }) as HTMLButtonElement).disabled).toBe(true);
  }, 20_000);

  it('deletes a saved draft after confirmation and clears the active setup', async () => {
    const catalog = {
      id: 'catalog-1',
      organizationId: 'org-1',
      code: 'tomat-unknown',
      scientificName: 'Solanum lycopersicum',
      commonName: 'Tomat',
      cultivar: null,
      status: 'ACTIVE',
      createdAt: '',
      updatedAt: '',
      versions: [],
    };
    const version = {
      id: 'catalog-version-1',
      plantCatalogId: 'catalog-1',
      version: 1,
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
      parameterDefinitions: [],
    };
    mocks.createPlantCatalog.mockResolvedValue(catalog);
    mocks.getPlantCatalogItem.mockResolvedValueOnce(catalog).mockResolvedValue({ ...catalog, versions: [version] });
    mocks.createPlantCatalogVersion.mockResolvedValue(version);
    mocks.createPlantParameterDefinition.mockResolvedValue({});
    mocks.generatePlantSetup.mockResolvedValueOnce(generatedCandidates);
    mocks.deletePlantCatalogVersion.mockResolvedValue({
      id: version.id, deleted: true, deletedProfileVersionCount: 0,
      deletedAssignmentCount: 0, deletedProposalCount: 0, deletedDeviceConfigurationCount: 0,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));
    await screen.findByText(/Rekomendasi otomatis/);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft setup' }));
    await screen.findByText(/Draft tersimpan/);

    fireEvent.click(screen.getByRole('button', { name: 'Hapus draft' }));
    await waitFor(() => expect(mocks.deletePlantCatalogVersion).toHaveBeenCalledWith('org-1', version.id));
    await waitFor(() => expect(screen.queryByText(/Draft tersimpan/)).toBeNull());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(' v1 '));
    expect(screen.queryByDisplayValue('5.8')).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate Parameter dengan AI' })).toBeTruthy();
    await waitFor(() => {
      const snapshot = JSON.parse(sessionStorage.getItem('plant-setup-review:org-1') ?? '{}') as { setupDraft?: unknown; candidate?: unknown };
      expect(snapshot.setupDraft).toBeNull();
      expect(snapshot.candidate).toBeNull();
    });
    expect(await screen.findByText(/Draft konfigurasi berhasil dihapus permanen/)).toBeTruthy();
  }, 20_000);

  it('lets an owner permanently delete a published standard with a warning about ESP state', async () => {
    const publishedVersion = {
      id: 'published-version-1', plantCatalogId: 'catalog-1', version: 3, status: 'PUBLISHED',
      configSchemaVersion: 'plant-config/v1', profileDefaults: {},
      stageTemplates: [{ code: 'seedling', label: 'Bibit', sequence: 1, config: {} }],
      edgeCompatibility: {}, checksumAlgorithm: 'SHA-256/JCS-RFC8785', checksum: 'a'.repeat(64),
      createdByUserId: 'owner-1', publishedByUserId: 'owner-1', createdAt: '', publishedAt: '',
      parameterDefinitions: [],
    };
    const catalog = {
      id: 'catalog-1', organizationId: 'org-1', code: 'tomat-hydroponic_tower',
      scientificName: 'Solanum lycopersicum', commonName: 'Tomat', cultivar: null,
      status: 'ACTIVE', createdAt: '', updatedAt: '', versions: [publishedVersion],
    };
    mocks.getPlantCatalog.mockResolvedValue([catalog]);
    mocks.deletePlantCatalogVersion.mockResolvedValue({
      id: publishedVersion.id, deleted: true, deletedProfileVersionCount: 1,
      deletedAssignmentCount: 1, deletedProposalCount: 1, deletedDeviceConfigurationCount: 1,
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Gunakan standar terbit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gunakan standar ini' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus standar terbit' }));

    await waitFor(() => expect(mocks.deletePlantCatalogVersion).toHaveBeenCalledWith('org-1', publishedVersion.id));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('dapat tetap memakainya'));
    expect(await screen.findByText(/Standar terbit berhasil dihapus permanen/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate Parameter dengan AI' })).toBeTruthy();
  });

  it('keeps the active draft visible when deleting it fails', async () => {
    const version = {
      id: 'catalog-version-1', plantCatalogId: 'catalog-1', version: 1, status: 'DRAFT',
      configSchemaVersion: 'plant-config/v1', profileDefaults: {},
      stageTemplates: [{ code: 'seedling', label: 'Bibit', sequence: 1, config: {} }],
      edgeCompatibility: {}, checksumAlgorithm: 'SHA-256/JCS-RFC8785', checksum: null,
      createdByUserId: 'owner-1', publishedByUserId: null, createdAt: '', publishedAt: null,
      parameterDefinitions: [],
    };
    const catalog = {
      id: 'catalog-1', organizationId: 'org-1', code: 'tomat-unknown',
      scientificName: 'Solanum lycopersicum', commonName: 'Tomat', cultivar: null,
      status: 'ACTIVE', createdAt: '', updatedAt: '', versions: [],
    };
    mocks.createPlantCatalog.mockResolvedValue(catalog);
    mocks.getPlantCatalogItem.mockResolvedValueOnce(catalog).mockResolvedValue({ ...catalog, versions: [version] });
    mocks.createPlantCatalogVersion.mockResolvedValue(version);
    mocks.createPlantParameterDefinition.mockResolvedValue({});
    mocks.generatePlantSetup.mockResolvedValueOnce(generatedCandidates);
    mocks.deletePlantCatalogVersion.mockRejectedValue(new Error('Related data could not be removed'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));
    await screen.findByText(/Rekomendasi otomatis/);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft setup' }));
    await screen.findByText(/Draft tersimpan/);
    fireEvent.click(screen.getByRole('button', { name: 'Hapus draft' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Related data could not be removed');
    expect(screen.getByDisplayValue('5.8')).toBeTruthy();
    expect(screen.getByText(/Draft tersimpan/)).toBeTruthy();
  }, 20_000);

  it('restores provisional values and references after reopening the page in the same tab', async () => {
    mocks.generatePlantSetup.mockResolvedValueOnce(generatedCandidates);
    const firstRender = renderPage();
    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));
    expect(await screen.findByRole('link', { name: 'Research metadata example' })).toBeTruthy();
    firstRender.unmount();

    renderPage();
    expect(await screen.findByDisplayValue('5.8')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Research metadata example' })).toBeTruthy();
    expect(screen.getByText('Kandidat AI, belum diverifikasi.')).toBeTruthy();
  });

  it('shows an accessible working indicator while recommendations are being generated', async () => {
    let finishGeneration!: (result: typeof generatedCandidates) => void;
    mocks.generatePlantSetup.mockReturnValueOnce(new Promise<typeof generatedCandidates>((resolve) => {
      finishGeneration = resolve;
    }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Nama tanaman *'), { target: { value: 'Tomat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Parameter dengan AI' }));

    expect(screen.getByRole('status', { name: 'Sedang menyusun rekomendasi' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Sedang menyiapkan rekomendasi tanaman')).toBeTruthy();
    expect(screen.getByText(/hingga sekitar satu menit/i)).toBeTruthy();

    finishGeneration(generatedCandidates);
    expect(await screen.findByText(/Rekomendasi otomatis/)).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Sedang menyusun rekomendasi' })).toBeNull();
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

    await screen.findByRole('option', { name: /Tomat · Solanum lycopersicum · v2/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Lanjutkan draft yang tersimpan' }), {
      target: { value: 'catalog-1:catalog-version-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan draft' }));

    await waitFor(() => expect(screen.getAllByText(/Draft parameter dipulihkan/).length).toBeGreaterThan(0));
    expect(screen.getByDisplayValue('pH larutan nutrisi')).toBeTruthy();
    expect(screen.getByDisplayValue('Bibit')).toBeTruthy();
    expect((screen.getByLabelText('Metode budidaya') as HTMLSelectElement).value).toBe('unknown');
    expect(screen.queryByText(/diubah manual/)).toBeNull();
    expect(screen.queryByText(/Google Gemini API/)).toBeNull();
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
    let parameterValidated = false;
    const parameterValidation = {
      parameterId: 'parameter-1',
      parameterKey: 'nutrient_solution_ph',
      validated: true,
      validatedByUserId: 'owner-1',
      validatedAt: new Date().toISOString(),
    };
    mocks.getPlantCatalogParameterValidations.mockImplementation(async () => [parameterValidated
      ? parameterValidation
      : { ...parameterValidation, validated: false, validatedByUserId: null, validatedAt: null }]);
    mocks.validatePlantCatalogParameter.mockImplementation(async () => {
      parameterValidated = true;
      return parameterValidation;
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    await screen.findByRole('option', { name: /Tomat · Solanum lycopersicum · v2/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'Lanjutkan draft yang tersimpan' }), {
      target: { value: 'catalog-1:catalog-version-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lanjutkan draft' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Saya sudah memeriksa nama ilmiah/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draft setup' }));
    await screen.findByText(/Draft tersimpan/);

    fireEvent.click(await screen.findByRole('button', { name: 'Validasi nutrient_solution_ph oleh saya' }));
    await waitFor(() => expect(mocks.validatePlantCatalogParameter).toHaveBeenCalledWith('org-1', 'catalog-version-2', 'parameter-1'));
    expect(await screen.findByText(/Divalidasi oleh user owner-1/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Setujui & terbitkan standar' }));
    await waitFor(() => expect(mocks.publishPlantCatalogVersion).toHaveBeenCalledWith('org-1', 'catalog-version-2'));
    await waitFor(() => expect(mocks.adoptPlantCatalogVersion).toHaveBeenCalledWith('org-1', 'profile-1', { catalogVersionId: 'catalog-version-2' }));
    expect(mocks.updatePlantParameterDefinition).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Standar diterbitkan\. Profile disiapkan/)).toBeTruthy();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('finds an existing published standard and sends it to the ESP without generating a new AI setup', async () => {
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
    let parameterValidated = false;
    const parameterValidation = {
      parameterId: 'parameter-1',
      parameterKey: 'air_temperature',
      validated: true,
      validatedByUserId: 'owner-1',
      validatedAt: new Date().toISOString(),
    };
    mocks.getPlantCatalogParameterValidations.mockImplementation(async () => [parameterValidated
      ? parameterValidation
      : { ...parameterValidation, validated: false, validatedByUserId: null, validatedAt: null }]);
    mocks.validatePlantCatalogParameter.mockImplementation(async () => {
      parameterValidated = true;
      return parameterValidation;
    });
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

    fireEvent.click(await screen.findByRole('button', { name: 'Gunakan standar terbit' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Cari nama tanaman, nama ilmiah, varietas, atau metode budidaya' }), {
      target: { value: 'hidroponik tower' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Gunakan standar ini' }));
    expect(await screen.findByText('Standar terbit siap digunakan.')).toBeTruthy();
    expect(mocks.generatePlantSetup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Perangkat dari organisasi ini' }), { target: { value: 'device-1' } });
    expect((screen.getByRole('button', { name: 'Terapkan konfigurasi monitoring ke ESP32' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Validasi air_temperature oleh saya' }));
    expect(await screen.findByText(/Divalidasi oleh user owner-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Saya menyetujui pengiriman konfigurasi monitoring/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan konfigurasi monitoring ke ESP32' }));

    await waitFor(() => expect(mocks.applyDevicePlantConfiguration).toHaveBeenCalledWith('org-1', 'device-1', expect.objectContaining({
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['air_temperature'],
    })));
    expect(await screen.findByText('Diterapkan dan dikonfirmasi ESP32')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Setujui & terbitkan standar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Simpan draft setup' })).toBeNull();
  });
});
