import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ResearchAccessStatus, ResearchJobStatus, ResearchJobType, ResearchLicenseStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RegisterResearchSourceDto, ResearchListQueryDto, SearchResearchSourcesDto } from './research.dto.js';
import type { MetadataRecord } from './research-source.util.js';
import { deduplicateMetadata, normalizeDoi } from './research-source.util.js';
import type { ResearchMetadataProvider } from './research-metadata.providers.js';
import { CrossrefMetadataProvider, OpenAlexMetadataProvider } from './research-metadata.providers.js';

@Injectable()
export class ResearchService {
  private readonly providers: ResearchMetadataProvider[];

  constructor(
    private readonly prisma: PrismaService,
    crossref: CrossrefMetadataProvider,
    openAlex: OpenAlexMetadataProvider,
  ) {
    this.providers = [crossref, openAlex];
  }

  async register(dto: RegisterResearchSourceDto, actor: AuthenticatedUser) {
    const doiInput = dto.doi ?? this.doiFromResolverUrl(dto.sourceUrl);
    const doiNormalized = doiInput ? this.safeNormalizeDoi(doiInput) : null;
    const alternateIdentifierType = dto.alternateIdentifierType?.trim().toLowerCase()
      ?? (dto.sourceUrl && !doiNormalized && !dto.crossrefId && !dto.openAlexId ? 'url' : undefined);
    const alternateIdentifier = dto.alternateIdentifier?.trim()
      ?? (alternateIdentifierType === 'url' && dto.sourceUrl ? this.normalizeSourceUrl(dto.sourceUrl) : undefined);
    if (!doiNormalized && !alternateIdentifier && !dto.crossrefId && !dto.openAlexId) {
      throw new BadRequestException('Provide a DOI or an alternate provider identifier');
    }
    if (dto.alternateIdentifier && !dto.alternateIdentifierType) {
      throw new BadRequestException('alternateIdentifierType is required with alternateIdentifier');
    }
    if (dto.abstract && dto.abstractLicenseStatus !== 'OPEN_LICENSE') {
      throw new BadRequestException('Abstract storage requires an explicitly open abstract license');
    }
    const identifiers = {
      doiNormalized,
      crossrefId: dto.crossrefId?.trim().toLowerCase(),
      openAlexId: dto.openAlexId?.trim().toLowerCase(),
      alternateIdentifierType,
      alternateIdentifier,
    };
    const existing = await this.findExisting(identifiers);
    const createSource = (tx: Prisma.TransactionClient) => tx.researchSource.create({ data: {
        doiNormalized,
        crossrefId: dto.crossrefId?.trim().toLowerCase(),
        openAlexId: dto.openAlexId?.trim().toLowerCase(),
        alternateIdentifierType,
        alternateIdentifier,
        title: dto.title.trim(),
        authors: (dto.authors ?? []) as Prisma.InputJsonValue,
        publicationYear: dto.publicationYear,
        journal: dto.journal?.trim(),
        publisher: dto.publisher?.trim(),
        abstract: dto.abstract,
        sourceUrl: dto.sourceUrl,
        accessStatus: (dto.accessStatus ?? 'UNKNOWN') as ResearchAccessStatus,
        licenseStatus: (dto.licenseStatus ?? 'UNKNOWN') as ResearchLicenseStatus,
        abstractLicenseStatus: (dto.abstractLicenseStatus ?? 'UNKNOWN') as ResearchLicenseStatus,
        licenseUrl: dto.licenseUrl,
        createdByUserId: actor.id,
      } });
    const createJob = (tx: Prisma.TransactionClient, sourceId: string, deduplicated: boolean) => tx.researchJob.create({ data: {
        type: ResearchJobType.MANUAL_REGISTRATION,
        status: ResearchJobStatus.SUCCEEDED,
        resultCount: 1,
        summary: { deduplicated },
        actorUserId: actor.id,
        finishedAt: new Date(),
        results: { create: { sourceId, provider: 'manual' } },
      } });
    if (existing) {
      return this.prisma.$transaction(async (tx) => ({
        source: existing,
        job: await createJob(tx, existing.id, true),
        deduplicated: true,
      }));
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await createSource(tx);
        const job = await createJob(tx, source.id, false);
        return { source, job, deduplicated: false };
      });
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.findExisting(identifiers);
      if (!raced) throw error;
      return this.prisma.$transaction(async (tx) => ({
        source: raced,
        job: await createJob(tx, raced.id, true),
        deduplicated: true,
      }));
    }
  }

  async search(dto: SearchResearchSourcesDto, actor: AuthenticatedUser) {
    const selected = this.providers.filter((provider) => !dto.providers?.length || dto.providers.includes(provider.name));
    const job = await this.prisma.researchJob.create({
      data: {
        type: ResearchJobType.METADATA_SEARCH,
        status: ResearchJobStatus.RUNNING,
        query: dto.query.trim(),
        summary: { providers: selected.map(({ name }) => name) },
        actorUserId: actor.id,
      },
    });
    const outcomes = await Promise.all(selected.map(async (provider) => {
      try {
        return { provider: provider.name, records: await provider.search(dto.query.trim(), dto.limit), error: false };
      } catch {
        return { provider: provider.name, records: [] as MetadataRecord[], error: true };
      }
    }));
    const failures = outcomes.filter((outcome) => outcome.error).map(({ provider }) => provider);
    const records = deduplicateMetadata(outcomes.flatMap(({ records: found }) => found));
    const sources: Array<Record<string, unknown>> = [];
    const errors: Array<{ provider: string; code: string }> = failures.map((provider) => ({ provider, code: 'PROVIDER_UNAVAILABLE' }));

    for (const record of records) {
      try {
        sources.push(await this.upsertMetadata(record, actor.id));
      } catch (error) {
        if (this.isUniqueConflict(error)) {
          const existing = await this.findExisting({
            doiNormalized: record.doi ? this.safeNormalizeDoi(record.doi) : null,
            crossrefId: record.crossrefId,
            openAlexId: record.openAlexId,
          });
          if (existing) {
            sources.push(existing);
            continue;
          }
        }
        errors.push({ provider: record.provider, code: 'SOURCE_PERSISTENCE_FAILED' });
      }
    }
    const status = failures.length === selected.length || errors.length > failures.length
      ? ResearchJobStatus.FAILED
      : failures.length || errors.length
        ? ResearchJobStatus.PARTIAL
        : ResearchJobStatus.SUCCEEDED;

    const completedJob = await this.prisma.$transaction(async (tx) => {
      for (const source of sources) {
        await tx.researchJobSource.upsert({
          where: { jobId_sourceId_provider: { jobId: job.id, sourceId: source.id as string, provider: source.metadataProvider as string ?? 'unknown' } },
          create: { jobId: job.id, sourceId: source.id as string, provider: source.metadataProvider as string ?? 'unknown' },
          update: {},
        });
      }
      return tx.researchJob.update({
        where: { id: job.id },
        data: {
          status,
          resultCount: sources.length,
          safeErrorCode: status === ResearchJobStatus.FAILED ? (failures.length ? 'PROVIDER_UNAVAILABLE' : 'SOURCE_PERSISTENCE_FAILED') : null,
          summary: { providers: selected.map(({ name }) => name), failedProviders: failures, errors },
          finishedAt: new Date(),
        },
      });
    });
    return { job: completedJob, sources, errors };
  }

  async listSources(query: ResearchListQueryDto) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.researchSource.findMany({ orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.take }),
      this.prisma.researchSource.count(),
    ]);
    return { data, total, skip: query.skip, take: query.take };
  }

  async getSource(id: string) {
    const source = await this.prisma.researchSource.findUnique({ where: { id }, include: { jobResults: { orderBy: { retrievedAt: 'desc' }, take: 20, include: { job: { select: { id: true, type: true, provider: true, status: true, startedAt: true } } } } } });
    if (!source) throw new NotFoundException('Research source not found');
    return source;
  }

  async listJobs(query: ResearchListQueryDto) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.researchJob.findMany({ orderBy: { startedAt: 'desc' }, skip: query.skip, take: query.take }),
      this.prisma.researchJob.count(),
    ]);
    return { data, total, skip: query.skip, take: query.take };
  }

  private async upsertMetadata(record: MetadataRecord, actorUserId: string) {
    const doiNormalized = record.doi ? this.safeNormalizeDoi(record.doi) : null;
    const identifiers = { doiNormalized, crossrefId: record.crossrefId, openAlexId: record.openAlexId };
    const existing = await this.findExisting(identifiers);
    if (existing) {
      return this.prisma.researchSource.update({
        where: { id: existing.id },
        data: {
          doiNormalized: existing.doiNormalized ?? doiNormalized,
          crossrefId: existing.crossrefId ?? record.crossrefId,
          openAlexId: existing.openAlexId ?? record.openAlexId,
          title: existing.title || record.title,
          authors: Array.isArray(existing.authors) && existing.authors.length ? undefined : record.authors as Prisma.InputJsonValue,
          publicationYear: existing.publicationYear ?? record.publicationYear,
          journal: existing.journal ?? record.journal,
          publisher: existing.publisher ?? record.publisher,
          abstract: existing.abstract ?? record.abstract,
          abstractLicenseStatus: existing.abstract ? undefined : record.abstractLicenseStatus as ResearchLicenseStatus,
          sourceUrl: existing.sourceUrl ?? record.sourceUrl,
          licenseUrl: existing.licenseUrl ?? record.licenseUrl,
          accessStatus: existing.accessStatus === 'UNKNOWN' ? record.accessStatus as ResearchAccessStatus : undefined,
          licenseStatus: existing.licenseStatus === 'UNKNOWN' ? record.licenseStatus as ResearchLicenseStatus : undefined,
          metadataProvider: record.provider,
          providerMetadata: record.providerMetadata as Prisma.InputJsonValue,
          metadataFetchedAt: new Date(),
        },
      });
    }
    return this.prisma.researchSource.create({
      data: {
        ...identifiers,
        title: record.title,
        authors: record.authors as Prisma.InputJsonValue,
        publicationYear: record.publicationYear,
        journal: record.journal,
        publisher: record.publisher,
        abstract: record.abstract,
        abstractLicenseStatus: record.abstractLicenseStatus as ResearchLicenseStatus,
        sourceUrl: record.sourceUrl,
        licenseUrl: record.licenseUrl,
        metadataProvider: record.provider,
        providerMetadata: record.providerMetadata as Prisma.InputJsonValue,
        metadataFetchedAt: new Date(),
        accessStatus: record.accessStatus as ResearchAccessStatus,
        licenseStatus: record.licenseStatus as ResearchLicenseStatus,
        createdByUserId: actorUserId,
      },
    });
  }

  private findExisting(where: {
    doiNormalized?: string | null;
    crossrefId?: string | null;
    openAlexId?: string | null;
    alternateIdentifierType?: string | null;
    alternateIdentifier?: string | null;
  }) {
    const OR: Prisma.ResearchSourceWhereInput[] = [];
    if (where.doiNormalized) OR.push({ doiNormalized: where.doiNormalized });
    if (where.crossrefId) OR.push({ crossrefId: where.crossrefId.toLowerCase() });
    if (where.openAlexId) OR.push({ openAlexId: where.openAlexId.toLowerCase() });
    if (where.alternateIdentifierType && where.alternateIdentifier) OR.push({
      alternateIdentifierType: where.alternateIdentifierType.trim().toLowerCase(),
      alternateIdentifier: where.alternateIdentifier.trim(),
    });
    if (!OR.length) return Promise.resolve(null);
    return this.prisma.researchSource.findFirst({ where: { OR } });
  }

  private safeNormalizeDoi(value: string) {
    try {
      return normalizeDoi(value);
    } catch {
      throw new BadRequestException('DOI format is invalid');
    }
  }

  private doiFromResolverUrl(value?: string) {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported URL protocol');
      if (/^(?:dx\.)?doi\.org$/i.test(url.hostname)) return url.pathname.replace(/^\//, '');
      return undefined;
    } catch {
      throw new BadRequestException('Source URL is invalid');
    }
  }

  private normalizeSourceUrl(value: string) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported URL protocol');
      return url.href;
    } catch {
      throw new BadRequestException('Source URL must use HTTP or HTTPS');
    }
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
