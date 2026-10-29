import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlatformPermission,
  PlantProfileVersionStatus,
  PlantVersionStatus,
  ZoneActivationOperation,
  UserRole,
  ZonePlantAssignmentStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildParameterObjectSchema,
  assertSchema2020,
  configChecksum,
  mergePlantConfig,
  PLANT_CONFIG_SCHEMA_VERSION,
  plantParameterDefinitionChecksum,
  validateCatalogConfiguration,
  validatePlantLayer,
} from './plant-config.js';
import type {
  AdoptPlantCatalogVersionDto,
  ActivatePlantProfileDto,
  CreateCatalogVersionDto,
  CreateDraftGrowthStageDto,
  CreateGrowthStageDto,
  CreateParameterDefinitionDto,
  CreatePlantCatalogDto,
  CreatePlantProfileDto,
  CreateZoneOverrideDto,
  UpdateParameterDefinitionDto,
  UpdateCatalogVersionDto,
  UpdateProfileDraftDto,
  UpdateGrowthStageDto,
} from './dto/plant.dto.js';

const EMPTY_CONFIG: Record<string, unknown> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function catalogVersionUsesParameter(version: { profileDefaults: unknown; stageTemplates: unknown }, key: string): boolean {
  if (isRecord(version.profileDefaults) && Object.hasOwn(version.profileDefaults, key)) return true;
  if (!Array.isArray(version.stageTemplates)) return false;
  return version.stageTemplates.some((template) => isRecord(template)
    && isRecord(template.config)
    && Object.hasOwn(template.config, key));
}

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required' });
  }
  const key = value.trim();
  if (key.length > 200) {
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_TOO_LONG', message: 'Idempotency-Key must not exceed 200 characters' });
  }
  return key;
}

function isRetryableTransactionConflict(error: unknown): boolean {
  const value = error as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
  return value?.code === 'P2034'
    || value?.meta?.code === '40P01'
    || value?.meta?.code === '40001'
    || (value?.cause !== undefined && isRetryableTransactionConflict(value.cause));
}

function isIdempotencyUniqueConflict(error: unknown): boolean {
  const value = error as { code?: unknown; meta?: { target?: unknown } };
  if (value?.code !== 'P2002') return false;
  const target = value.meta?.target;
  const description = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return description.includes('organizationId') && description.includes('operation') && description.includes('idempotencyKey');
}

function growthStageUniqueConflict(error: unknown): 'code' | 'sequence' | null {
  const value = error as { code?: unknown; meta?: { target?: unknown } };
  if (value?.code !== 'P2002') return null;
  const target = value.meta?.target;
  const description = (Array.isArray(target) ? target.join(',') : String(target ?? '')).toLocaleLowerCase();
  if (description.includes('code')) return 'code';
  if (description.includes('sequence')) return 'sequence';
  return null;
}

