import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ResearchService } from './research.service.js';

const actor = { id: 'research-admin', isActive: true } as AuthenticatedUser;
const metadata = {
  provider: 'crossref' as const,
  doi: '10.5555/example',
  crossrefId: '10.5555/example',
  title: 'Greenhouse paper',
  authors: ['A Researcher'],
  publicationYear: 2025,
  abstractLicenseStatus: 'UNKNOWN' as const,
  accessStatus: 'UNKNOWN' as const,
  licenseStatus: 'UNKNOWN' as const,
  providerMetadata: { type: 'journal-article' },
};

describe('ResearchService', () => {
  let prisma: Record<string, any>;
  let crossref: { name: string; search: ReturnType<typeof vi.fn> };
  let openAlex: { name: string; search: ReturnType<typeof vi.fn> };
  let service: ResearchService;

  beforeEach(() => {
    prisma = {
      researchSource: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
      researchJob: { create: vi.fn().mockResolvedValue({ id: 'job-1' }), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
      researchJobSource: { upsert: vi.fn() },
      $transaction: vi.fn(async (arg: unknown) => typeof arg === 'function' ? (arg as (tx: unknown) => unknown)({ researchSource: prisma.researchSource, researchJobSource: prisma.researchJobSource, researchJob: prisma.researchJob }) : Promise.all(arg as Promise<unknown>[])),
    };
    crossref = { name: 'crossref', search: vi.fn().mockResolvedValue([metadata]) };
    openAlex = { name: 'openalex', search: vi.fn().mockRejectedValue(new Error('private provider error')) };
    service = new ResearchService(prisma as never, crossref as never, openAlex as never);
  });

  it('requires a DOI or alternate identifier and rejects invalid DOI input', async () => {
    await expect(service.register({ title: 'Paper' }, actor)).rejects.toThrow('Provide a DOI or an alternate provider identifier');
    await expect(service.register({ title: 'Paper', doi: 'bad-doi' }, actor)).rejects.toThrow('DOI format is invalid');
    await expect(service.register({ title: 'Paper', doi: '10.1234/paper', abstract: 'Copyrighted text' }, actor)).rejects.toThrow('Abstract storage requires an explicitly open abstract license');
  });

  it('reuses an existing DOI and records the manual registration as a job', async () => {
    const existing = { id: 'source-1', doiNormalized: '10.5555/example' };
    prisma.researchSource.findFirst.mockResolvedValue(existing);
    const result = await service.register({ title: 'Duplicate title', doi: 'https://doi.org/10.5555/EXAMPLE' }, actor);
    expect(result).toMatchObject({ source: existing, deduplicated: true, job: { id: 'job-1' } });
    expect(prisma.researchSource.create).not.toHaveBeenCalled();
    expect(prisma.researchJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'MANUAL_REGISTRATION', resultCount: 1 }) }));
  });

  it('accepts a DOI resolver URL as an identifier without fetching the submitted URL', async () => {
    prisma.researchSource.create.mockResolvedValue({ id: 'source-3' });
    prisma.researchJob.create.mockResolvedValue({ id: 'job-2' });
    const result = await service.register({ title: 'Resolver import', sourceUrl: 'https://doi.org/10.5555/ABC' }, actor);
    expect(result).toMatchObject({ source: { id: 'source-3' }, job: { id: 'job-2' }, deduplicated: false });
    expect(prisma.researchSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ doiNormalized: '10.5555/abc', sourceUrl: 'https://doi.org/10.5555/ABC' }) }));
  });

  it('persists search job outcome, source provenance, and safe provider errors', async () => {
    const savedSource = { id: 'source-2', metadataProvider: 'crossref' };
    prisma.researchSource.create.mockResolvedValue(savedSource);
    prisma.researchJob.update.mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'job-1', ...data as object }));
    const result = await service.search({ query: 'greenhouse irrigation', limit: 5 }, actor);
    expect(result).toMatchObject({
      job: { id: 'job-1', status: 'PARTIAL', safeErrorCode: null },
      sources: [savedSource],
      errors: [{ provider: 'openalex', code: 'PROVIDER_UNAVAILABLE' }],
    });
    expect(prisma.researchJobSource.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { jobId: 'job-1', sourceId: 'source-2', provider: 'crossref' },
    }));
    expect(result.errors.some((error) => JSON.stringify(error).includes('private provider error'))).toBe(false);
  });
});
