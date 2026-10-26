import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlantProfileVersionDiff } from './plant-profile-version-diff';
import type { PlantProfileVersion } from '@/types';

function version(id: string, number: number, data: Record<string, unknown> = {}): PlantProfileVersion {
  return {
    id,
    plantProfileId: 'profile-1',
    organizationId: 'org-1',
    plantCatalogId: 'catalog-1',
    version: number,
    sourceCatalogVersionId: 'catalog-version-1',
    adoptedFromVersionId: null,
    status: 'DRAFT',
    configSchemaVersion: '1',
    profileConfig: {},
    checksumAlgorithm: 'sha256',
    checksum: null,
    createdByUserId: 'user-1',
    validatedByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    validatedAt: null,
    ...data,
  } as PlantProfileVersion;
}

describe('PlantProfileVersionDiff', () => {
  it('offers only available versions and updates the selected comparison', () => {
    render(<PlantProfileVersionDiff versions={[
      version('v3', 3, { profileConfig: { temperature: 24 }, growthStages: [] }),
      version('v2', 2, { profileConfig: { temperature: 22 }, growthStages: [] }),
      version('v1', 1, { profileConfig: { temperature: 20 }, growthStages: [] }),
    ]} />);

    const before = screen.getByRole('combobox', { name: 'Versi sebelum' });
    const after = screen.getByRole('combobox', { name: 'Versi sesudah' });
    expect(within(before).getAllByRole('option')).toHaveLength(3);
    expect((within(before).getByRole('option', { name: 'v3 · DRAFT' }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.queryByText('profileConfig.temperature')).not.toBeNull();
    fireEvent.change(before, { target: { value: 'v1' } });
    expect((before as HTMLSelectElement).value).toBe('v1');
    expect((after as HTMLSelectElement).value).toBe('v3');
    fireEvent.change(before, { target: { value: 'v3' } });
    expect((before as HTMLSelectElement).value).toBe('v1');
  });

  it('shows recursive profile configuration changes with before and after values', () => {
    render(<PlantProfileVersionDiff versions={[
      version('new', 2, { profileConfig: { environment: { temperature: { max: 28 }, humidity: 60 } }, growthStages: [] }),
      version('old', 1, { profileConfig: { environment: { temperature: { max: 25 }, humidity: 60, light: 'full' } }, growthStages: [] }),
    ]} />);

    const changed = screen.getByText('profileConfig.environment.temperature.max').closest('article');
    expect(changed?.textContent).toContain('Berubah');
    expect(changed?.textContent).toContain('25');
    expect(changed?.textContent).toContain('28');
    const removed = screen.getByText('profileConfig.environment.light').closest('article');
    expect(removed?.textContent).toContain('Dihapus');
    expect(removed?.textContent).toContain('full');
  });

  it('diffs growth stages by code, including transition criteria and parameter config', () => {
    const prior = {
      code: 'flowering', label: 'Flowering', sequence: 2, minDurationDays: 3, maxDurationDays: 10,
      transitionCriteria: { fruitSet: false }, parameterConfig: { config: { temperature: { min: 20 } } },
    };
    const current = {
      ...prior, label: 'Fruit set', transitionCriteria: { fruitSet: true },
      parameterConfig: { config: { temperature: { min: 21 } } },
    };
    render(<PlantProfileVersionDiff versions={[
      version('new', 2, { profileConfig: {}, growthStages: [current, { ...current, code: 'fruiting' }] }),
      version('old', 1, { profileConfig: {}, growthStages: [prior, { ...prior, code: 'seedling' }] }),
    ]} />);

    expect(screen.queryByText('growthStages[code="flowering"].label')).not.toBeNull();
    expect(screen.queryByText('growthStages[code="flowering"].transitionCriteria.fruitSet')).not.toBeNull();
    expect(screen.queryByText('growthStages[code="flowering"].parameterConfig.config.temperature.min')).not.toBeNull();
    const addedStage = screen.getByText('growthStages[code="fruiting"]').closest('article');
    const removedStage = screen.getByText('growthStages[code="seedling"]').closest('article');
    expect(addedStage?.textContent).toContain('Ditambahkan');
    expect(removedStage?.textContent).toContain('Dihapus');
  });

  it('marks missing or duplicate stage codes invalid without matching by array index', () => {
    render(<PlantProfileVersionDiff versions={[
      version('new', 2, { profileConfig: {}, growthStages: [{ code: 'bud' }, { code: 'bud' }] }),
      version('old', 1, { profileConfig: {}, growthStages: [{ label: 'No code' }] }),
    ]} />);

    expect(screen.getAllByText('Data tidak lengkap/valid').length).toBeGreaterThan(0);
    expect(screen.queryByText('growthStages[0].code')).not.toBeNull();
    expect(screen.queryByText('growthStages[code="bud"]')).not.toBeNull();
  });

  it('shows empty, loading, and error states', () => {
    const oneVersion = [version('only', 1, { profileConfig: {}, growthStages: [] })];
    const { rerender } = render(<PlantProfileVersionDiff versions={oneVersion} />);
    expect(screen.queryByText('Perlu minimal dua versi profil untuk dibandingkan.')).not.toBeNull();

    rerender(<PlantProfileVersionDiff versions={[]} isLoading />);
    expect(screen.getByRole('status').textContent).toContain('Memuat versi profil');

    rerender(<PlantProfileVersionDiff versions={[]} error="Gagal memuat data" />);
    expect(screen.getByRole('alert').textContent).toContain('Gagal memuat data');
  });

  it('reports incomplete version data and no-change empty state', () => {
    const { rerender } = render(<PlantProfileVersionDiff versions={[
      version('new', 2, { profileConfig: {}, growthStages: [] }),
      version('old', 1, { profileConfig: {}, growthStages: [] }),
    ]} />);
    expect(screen.queryByText(/Tidak ada perubahan atau data konfigurasi belum tersedia/)).not.toBeNull();

    rerender(<PlantProfileVersionDiff versions={[
      version('new', 2, { profileConfig: null, growthStages: undefined }),
      version('old', 1, { profileConfig: {}, growthStages: [] }),
    ]} />);
    expect(screen.getAllByText('Data tidak lengkap/valid').length).toBeGreaterThan(0);
  });
});