function chunk<T>(values: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

@Injectable()
export class PlantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async listCatalogForOrganization(organizationId: string, actor: AuthenticatedUser) {
    const membership = await this.requireOrganization(actor.id, organizationId, false);
    const canManage = membership.role === UserRole.OWNER || membership.role === UserRole.ADMIN;
    return this.prisma.plantCatalog.findMany({
      where: { organizationId, ...(canManage ? {} : { status: 'ACTIVE', versions: { some: { status: PlantVersionStatus.PUBLISHED } } }) },
      include: {
        versions: {
          ...(canManage ? {} : { where: { status: PlantVersionStatus.PUBLISHED } }),
          orderBy: { version: 'desc' }, include: { parameterDefinitions: true },
        },
      },
      orderBy: { commonName: 'asc' },
    });
  }

  async getCatalogForOrganization(organizationId: string, catalogId: string, actor: AuthenticatedUser) {
    const membership = await this.requireOrganization(actor.id, organizationId, false);
    const canManage = membership.role === UserRole.OWNER || membership.role === UserRole.ADMIN;
    const catalog = await this.prisma.plantCatalog.findFirst({
      where: { id: catalogId, organizationId, ...(canManage ? {} : { status: 'ACTIVE', versions: { some: { status: PlantVersionStatus.PUBLISHED } } }) },
      include: { versions: { ...(canManage ? {} : { where: { status: PlantVersionStatus.PUBLISHED } }), orderBy: { version: 'desc' }, include: { parameterDefinitions: true } } },
    });
    if (!catalog) throw new NotFoundException('Plant catalog not found');
    return catalog;
  }

  async createCatalog(organizationId: string, dto: CreatePlantCatalogDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.$transaction(async (tx) => {
      const catalog = await tx.plantCatalog.create({
        data: {
          organizationId,
          code: dto.code.trim().toLowerCase(),
          scientificName: dto.scientificName.trim(),
          commonName: dto.commonName.trim(),
          cultivar: dto.cultivar?.trim() || null,
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'CATALOG_CREATED', entityType: 'PlantCatalog', entityId: catalog.id },
      });
      return catalog;
    });
  }

  async createCatalogVersion(organizationId: string, catalogId: string, dto: CreateCatalogVersionDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const catalog = await this.prisma.plantCatalog.findFirst({ where: { id: catalogId, organizationId } });
    if (!catalog) throw new NotFoundException('Plant catalog not found');
    const previous = await this.prisma.plantCatalogVersion.aggregate({
      where: { plantCatalogId: catalogId },
      _max: { version: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.plantCatalogVersion.create({
        data: {
          plantCatalogId: catalogId,
          version: (previous._max.version ?? 0) + 1,
          configSchemaVersion: PLANT_CONFIG_SCHEMA_VERSION,
          profileDefaults: dto.profileDefaults as Prisma.InputJsonValue,
          stageTemplates: (dto.stageTemplates ?? []) as Prisma.InputJsonValue,
          edgeCompatibility: dto.edgeCompatibility as Prisma.InputJsonValue | undefined,
          createdByUserId: actor.id,
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id, organizationId, action: 'CATALOG_VERSION_DRAFTED', entityType: 'PlantCatalogVersion', entityId: version.id,
          details: dto.changeOrigin ? { changeOrigin: dto.changeOrigin } : undefined,
        },
      });
      return version;
    });
  }

  async updateCatalogVersion(organizationId: string, versionId: string, dto: UpdateCatalogVersionDto, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    const version = await this.prisma.plantCatalogVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Plant catalog version not found');
    if (version.status !== PlantVersionStatus.DRAFT) throw new ConflictException('Published catalog versions are immutable');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.plantCatalogVersion.update({
        where: { id: versionId },
        data: {
          ...(dto.profileDefaults !== undefined ? { profileDefaults: dto.profileDefaults as Prisma.InputJsonValue } : {}),
          ...(dto.stageTemplates !== undefined ? { stageTemplates: dto.stageTemplates as Prisma.InputJsonValue } : {}),
          ...(dto.edgeCompatibility !== undefined ? { edgeCompatibility: dto.edgeCompatibility as Prisma.InputJsonValue } : {}),
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id, organizationId, action: 'CATALOG_VERSION_EDITED', entityType: 'PlantCatalogVersion', entityId: versionId,
          details: dto.changeOrigin ? { changeOrigin: dto.changeOrigin } : undefined,
        },
      });
      return result;
    });
    return updated;
  }

  async deleteCatalogVersion(organizationId: string, versionId: string, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL app.allow_plant_cascade_delete = 'on'`;
        const version = await tx.plantCatalogVersion.findFirst({
          where: { id: versionId, plantCatalog: { organizationId } },
          select: { id: true, status: true, plantCatalogId: true },
        });
        if (!version) throw new NotFoundException('Plant catalog version not found');

        const profileVersions = await tx.plantProfileVersion.findMany({
          where: { organizationId, plantCatalogId: version.plantCatalogId },
          select: { id: true, plantProfileId: true, sourceCatalogVersionId: true, adoptedFromVersionId: true },
        });
        const profileVersionById = new Map(profileVersions.map((item) => [item.id, item]));
        const profileVersionChildren = new Map<string, string[]>();
        for (const profileVersion of profileVersions) {
          if (!profileVersion.adoptedFromVersionId) continue;
          const children = profileVersionChildren.get(profileVersion.adoptedFromVersionId) ?? [];
          children.push(profileVersion.id);
          profileVersionChildren.set(profileVersion.adoptedFromVersionId, children);
        }

        const profileVersionLevels: string[][] = [];
        let level = profileVersions.filter((item) => item.sourceCatalogVersionId === versionId).map((item) => item.id);
        const includedProfileVersionIds = new Set<string>();
        while (level.length) {
          level = level.filter((id) => !includedProfileVersionIds.has(id));
          if (!level.length) break;
          profileVersionLevels.push(level);
          for (const id of level) includedProfileVersionIds.add(id);
          level = level.flatMap((id) => profileVersionChildren.get(id) ?? []);
        }
        const profileVersionIds = [...includedProfileVersionIds];
        const affectedProfileIds = [...new Set(profileVersionIds
          .map((id) => profileVersionById.get(id)?.plantProfileId)
          .filter((id): id is string => Boolean(id)))];
        const assignments = (await Promise.all(chunk(profileVersionIds).map((ids) => tx.zonePlantAssignment.findMany({
          where: { plantProfileVersionId: { in: ids } },
          select: { id: true },
        })))).flat();
        const assignmentIds = assignments.map(({ id }) => id);
        const assignmentIdChunks = chunk(assignmentIds, 500);
        const ruleSets = (await Promise.all(chunk(profileVersionIds).map((ids) => tx.zoneRuleSet.findMany({
          where: { plantProfileVersionId: { in: ids } },
          select: { id: true },
        })))).flat();
        const ruleSetIds = ruleSets.map(({ id }) => id);
        const ruleSetIdChunks = chunk(ruleSetIds, 500);
        const decisionsByReference = await Promise.all([
          ...chunk(profileVersionIds).map((ids) => tx.zoneDecision.findMany({
            where: { plantProfileVersionId: { in: ids } },
            select: { id: true },
          })),
          ...chunk(assignmentIds).map((ids) => tx.zoneDecision.findMany({
            where: { assignmentId: { in: ids } },
            select: { id: true },
          })),
          ...chunk(ruleSetIds).map((ids) => tx.zoneDecision.findMany({
            where: { ruleSetId: { in: ids } },
            select: { id: true },
          })),
        ]);
        const decisionIdChunks = chunk([...new Set(decisionsByReference.flatMap((rows) => rows.map(({ id }) => id)))], 500);
        for (const decisionIdChunk of decisionIdChunks) {
          await tx.zoneDecisionFeedback.deleteMany({ where: { decisionId: { in: decisionIdChunk } } });
          await tx.zoneDecision.deleteMany({ where: { id: { in: decisionIdChunk } } });
        }
        for (const assignmentIdChunk of assignmentIdChunks) {
          await tx.zoneParameterOverride.deleteMany({ where: { assignmentId: { in: assignmentIdChunk } } });
          await tx.zonePlantAssignment.deleteMany({ where: { id: { in: assignmentIdChunk } } });
        }
        for (const ruleSetIdChunk of ruleSetIdChunks) {
          await tx.zoneRuleSet.deleteMany({ where: { id: { in: ruleSetIdChunk } } });
        }

        const growthStages = (await Promise.all(chunk(profileVersionIds).map((ids) => tx.growthStage.findMany({
          where: { plantProfileVersionId: { in: ids } },
          select: { id: true },
        })))).flat();
        const growthStageIdChunks = chunk(growthStages.map(({ id }) => id), 500);
        for (const growthStageIdChunk of growthStageIdChunks) {
          await tx.stageParameterConfig.deleteMany({ where: { growthStageId: { in: growthStageIdChunk } } });
          await tx.growthStage.deleteMany({ where: { id: { in: growthStageIdChunk } } });
        }
        for (const profileVersionLevel of profileVersionLevels.reverse()) {
          for (const profileVersionIdChunk of chunk(profileVersionLevel, 500)) {
            await tx.plantProfileVersion.deleteMany({ where: { id: { in: profileVersionIdChunk } } });
          }
        }
        if (affectedProfileIds.length) {
          const remainingVersions = (await Promise.all(chunk(affectedProfileIds).map((ids) => tx.plantProfileVersion.findMany({
            where: { plantProfileId: { in: ids } },
            select: { plantProfileId: true },
          })))).flat();
          const profilesWithVersions = new Set(remainingVersions.map(({ plantProfileId }) => plantProfileId));
          const emptyProfileIds = affectedProfileIds.filter((id) => !profilesWithVersions.has(id));
          if (emptyProfileIds.length) await tx.plantProfile.deleteMany({ where: { id: { in: emptyProfileIds } } });
        }
        const deletedProposals = await tx.plantAiProposal.deleteMany({ where: { targetCatalogVersionId: versionId } });
        const deletedDeviceConfigurations = await tx.devicePlantConfiguration.deleteMany({ where: { catalogVersionId: versionId } });
        await tx.plantParameterDefinition.deleteMany({ where: { plantCatalogVersionId: versionId } });
        const deleted = await tx.plantCatalogVersion.deleteMany({
          where: { id: versionId, status: version.status },
        });
        if (deleted.count !== 1) {
          throw new ConflictException('The standard changed while it was being deleted. Refresh and try again.');
        }
        await tx.plantConfigAuditEvent.create({
          data: {
            actorUserId: actor.id,
            organizationId,
            action: 'CATALOG_VERSION_CASCADE_DELETED',
            entityType: 'PlantCatalogVersion',
            entityId: versionId,
            details: {
              deletedStatus: version.status,
              deletedProfileVersionCount: profileVersionIds.length,
              deletedAssignmentCount: assignmentIds.length,
              deletedProposalCount: deletedProposals.count,
              deletedDeviceConfigurationCount: deletedDeviceConfigurations.count,
            },
          },
        });
        return {
          id: versionId,
          deleted: true as const,
          deletedProfileVersionCount: profileVersionIds.length,
          deletedAssignmentCount: assignmentIds.length,
          deletedProposalCount: deletedProposals.count,
          deletedDeviceConfigurationCount: deletedDeviceConfigurations.count,
        };
      }, { timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2014'].includes(error.code)) {
        throw new ConflictException({
          code: 'PLANT_CASCADE_DELETE_BLOCKED',
          message: 'A related record could not be removed safely. No data was deleted; contact an administrator.',
          databaseCode: error.code,
        });
      }
      if (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('P0001')) {
        throw new ConflictException({
          code: 'PLANT_CASCADE_MIGRATION_REQUIRED',
          message: 'The database still blocks deletion of validated plant data. Apply migration 20261029130000_phase10_7_explicit_plant_cascade_delete, then retry. No data was deleted.',
        });
      }
      throw error;
    }
  }

  async createParameterDefinition(organizationId: string, versionId: string, dto: CreateParameterDefinitionDto, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    const version = await this.prisma.plantCatalogVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Plant catalog version not found');
    if (version.status !== PlantVersionStatus.DRAFT) throw new ConflictException('Published catalog versions are immutable');
    const normalized = this.validateParameterDefinition({
      parameterKey: dto.parameterKey,
      label: dto.label,
      dataType: dto.dataType,
      unit: dto.unit,
      valueSchema: dto.valueSchema,
      metadataSchema: dto.metadataSchema ?? {},
    });
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.plantParameterDefinition.create({
        data: {
          plantCatalogVersionId: versionId,
          ...normalized,
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id, organizationId, action: 'PARAMETER_DEFINED', entityType: 'PlantParameterDefinition', entityId: definition.id,
          details: dto.changeOrigin ? { changeOrigin: dto.changeOrigin } : undefined,
        },
      });
      return definition;
    });
  }

  async updateParameterDefinition(organizationId: string, versionId: string, parameterId: string, dto: UpdateParameterDefinitionDto, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.plantParameterDefinition.findFirst({
        where: { id: parameterId, plantCatalogVersionId: versionId },
        include: { plantCatalogVersion: true },
      });
      if (!definition) throw new NotFoundException('Plant parameter definition not found');
      const version = definition.plantCatalogVersion;
      if (version.status !== PlantVersionStatus.DRAFT) throw new ConflictException('Only parameter definitions on draft catalog versions can be edited');

      const normalized = this.validateParameterDefinition({
        parameterKey: dto.parameterKey ?? definition.parameterKey,
        label: dto.label ?? definition.label,
        dataType: dto.dataType ?? definition.dataType,
        unit: dto.unit === undefined ? definition.unit ?? undefined : dto.unit ?? undefined,
        valueSchema: dto.valueSchema ?? definition.valueSchema as Record<string, unknown>,
        metadataSchema: dto.metadataSchema ?? definition.metadataSchema as Record<string, unknown>,
      });
      if (normalized.parameterKey !== definition.parameterKey && catalogVersionUsesParameter(version, definition.parameterKey)) {
        throw new ConflictException('Parameter key is referenced by catalog defaults or stage templates');
      }

      const currentDefinitions = await tx.plantParameterDefinition.findMany({ where: { plantCatalogVersionId: versionId } });
      const nextDefinitions = currentDefinitions.map((item) => item.id === parameterId ? { ...item, ...normalized } : item);
      this.validateCatalogDraftConfiguration(version, nextDefinitions);

      const updated = await tx.plantParameterDefinition.update({ where: { id: parameterId }, data: normalized });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id, organizationId, action: 'PARAMETER_DEFINITION_EDITED', entityType: 'PlantParameterDefinition', entityId: parameterId,
          details: dto.changeOrigin ? { changeOrigin: dto.changeOrigin } : undefined,
        },
      });
      return updated;
    });
  }

  async deleteParameterDefinition(organizationId: string, versionId: string, parameterId: string, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.plantParameterDefinition.findFirst({
        where: { id: parameterId, plantCatalogVersionId: versionId },
        include: { plantCatalogVersion: true },
      });
      if (!definition) throw new NotFoundException('Plant parameter definition not found');
      const version = definition.plantCatalogVersion;
      if (version.status !== PlantVersionStatus.DRAFT) throw new ConflictException('Only parameter definitions on draft catalog versions can be deleted');
      if (catalogVersionUsesParameter(version, definition.parameterKey)) {
        throw new ConflictException('Parameter is referenced by catalog defaults or stage templates');
      }

      const remaining = await tx.plantParameterDefinition.findMany({
        where: { plantCatalogVersionId: versionId, id: { not: parameterId } },
      });
      this.validateCatalogDraftConfiguration(version, remaining);
      await tx.plantParameterDefinition.delete({ where: { id: parameterId } });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'PARAMETER_DEFINITION_DELETED', entityType: 'PlantParameterDefinition', entityId: parameterId },
      });
      return { id: parameterId, deleted: true };
    });
  }

  async validateCatalogParameter(organizationId: string, versionId: string, parameterId: string, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    const version = await this.prisma.plantCatalogVersion.findFirst({
      where: { id: versionId, plantCatalog: { organizationId } },
      include: { parameterDefinitions: true },
    });
    if (!version) throw new NotFoundException('Plant catalog version not found');
    const definition = version.parameterDefinitions.find((item) => item.id === parameterId);
    if (!definition) throw new NotFoundException('Plant parameter definition not found');
    try {
      validateCatalogConfiguration(version, version.parameterDefinitions);
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Catalog configuration is invalid');
    }

    const checksum = plantParameterDefinitionChecksum(definition);
    const existing = await this.prisma.plantConfigAuditEvent.findFirst({
      where: {
        organizationId,
        action: 'CATALOG_PARAMETER_USER_VALIDATED',
        entityType: 'PlantParameterDefinition',
        entityId: parameterId,
        toChecksum: checksum,
        actorUserId: actor.id,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, actorUserId: true, createdAt: true },
    });
    if (existing) {
      return {
        parameterId,
        parameterKey: definition.parameterKey,
        validated: true,
        validatedByUserId: existing.actorUserId,
        validatedAt: existing.createdAt,
      };
    }

    const audit = await this.prisma.plantConfigAuditEvent.create({
      data: {
        actorUserId: actor.id,
        organizationId,
        action: 'CATALOG_PARAMETER_USER_VALIDATED',
        entityType: 'PlantParameterDefinition',
        entityId: parameterId,
        toChecksum: checksum,
        details: { catalogVersionId: versionId, parameterKey: definition.parameterKey, reviewType: 'USER_REVIEW' },
      },
      select: { actorUserId: true, createdAt: true },
    });
    return {
      parameterId,
      parameterKey: definition.parameterKey,
      validated: true,
      validatedByUserId: audit.actorUserId,
      validatedAt: audit.createdAt,
    };
  }

  async listCatalogParameterValidations(organizationId: string, versionId: string, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    const version = await this.prisma.plantCatalogVersion.findFirst({
      where: { id: versionId, plantCatalog: { organizationId } },
      include: { parameterDefinitions: true },
    });
    if (!version) throw new NotFoundException('Plant catalog version not found');
    if (version.parameterDefinitions.length === 0) return [];

    const audits = await this.prisma.plantConfigAuditEvent.findMany({
      where: {
        organizationId,
        action: 'CATALOG_PARAMETER_USER_VALIDATED',
        entityType: 'PlantParameterDefinition',
        entityId: { in: version.parameterDefinitions.map(({ id }) => id) },
        actorUserId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, actorUserId: true, toChecksum: true, createdAt: true },
    });
    const latestByParameter = new Map<string, (typeof audits)[number]>();
    for (const audit of audits) {
      if (!latestByParameter.has(audit.entityId)) latestByParameter.set(audit.entityId, audit);
    }
    return version.parameterDefinitions.map((definition) => {
      const audit = latestByParameter.get(definition.id);
      const validated = audit?.toChecksum === plantParameterDefinitionChecksum(definition);
      return {
        parameterId: definition.id,
        parameterKey: definition.parameterKey,
        validated,
        validatedByUserId: validated ? audit?.actorUserId ?? null : null,
        validatedAt: validated ? audit?.createdAt ?? null : null,
      };
    });
  }

  async publishCatalogVersion(organizationId: string, versionId: string, actor: AuthenticatedUser) {
    await this.assertCatalogVersionOrganization(organizationId, actor, versionId, true);
    const version = await this.prisma.plantCatalogVersion.findUnique({
      where: { id: versionId },
      include: { parameterDefinitions: true },
    });
    if (!version) throw new NotFoundException('Plant catalog version not found');
    if (version.status !== PlantVersionStatus.DRAFT) throw new ConflictException('Only draft catalog versions can be published');
    try {
      validateCatalogConfiguration(version, version.parameterDefinitions);
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Catalog configuration is invalid');
    }
    const checksum = configChecksum({
      configSchemaVersion: version.configSchemaVersion,
      profileDefaults: version.profileDefaults,
      stageTemplates: version.stageTemplates,
      edgeCompatibility: version.edgeCompatibility,
      parameterDefinitions: version.parameterDefinitions
        .map(({ parameterKey, label, dataType, unit, valueSchema, metadataSchema }) => ({
          parameterKey, label, dataType, unit, valueSchema, metadataSchema,
        }))
        .sort((left, right) => left.parameterKey.localeCompare(right.parameterKey)),
    });
    const now = new Date();
    const published = await this.prisma.$transaction(async (tx) => {
      const result = await tx.plantCatalogVersion.update({
        where: { id: versionId },
        data: { status: PlantVersionStatus.PUBLISHED, checksum, publishedByUserId: actor.id, publishedAt: now },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'CATALOG_VERSION_PUBLISHED', entityType: 'PlantCatalogVersion', entityId: versionId, toChecksum: checksum },
      });
      return result;
    });
    return published;
  }

  async createPlatformGrant(userId: string, actor: AuthenticatedUser) {
    if (userId === actor.id) throw new ForbiddenException('Platform administrators cannot grant this permission to themselves');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
    if (!target?.isActive) throw new NotFoundException('Active user not found');
    const grant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformAdminGrant.create({
        data: { userId, permission: PlatformPermission.PLANT_CATALOG_ADMIN, grantedByUserId: actor.id },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, action: 'PLATFORM_GRANT_CREATED', entityType: 'PlatformAdminGrant', entityId: created.id, details: { userId } },
      });
      return created;
    });
    return grant;
  }

  async revokePlatformGrant(grantId: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.platformAdminGrant.findUnique({ where: { id: grantId } });
      if (!grant || grant.permission !== PlatformPermission.PLANT_CATALOG_ADMIN) {
        throw new NotFoundException('Platform grant not found');
      }
      if (grant.revokedAt) return grant;
      const revoked = await tx.platformAdminGrant.update({
        where: { id: grantId, permission: PlatformPermission.PLANT_CATALOG_ADMIN, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, action: 'PLATFORM_GRANT_REVOKED', entityType: 'PlatformAdminGrant', entityId: grantId, details: { userId: grant.userId } },
      });
      return revoked;
    });
  }

  async listPlatformGrants() {
    const grants = await this.prisma.platformAdminGrant.findMany({
      where: { permission: PlatformPermission.PLANT_CATALOG_ADMIN },
      select: {
        id: true,
        userId: true,
        grantedAt: true,
        revokedAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { grantedAt: 'desc' },
    });
    return grants.map((grant) => ({ ...grant, status: grant.revokedAt ? 'REVOKED' : 'ACTIVE' }));
  }

  async listProfiles(organizationId: string, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, false);
    return this.prisma.plantProfile.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: {
        plantCatalog: true,
        versions: { orderBy: { version: 'desc' }, include: { growthStages: { orderBy: { sequence: 'asc' } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getProfile(organizationId: string, profileId: string, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, false);
    const profile = await this.prisma.plantProfile.findFirst({
      where: { id: profileId, organizationId, status: 'ACTIVE' },
      include: { plantCatalog: true, versions: { orderBy: { version: 'desc' }, include: { growthStages: { orderBy: { sequence: 'asc' }, include: { parameterConfig: true } } } } },
    });
    if (!profile) throw new NotFoundException('Plant profile not found');
    return profile;
  }

  async createProfileVersion(organizationId: string, profileId: string, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.$transaction(async (tx) => {
      const lockedProfiles = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "plant_profiles"
        WHERE "id" = ${profileId}
          AND "organizationId" = ${organizationId}
          AND "status" = 'ACTIVE'
        FOR UPDATE
      `;
      if (lockedProfiles.length === 0) throw new NotFoundException('Plant profile not found');

      const profile = await tx.plantProfile.findFirst({
        where: { id: profileId, organizationId, status: 'ACTIVE' },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { growthStages: { orderBy: { sequence: 'asc' }, include: { parameterConfig: true } } } } },
      });
      if (!profile) throw new NotFoundException('Plant profile not found');
      const prior = profile.versions[0];
      if (!prior || prior.status === PlantProfileVersionStatus.DRAFT) {
        throw new ConflictException({ code: 'PROFILE_DRAFT_ALREADY_EXISTS', message: 'A draft version already exists or no validated version is available' });
      }
      if (prior.status !== PlantProfileVersionStatus.VALIDATED) {
        throw new ConflictException({ code: 'PROFILE_VERSION_NOT_VALID_BASE', message: 'Only a validated profile version can be used as a draft base' });
      }
      const version = await tx.plantProfileVersion.create({
        data: {
          plantProfileId: profileId, organizationId, plantCatalogId: profile.plantCatalogId,
          version: prior.version + 1, sourceCatalogVersionId: prior.sourceCatalogVersionId,
          adoptedFromVersionId: prior.id, status: PlantProfileVersionStatus.DRAFT,
          draftRevision: 1,
          configSchemaVersion: prior.configSchemaVersion, profileConfig: prior.profileConfig as Prisma.InputJsonValue,
          createdByUserId: actor.id,
          growthStages: { create: prior.growthStages.map((stage) => ({
            code: stage.code, label: stage.label, sequence: stage.sequence,
            minDurationDays: stage.minDurationDays, maxDurationDays: stage.maxDurationDays,
            transitionCriteria: stage.transitionCriteria ?? undefined,
            parameterConfig: { create: { config: stage.parameterConfig?.config ?? {}, configSchemaVersion: prior.configSchemaVersion } },
          })) },
        },
        include: { growthStages: { orderBy: { sequence: 'asc' }, include: { parameterConfig: true } } },
      });
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: 'PLANT_PROFILE_VERSION_DRAFTED', entityType: 'PlantProfileVersion', entityId: version.id, fromChecksum: prior.checksum } });
      return version;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async updateProfileDraft(organizationId: string, versionId: string, dto: UpdateProfileDraftDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.$transaction(async (tx) => {
      const nextRevision = await this.claimDraftRevision(tx, organizationId, versionId, dto.expectedRevision);
      const version = await tx.plantProfileVersion.findFirst({ where: { id: versionId, organizationId, status: PlantProfileVersionStatus.DRAFT } });
      if (!version) throw new NotFoundException('Plant profile version not found');
      if (dto.name !== undefined) await tx.plantProfile.update({ where: { id: version.plantProfileId }, data: { name: dto.name.trim() } });
      const updated = await tx.plantProfileVersion.update({
        where: { id: versionId, organizationId, status: PlantProfileVersionStatus.DRAFT, draftRevision: nextRevision },
        data: dto.profileConfig !== undefined ? { profileConfig: dto.profileConfig as Prisma.InputJsonValue } : {},
      });
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: 'PLANT_PROFILE_DRAFT_EDITED', entityType: 'PlantProfileVersion', entityId: versionId, details: { draftRevision: nextRevision } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async createGrowthStage(organizationId: string, versionId: string, dto: CreateDraftGrowthStageDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.$transaction(async (tx) => {
      const nextRevision = await this.claimDraftRevision(tx, organizationId, versionId, dto.expectedRevision);
      const version = await tx.plantProfileVersion.findFirst({
        where: { id: versionId, organizationId, status: PlantProfileVersionStatus.DRAFT },
        include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } },
      });
      if (!version) throw new NotFoundException('Plant profile version not found');
      try {
        validatePlantLayer(dto.config ?? EMPTY_CONFIG, buildParameterObjectSchema(version.sourceCatalogVersion.parameterDefinitions, { partial: true }));
      } catch (error) {
        throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Stage configuration is invalid');
      }
      let stage;
      try {
        stage = await tx.growthStage.create({
          data: { plantProfileVersionId: versionId, ...this.stageCreateInput(dto, version.configSchemaVersion) },
          include: { parameterConfig: true },
        });
      } catch (error) {
        const duplicate = growthStageUniqueConflict(error);
        if (duplicate === 'code') {
          throw new ConflictException({
            code: 'GROWTH_STAGE_CODE_EXISTS',
            message: 'A growth stage with this code already exists in this profile version',
          });
        }
        if (duplicate === 'sequence') {
          throw new ConflictException({
            code: 'GROWTH_STAGE_SEQUENCE_EXISTS',
            message: 'A growth stage with this sequence already exists in this profile version',
          });
        }
        throw error;
      }
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: 'GROWTH_STAGE_CREATED', entityType: 'GrowthStage', entityId: stage.id, details: { draftRevision: nextRevision } } });
      return stage;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async updateGrowthStage(organizationId: string, stageId: string, dto: UpdateGrowthStageDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.$transaction(async (tx) => {
      const stageIdentity = await tx.growthStage.findFirst({
        where: { id: stageId, plantProfileVersion: { organizationId } },
        select: { plantProfileVersionId: true },
      });
      if (!stageIdentity) throw new NotFoundException('Growth stage not found');
      const nextRevision = await this.claimDraftRevision(tx, organizationId, stageIdentity.plantProfileVersionId, dto.expectedRevision);
      const stage = await tx.growthStage.findFirst({
        where: { id: stageId, plantProfileVersionId: stageIdentity.plantProfileVersionId },
        include: { plantProfileVersion: { include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } } }, parameterConfig: true },
      });
      if (!stage) throw new NotFoundException('Growth stage not found');
      if (dto.config !== undefined) {
        try {
          validatePlantLayer(dto.config, buildParameterObjectSchema(stage.plantProfileVersion.sourceCatalogVersion.parameterDefinitions, { partial: true }));
        } catch (error) {
          throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Stage configuration is invalid');
        }
      }
      const updated = await tx.growthStage.update({
        where: { id: stageId },
        data: {
          ...(dto.code !== undefined ? { code: dto.code.trim().toLowerCase() } : {}),
          ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
          ...(dto.sequence !== undefined ? { sequence: dto.sequence } : {}),
          ...(dto.minDurationDays !== undefined ? { minDurationDays: dto.minDurationDays } : {}),
          ...(dto.maxDurationDays !== undefined ? { maxDurationDays: dto.maxDurationDays } : {}),
          ...(dto.transitionCriteria !== undefined ? { transitionCriteria: dto.transitionCriteria as Prisma.InputJsonValue } : {}),
          ...(dto.config !== undefined ? { parameterConfig: { upsert: { create: { config: dto.config as Prisma.InputJsonValue, configSchemaVersion: stage.plantProfileVersion.configSchemaVersion }, update: { config: dto.config as Prisma.InputJsonValue, checksum: null } } } } : {}),
        },
        include: { parameterConfig: true },
      });
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: 'GROWTH_STAGE_EDITED', entityType: 'GrowthStage', entityId: stageId, details: { draftRevision: nextRevision } } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async listAudit(organizationId: string, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.plantConfigAuditEvent.findMany({
      where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, actorUserId: true, action: true, entityType: true, entityId: true, fromChecksum: true, toChecksum: true, details: true, requestId: true, createdAt: true },
    });
  }

  async listZoneAssignments(zoneId: string, actor: AuthenticatedUser) {
    const organizationId = await this.authorization.zoneOrganizationId(zoneId);
    await this.requireOrganization(actor.id, organizationId, false);
    return this.prisma.zonePlantAssignment.findMany({
      where: { zoneId, organizationId },
      orderBy: [{ activatedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        plantProfileVersion: {
          include: {
            plantProfile: { select: { id: true, code: true, name: true, status: true } },
            sourceCatalogVersion: {
              select: {
                id: true,
                version: true,
                status: true,
                configSchemaVersion: true,
                parameterDefinitions: true,
              },
            },
          },
        },
        growthStage: { include: { parameterConfig: true } },
        overrides: { orderBy: { revision: 'desc' } },
      },
    });
  }

  async createProfile(organizationId: string, dto: CreatePlantProfileDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const source = await this.getPublishedCatalogVersion(dto.catalogVersionId, organizationId);
    const profileConfig = mergePlantConfig(source.profileDefaults as Record<string, unknown>, dto.profileConfig ?? {});
    const profileId = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.plantProfile.create({
        data: {
          organizationId,
          plantCatalogId: source.plantCatalogId,
          code: dto.code.trim().toLowerCase(),
          name: dto.name.trim(),
          createdByUserId: actor.id,
          versions: {
            create: {
              version: 1,
              status: PlantProfileVersionStatus.DRAFT,
              configSchemaVersion: source.configSchemaVersion,
              profileConfig: profileConfig as Prisma.InputJsonValue,
              sourceCatalogVersion: { connect: { id_plantCatalogId: { id: source.id, plantCatalogId: source.plantCatalogId } } },
              organization: { connect: { id: organizationId } },
              createdBy: { connect: { id: actor.id } },
              growthStages: {
                create: dto.stages.map((stage) => this.stageCreateInput(stage, source.configSchemaVersion)),
              },
            },
          },
        },
        select: { id: true },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'PLANT_PROFILE_CREATED', entityType: 'PlantProfile', entityId: profile.id },
      });
      return profile.id;
    });
    return this.prisma.plantProfile.findUnique({
      where: { id: profileId },
      include: { versions: { include: { growthStages: { include: { parameterConfig: true } } } }, plantCatalog: true },
    });
  }

  async adoptCatalogVersion(organizationId: string, profileId: string, dto: AdoptPlantCatalogVersionDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const source = await this.getPublishedCatalogVersion(dto.catalogVersionId, organizationId);
    return this.prisma.$transaction(async (tx) => {
      const lockedProfiles = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "plant_profiles"
        WHERE "id" = ${profileId}
          AND "organizationId" = ${organizationId}
          AND "status" = 'ACTIVE'
        FOR UPDATE
      `;
      if (lockedProfiles.length === 0) throw new NotFoundException('Plant profile not found');
      const profile = await tx.plantProfile.findFirst({
        where: { id: profileId, organizationId, status: 'ACTIVE' },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { growthStages: { include: { parameterConfig: true }, orderBy: { sequence: 'asc' } } } } },
      });
      if (!profile) throw new NotFoundException('Plant profile not found');
      if (source.plantCatalogId !== profile.plantCatalogId) throw new ConflictException('Catalog source cannot change for an existing profile');
      const prior = profile.versions[0];
      if (!prior) throw new ConflictException('Plant profile has no source version');
      if (prior.status === PlantProfileVersionStatus.DRAFT) {
        throw new ConflictException({ code: 'PROFILE_DRAFT_ALREADY_EXISTS', message: 'A draft version already exists' });
      }
      if (prior.status !== PlantProfileVersionStatus.VALIDATED) {
        throw new ConflictException('Only a validated profile version can be used as an adoption base');
      }
      const version = await tx.plantProfileVersion.create({
        data: {
        plantProfileId: profileId,
        organizationId,
        plantCatalogId: profile.plantCatalogId,
        version: prior.version + 1,
        sourceCatalogVersionId: source.id,
        adoptedFromVersionId: prior.id,
        status: PlantProfileVersionStatus.DRAFT,
        configSchemaVersion: source.configSchemaVersion,
        profileConfig: mergePlantConfig(source.profileDefaults as Record<string, unknown>, prior.profileConfig as Record<string, unknown>) as Prisma.InputJsonValue,
        createdByUserId: actor.id,
        growthStages: {
          create: prior.growthStages.map((stage) => ({
            code: stage.code,
            label: stage.label,
            sequence: stage.sequence,
            minDurationDays: stage.minDurationDays,
            maxDurationDays: stage.maxDurationDays,
            transitionCriteria: stage.transitionCriteria ?? undefined,
            parameterConfig: { create: {
              config: stage.parameterConfig?.config ?? {},
              configSchemaVersion: source.configSchemaVersion,
            } },
          })),
        },
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'CATALOG_VERSION_ADOPTED', entityType: 'PlantProfileVersion', entityId: version.id, fromChecksum: prior.checksum, details: { sourceCatalogVersionId: source.id } },
      });
      return version;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async validateProfileVersion(organizationId: string, versionId: string, expectedRevision: number, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.$transaction(async (tx) => {
      const sealedRevision = await this.claimDraftRevision(tx, organizationId, versionId, expectedRevision);
      const version = await tx.plantProfileVersion.findFirst({
        where: { id: versionId, organizationId, status: PlantProfileVersionStatus.DRAFT, draftRevision: sealedRevision },
        include: {
          sourceCatalogVersion: { include: { parameterDefinitions: true } },
          growthStages: { orderBy: { sequence: 'asc' }, include: { parameterConfig: true } },
        },
      });
      if (!version) return this.throwDraftRevisionConflict(tx, organizationId, versionId, expectedRevision);
      if (version.growthStages.length === 0) throw new UnprocessableEntityException('At least one growth stage is required');
      const schema = buildParameterObjectSchema(version.sourceCatalogVersion.parameterDefinitions);
      const definitions = version.sourceCatalogVersion.parameterDefinitions;
      const partialSchema = buildParameterObjectSchema(definitions, { partial: true });
      try {
        validatePlantLayer(version.profileConfig as Record<string, unknown>, partialSchema);
        for (const stage of version.growthStages) {
          const stageConfig = (stage.parameterConfig?.config ?? EMPTY_CONFIG) as Record<string, unknown>;
          const effective = mergePlantConfig(version.profileConfig as Record<string, unknown>, stageConfig);
          validatePlantLayer(effective, schema);
        }
      } catch (error) {
        throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Plant profile configuration is invalid');
      }
      const checksum = configChecksum({
        sourceCatalogChecksum: version.sourceCatalogVersion.checksum,
        configSchemaVersion: version.configSchemaVersion,
        draftRevision: sealedRevision,
        profileConfig: version.profileConfig,
        stages: version.growthStages.map((stage) => ({
          code: stage.code, sequence: stage.sequence,
          minDurationDays: stage.minDurationDays, maxDurationDays: stage.maxDurationDays,
          transitionCriteria: stage.transitionCriteria,
          config: stage.parameterConfig?.config ?? {},
        })),
      });
      for (const stage of version.growthStages) {
        if (!stage.parameterConfig) continue;
        await tx.stageParameterConfig.update({
          where: { id: stage.parameterConfig.id },
          data: {
            checksum: configChecksum({
              configSchemaVersion: stage.parameterConfig.configSchemaVersion,
              config: stage.parameterConfig.config,
            }),
          },
        });
      }
      const sealed = await tx.plantProfileVersion.updateMany({
        where: { id: version.id, organizationId, status: PlantProfileVersionStatus.DRAFT, draftRevision: sealedRevision },
        data: { status: PlantProfileVersionStatus.VALIDATED, checksum, validatedAt: new Date(), validatedByUserId: actor.id },
      });
      if (sealed.count !== 1) return this.throwDraftRevisionConflict(tx, organizationId, versionId, expectedRevision);
      const validated = await tx.plantProfileVersion.findFirst({ where: { id: versionId, organizationId } });
      if (!validated) throw new NotFoundException('Plant profile version not found');
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'PLANT_PROFILE_VERSION_VALIDATED', entityType: 'PlantProfileVersion', entityId: version.id, toChecksum: checksum, details: { draftRevision: sealedRevision } },
      });
      return validated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async activateZone(zoneId: string, dto: ActivatePlantProfileDto, idempotencyKey: string | undefined, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, dto.organizationId, true);
    const requestKey = requireIdempotencyKey(idempotencyKey);
    const payload = {
      operation: ZoneActivationOperation.ACTIVATE,
      organizationId: dto.organizationId,
      zoneId,
      plantProfileVersionId: dto.plantProfileVersionId,
      growthStageId: dto.growthStageId,
    };
    const resourceAuthorization = async () => {
      const actualOrganizationId = await this.authorization.zoneOrganizationId(zoneId);
      if (actualOrganizationId !== dto.organizationId) throw new NotFoundException('Zone not found in organization');
    };
    await resourceAuthorization();

    return this.executeZoneOperation(
      dto.organizationId,
      ZoneActivationOperation.ACTIVATE,
      requestKey,
      payload,
      actor,
      resourceAuthorization,
      async (tx, key, requestHash) => {
        const zone = await this.lockZoneForOrganization(tx, zoneId, dto.organizationId);
        const replay = await this.findZoneOperationReplay(tx, dto.organizationId, ZoneActivationOperation.ACTIVATE, key, requestHash);
        if (replay) return replay;

        await tx.$queryRaw`SELECT "id" FROM "plant_profile_versions" WHERE "id" = ${dto.plantProfileVersionId} AND "organizationId" = ${dto.organizationId} AND "status" = 'VALIDATED' FOR SHARE`;
        const version = await tx.plantProfileVersion.findFirst({
          where: { id: dto.plantProfileVersionId, organizationId: dto.organizationId, status: PlantProfileVersionStatus.VALIDATED },
          include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } },
        });
        if (!version) throw new UnprocessableEntityException('A validated plant profile version is required');
        const stage = await tx.growthStage.findFirst({
          where: { id: dto.growthStageId, plantProfileVersionId: version.id },
          include: { parameterConfig: true },
        });
        if (!stage) throw new UnprocessableEntityException('Growth stage must belong to the selected profile version');
        const effective = mergePlantConfig(
          version.profileConfig as Record<string, unknown>,
          (stage.parameterConfig?.config ?? EMPTY_CONFIG) as Record<string, unknown>,
        );
        try {
          validatePlantLayer(effective, buildParameterObjectSchema(version.sourceCatalogVersion.parameterDefinitions));
        } catch (error) {
          throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Effective zone configuration is invalid');
        }

        const current = await tx.zonePlantAssignment.findFirst({ where: { zoneId, organizationId: dto.organizationId, status: ZonePlantAssignmentStatus.ACTIVE } });
        if (current) {
          await tx.zonePlantAssignment.update({ where: { id: current.id }, data: { status: ZonePlantAssignmentStatus.ENDED, endedAt: new Date() } });
        }
        const assignment = await tx.zonePlantAssignment.create({
          data: {
            zoneId,
            greenhouseId: zone.greenhouseId,
            organizationId: dto.organizationId,
            plantProfileVersionId: version.id,
            growthStageId: stage.id,
            status: ZonePlantAssignmentStatus.ACTIVE,
            assignedByUserId: actor.id,
          },
        });
        await tx.plantConfigAuditEvent.create({
          data: {
            actorUserId: actor.id,
            organizationId: dto.organizationId,
            action: 'ZONE_PLANT_ACTIVATED',
            entityType: 'ZonePlantAssignment',
            entityId: assignment.id,
            toChecksum: configChecksum({ profileVersionChecksum: version.checksum, stageConfigChecksum: stage.parameterConfig?.checksum, effective }),
          },
        });
        await this.saveZoneOperationResult(tx, dto.organizationId, ZoneActivationOperation.ACTIVATE, key, requestHash, actor.id, assignment);
        return assignment;
      },
    );
  }

  async updateZoneOverride(assignmentId: string, dto: CreateZoneOverrideDto, actor: AuthenticatedUser) {
    const assignment = await this.prisma.zonePlantAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        plantProfileVersion: { include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } } },
        growthStage: { include: { parameterConfig: true } },
        overrides: { where: { supersededAt: null }, take: 1, orderBy: { revision: 'desc' } },
      },
    });
    if (!assignment) throw new NotFoundException('Zone plant assignment not found');
    await this.requireOrganization(actor.id, assignment.organizationId, true);
    if (assignment.status !== ZonePlantAssignmentStatus.ACTIVE) throw new ConflictException('Overrides can only be changed on active assignments');
    const source = assignment.plantProfileVersion.sourceCatalogVersion;
    const schema = buildParameterObjectSchema(source.parameterDefinitions);
    const effective = mergePlantConfig(
      assignment.plantProfileVersion.profileConfig as Record<string, unknown>,
      (assignment.growthStage.parameterConfig?.config ?? EMPTY_CONFIG) as Record<string, unknown>,
      dto.overrideConfig,
    );
    try {
      validatePlantLayer(effective, schema);
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Effective zone configuration is invalid');
    }
    const current = assignment.overrides[0];
    const previousRevisions = await this.prisma.zoneParameterOverride.aggregate({ where: { assignmentId }, _max: { revision: true } });
    const revision = (previousRevisions._max.revision ?? 0) + 1;
    const configSchemaVersion = assignment.plantProfileVersion.configSchemaVersion;
    const checksum = configChecksum({
      configSchemaVersion,
      overrideConfig: dto.overrideConfig,
      profileChecksum: assignment.plantProfileVersion.checksum,
      stageConfigChecksum: assignment.growthStage.parameterConfig?.checksum,
    });
    return this.prisma.$transaction(async (tx) => {
      if (current) await tx.zoneParameterOverride.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
      const override = await tx.zoneParameterOverride.create({
          data: { assignmentId, revision, overrideConfig: dto.overrideConfig as Prisma.InputJsonValue, configSchemaVersion, checksum, createdByUserId: actor.id },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId: assignment.organizationId, action: 'ZONE_OVERRIDE_CREATED', entityType: 'ZoneParameterOverride', entityId: override.id, fromChecksum: current?.checksum, toChecksum: checksum },
      });
      return override;
    });
  }

  async revokeAssignment(assignmentId: string, organizationId: string, idempotencyKey: string | undefined, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const requestKey = requireIdempotencyKey(idempotencyKey);
    const initialAssignment = await this.prisma.zonePlantAssignment.findFirst({
      where: { id: assignmentId, organizationId },
      select: { id: true, zoneId: true },
    });
    if (!initialAssignment) throw new NotFoundException('Zone plant assignment not found');
    const resourceAuthorization = async () => {
      const actualOrganizationId = await this.authorization.zoneOrganizationId(initialAssignment.zoneId);
      if (actualOrganizationId !== organizationId) throw new NotFoundException('Zone plant assignment not found');
      const current = await this.prisma.zonePlantAssignment.findFirst({ where: { id: assignmentId, organizationId }, select: { id: true } });
      if (!current) throw new NotFoundException('Zone plant assignment not found');
    };
    await resourceAuthorization();
    const payload = { operation: ZoneActivationOperation.DEACTIVATE, organizationId, assignmentId };

    return this.executeZoneOperation(
      organizationId,
      ZoneActivationOperation.DEACTIVATE,
      requestKey,
      payload,
      actor,
      resourceAuthorization,
      async (tx, key, requestHash) => {
        await this.lockZoneForOrganization(tx, initialAssignment.zoneId, organizationId);
        const replay = await this.findZoneOperationReplay(tx, organizationId, ZoneActivationOperation.DEACTIVATE, key, requestHash);
        if (replay) return replay;

        const assignment = await tx.zonePlantAssignment.findFirst({ where: { id: assignmentId, organizationId, zoneId: initialAssignment.zoneId } });
        if (!assignment) throw new NotFoundException('Zone plant assignment not found');
        if (assignment.status !== ZonePlantAssignmentStatus.ACTIVE) {
          throw new ConflictException('Only an active assignment can be deactivated');
        }
        const changed = await tx.zonePlantAssignment.updateMany({
          where: { id: assignmentId, organizationId, zoneId: initialAssignment.zoneId, status: ZonePlantAssignmentStatus.ACTIVE },
          data: { status: ZonePlantAssignmentStatus.ENDED, endedAt: new Date() },
        });
        if (changed.count !== 1) throw new ConflictException('Assignment state changed; reload and retry');
        const ended = await tx.zonePlantAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
        await tx.plantConfigAuditEvent.create({
          data: { actorUserId: actor.id, organizationId, action: 'ZONE_PLANT_DEACTIVATED', entityType: 'ZonePlantAssignment', entityId: assignmentId },
        });
        await this.saveZoneOperationResult(tx, organizationId, ZoneActivationOperation.DEACTIVATE, key, requestHash, actor.id, ended);
        return ended;
      },
    );
  }

  async effectiveZoneConfig(assignmentId: string, actor: AuthenticatedUser) {
    const assignment = await this.prisma.zonePlantAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        plantProfileVersion: { include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } } },
        growthStage: { include: { parameterConfig: true } },
        overrides: { where: { supersededAt: null }, take: 1 },
      },
    });
    if (!assignment) throw new NotFoundException('Zone plant assignment not found');
    await this.requireOrganization(actor.id, assignment.organizationId, false);
    const config = mergePlantConfig(
      assignment.plantProfileVersion.profileConfig as Record<string, unknown>,
      (assignment.growthStage.parameterConfig?.config ?? EMPTY_CONFIG) as Record<string, unknown>,
      (assignment.overrides[0]?.overrideConfig ?? EMPTY_CONFIG) as Record<string, unknown>,
    );
    validatePlantLayer(config, buildParameterObjectSchema(assignment.plantProfileVersion.sourceCatalogVersion.parameterDefinitions));
    return {
      assignmentId,
      plantProfileVersionId: assignment.plantProfileVersionId,
      growthStageId: assignment.growthStageId,
      schemaVersion: assignment.plantProfileVersion.configSchemaVersion,
      checksum: configChecksum({
        schemaVersion: assignment.plantProfileVersion.configSchemaVersion,
        profileVersionChecksum: assignment.plantProfileVersion.checksum,
        stageConfigChecksum: assignment.growthStage.parameterConfig?.checksum,
        overrideChecksum: assignment.overrides[0]?.checksum,
        config,
      }),
      config,
    };
  }

  private async executeZoneOperation<T>(
    organizationId: string,
    operation: ZoneActivationOperation,
    idempotencyKey: string,
    payload: unknown,
    actor: AuthenticatedUser,
    resourceAuthorization: () => Promise<void>,
    execute: (tx: Prisma.TransactionClient, key: string, requestHash: string) => Promise<T>,
  ): Promise<T> {
    const requestHash = configChecksum(payload);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.assertActiveActorAndMembership(tx, actor.id, organizationId);
          return execute(tx, idempotencyKey, requestHash);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if (isIdempotencyUniqueConflict(error)) {
          // The conflicting transaction has rolled back. Recheck current authorization and
          // resource scope before reading a result created by another request.
          await this.requireOrganization(actor.id, organizationId, true);
          await resourceAuthorization();
          const existing = await this.prisma.zoneActivationRequest.findUnique({
            where: { organizationId_operation_idempotencyKey: { organizationId, operation, idempotencyKey } },
          });
          if (!existing) throw this.retryableZoneOperationException();
          if (existing.requestHash !== requestHash) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'Idempotency-Key was already used with a different request',
            });
          }
          return existing.response as T;
        }
        if (!isRetryableTransactionConflict(error)) throw error;
        if (attempt === 2) throw this.retryableZoneOperationException();
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    throw this.retryableZoneOperationException();
  }

  private async assertActiveActorAndMembership(tx: Prisma.TransactionClient, userId: string, organizationId: string) {
    const users = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "users" WHERE "id" = ${userId} AND "isActive" = TRUE FOR SHARE
    `;
    if (!users[0]) throw new ForbiddenException('Active user account required');
    const organizations = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} AND "deletedAt" IS NULL FOR SHARE
    `;
    if (!organizations[0]) throw new NotFoundException('Organization not found');
    const memberships = await tx.$queryRaw<Array<{ role: string }>>`
      SELECT "role" FROM "organization_memberships"
      WHERE "userId" = ${userId} AND "organizationId" = ${organizationId}
      FOR SHARE
    `;
    if (!memberships[0]) throw new ForbiddenException('You do not have access to this organization');
    if (memberships[0].role !== UserRole.OWNER && memberships[0].role !== UserRole.ADMIN) {
      throw new ForbiddenException('Organization administrator role required');
    }
  }

  private async lockZoneForOrganization(tx: Prisma.TransactionClient, zoneId: string, organizationId: string) {
    const zones = await tx.$queryRaw<Array<{ id: string; greenhouseId: string; organizationId: string }>>`
      SELECT z."id", z."greenhouseId", g."organizationId"
      FROM "zones" AS z
      JOIN "greenhouses" AS g ON g."id" = z."greenhouseId"
      WHERE z."id" = ${zoneId} AND z."deletedAt" IS NULL AND g."deletedAt" IS NULL
      FOR UPDATE OF z
    `;
    const zone = zones[0];
    if (!zone || zone.organizationId !== organizationId) throw new NotFoundException('Zone not found in organization');
    return zone;
  }

  private async findZoneOperationReplay(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: ZoneActivationOperation,
    idempotencyKey: string,
    requestHash: string,
  ) {
    const existing = await tx.zoneActivationRequest.findUnique({
      where: { organizationId_operation_idempotencyKey: { organizationId, operation, idempotencyKey } },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency-Key was already used with a different request',
      });
    }
    return existing.response;
  }

  private async saveZoneOperationResult(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: ZoneActivationOperation,
    idempotencyKey: string,
    requestHash: string,
    actorUserId: string,
    response: unknown,
  ) {
    const snapshot = JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue;
    await tx.zoneActivationRequest.create({
      data: { organizationId, operation, idempotencyKey, requestHash, actorUserId, response: snapshot },
    });
  }

  private retryableZoneOperationException() {
    return new ServiceUnavailableException({
      code: 'RETRYABLE_TRANSACTION_CONFLICT',
      message: 'Zone operation could not be serialized; retry with the same Idempotency-Key',
      retryAfterSeconds: 1,
    });
  }

  private async getPublishedCatalogVersion(id: string, organizationId: string) {
    const version = await this.prisma.plantCatalogVersion.findUnique({
      where: { id }, include: { parameterDefinitions: true },
    });
    if (!version || version.status !== PlantVersionStatus.PUBLISHED) throw new NotFoundException('Published plant catalog version not found');
    const catalog = await this.prisma.plantCatalog.findFirst({ where: { id: version.plantCatalogId, organizationId }, select: { id: true } });
    if (!catalog) throw new NotFoundException('Published plant catalog version not found');
    return version;
  }

  private async assertCatalogVersionOrganization(organizationId: string, actor: AuthenticatedUser, versionId: string, manage: boolean) {
    await this.requireOrganization(actor.id, organizationId, manage);
    const version = await this.prisma.plantCatalogVersion.findFirst({ where: { id: versionId, plantCatalog: { organizationId } }, select: { id: true } });
    if (!version) throw new NotFoundException('Plant catalog version not found');
  }

  private async claimDraftRevision(
    tx: Prisma.TransactionClient,
    organizationId: string,
    versionId: string,
    expectedRevision: number,
  ): Promise<number> {
    const claimed = await tx.plantProfileVersion.updateMany({
      where: {
        id: versionId,
        organizationId,
        status: PlantProfileVersionStatus.DRAFT,
        draftRevision: expectedRevision,
      },
      data: { draftRevision: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      return this.throwDraftRevisionConflict(tx, organizationId, versionId, expectedRevision);
    }
    return expectedRevision + 1;
  }

  private async throwDraftRevisionConflict(
    tx: Prisma.TransactionClient,
    organizationId: string,
    versionId: string,
    expectedRevision: number,
  ): Promise<never> {
    const current = await tx.plantProfileVersion.findFirst({
      where: { id: versionId, organizationId },
      select: { status: true, draftRevision: true },
    });
    if (!current) throw new NotFoundException('Plant profile version not found');
    if (current.status !== PlantProfileVersionStatus.DRAFT) {
      throw new ConflictException({
        code: 'PROFILE_VERSION_NOT_DRAFT',
        message: 'Only draft profile versions can be changed or validated',
      });
    }
    throw new ConflictException({
      code: 'STALE_DRAFT_REVISION',
      message: 'The draft changed; reload it before retrying',
      expectedRevision,
      currentRevision: current.draftRevision,
    });
  }

  private async requireOrganization(userId: string, organizationId: string, manage: boolean) {
    const membership = await this.authorization.getMembership(userId, organizationId);
    if (manage && membership.role !== UserRole.OWNER && membership.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Organization administrator role required');
    }
    await this.authorization.organizationExists(organizationId);
    return membership;
  }

  private validateParameterDefinition(input: {
    parameterKey: string;
    label: string;
    dataType: string;
    unit?: string | null;
    valueSchema: Record<string, unknown>;
    metadataSchema: Record<string, unknown>;
  }) {
    const parameterKey = input.parameterKey.trim();
    const label = input.label.trim();
    const dataType = input.dataType.trim();
    const unit = input.unit?.trim() || null;
    if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(parameterKey)) {
      throw new UnprocessableEntityException('Parameter key must be a stable identifier beginning with a lowercase letter');
    }
    if (!label || label.length > 128) throw new UnprocessableEntityException('Parameter label must contain 1 to 128 characters');
    if (unit && unit.length > 64) throw new UnprocessableEntityException('Parameter unit must not exceed 64 characters');

    const valueSchema = { ...input.valueSchema };
    const supportedTypes = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
    if (!supportedTypes.includes(dataType) || valueSchema.type !== dataType) {
      throw new UnprocessableEntityException('Parameter dataType must match the Draft 2020-12 schema type');
    }
    try {
      assertSchema2020(valueSchema);
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Parameter schema must use JSON Schema Draft 2020-12');
    }
    this.validateSchemaBounds(valueSchema);
    if (input.metadataSchema.nullable !== undefined && typeof input.metadataSchema.nullable !== 'boolean') {
      throw new UnprocessableEntityException('Parameter nullable metadata must be boolean');
    }
    if (input.metadataSchema.required !== undefined && typeof input.metadataSchema.required !== 'boolean') {
      throw new UnprocessableEntityException('Parameter required metadata must be boolean');
    }
    return {
      parameterKey,
      label,
      dataType,
      unit,
      valueSchema: valueSchema as Prisma.InputJsonValue,
      metadataSchema: input.metadataSchema as Prisma.InputJsonValue,
    };
  }

  private validateSchemaBounds(schema: Record<string, unknown>) {
    const lower = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : schema.minimum;
    const upper = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : schema.maximum;
    if (typeof lower === 'number' && typeof upper === 'number') {
      const sameBoundaryIsEmpty = lower === upper
        && (typeof schema.exclusiveMinimum === 'number' || typeof schema.exclusiveMaximum === 'number');
      if (lower > upper || sameBoundaryIsEmpty) throw new UnprocessableEntityException('Parameter numeric bounds define an empty range');
    }
    for (const [minimumKey, maximumKey, label] of [
      ['minLength', 'maxLength', 'string length'],
      ['minItems', 'maxItems', 'array item count'],
      ['minProperties', 'maxProperties', 'object property count'],
    ]) {
      const minimum = schema[minimumKey];
      const maximum = schema[maximumKey];
      if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
        throw new UnprocessableEntityException(`Parameter ${label} bounds define an empty range`);
      }
    }
  }

  private validateCatalogDraftConfiguration(
    version: { profileDefaults: unknown; stageTemplates: unknown; edgeCompatibility?: unknown },
    definitions: Array<{ parameterKey: string; valueSchema: unknown; metadataSchema?: unknown }>,
  ) {
    try {
      validateCatalogConfiguration(version, definitions);
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Catalog draft configuration is invalid');
    }
  }

  private stageCreateInput(stage: CreateGrowthStageDto, schemaVersion = PLANT_CONFIG_SCHEMA_VERSION) {
    return {
      code: stage.code.trim().toLowerCase(),
      label: stage.label.trim(),
      sequence: stage.sequence,
      minDurationDays: stage.minDurationDays,
      maxDurationDays: stage.maxDurationDays,
      transitionCriteria: stage.transitionCriteria as Prisma.InputJsonValue | undefined,
      parameterConfig: {
        create: { config: (stage.config ?? {}) as Prisma.InputJsonValue, configSchemaVersion: schemaVersion },
      },
    };
  }

  private audit(
    actorUserId: string,
    organizationId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    fromChecksum?: string | null,
    toChecksum?: string | null,
    details?: Record<string, unknown>,
  ) {
    return this.prisma.plantConfigAuditEvent.create({
      data: { actorUserId, organizationId, action, entityType, entityId, fromChecksum, toChecksum, details: details as Prisma.InputJsonValue | undefined },
    });
  }
}
