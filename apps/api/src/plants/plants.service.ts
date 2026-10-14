import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlatformPermission,
  PlantProfileVersionStatus,
  PlantVersionStatus,
  UserRole,
  ZonePlantAssignmentStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildParameterObjectSchema,
  assertSchema2020,
  configChecksum,
  mergePlantConfig,
  PLANT_CONFIG_SCHEMA_VERSION,
  validatePlantLayer,
} from './plant-config.js';
import type {
  AdoptPlantCatalogVersionDto,
  ActivatePlantProfileDto,
  CreateCatalogVersionDto,
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

@Injectable()
export class PlantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  listCatalog() {
    return this.prisma.plantCatalog.findMany({
      where: { status: 'ACTIVE', versions: { some: { status: PlantVersionStatus.PUBLISHED } } },
      include: {
        versions: {
          where: { status: PlantVersionStatus.PUBLISHED },
          orderBy: { version: 'desc' },
          include: { parameterDefinitions: true },
        },
      },
      orderBy: { commonName: 'asc' },
    });
  }

  async getCatalog(catalogId: string) {
    const catalog = await this.prisma.plantCatalog.findFirst({
      where: { id: catalogId, status: 'ACTIVE', versions: { some: { status: PlantVersionStatus.PUBLISHED } } },
      include: { versions: { where: { status: PlantVersionStatus.PUBLISHED }, orderBy: { version: 'desc' }, include: { parameterDefinitions: true } } },
    });
    if (!catalog) throw new NotFoundException('Plant catalog not found');
    return catalog;
  }

  async createCatalog(dto: CreatePlantCatalogDto, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const catalog = await tx.plantCatalog.create({
        data: {
          code: dto.code.trim().toLowerCase(),
          scientificName: dto.scientificName.trim(),
          commonName: dto.commonName.trim(),
          cultivar: dto.cultivar?.trim() || null,
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, action: 'CATALOG_CREATED', entityType: 'PlantCatalog', entityId: catalog.id },
      });
      return catalog;
    });
  }

  async createCatalogVersion(catalogId: string, dto: CreateCatalogVersionDto, actor: AuthenticatedUser) {
    const catalog = await this.prisma.plantCatalog.findUnique({ where: { id: catalogId } });
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
        data: { actorUserId: actor.id, action: 'CATALOG_VERSION_DRAFTED', entityType: 'PlantCatalogVersion', entityId: version.id },
      });
      return version;
    });
  }

  async updateCatalogVersion(versionId: string, dto: UpdateCatalogVersionDto, actor: AuthenticatedUser) {
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
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, action: 'CATALOG_VERSION_EDITED', entityType: 'PlantCatalogVersion', entityId: versionId } });
      return result;
    });
    return updated;
  }

  async createParameterDefinition(versionId: string, dto: CreateParameterDefinitionDto, actor: AuthenticatedUser) {
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
        data: { actorUserId: actor.id, action: 'PARAMETER_DEFINED', entityType: 'PlantParameterDefinition', entityId: definition.id },
      });
      return definition;
    });
  }

  async updateParameterDefinition(versionId: string, parameterId: string, dto: UpdateParameterDefinitionDto, actor: AuthenticatedUser) {
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
        data: { actorUserId: actor.id, action: 'PARAMETER_DEFINITION_EDITED', entityType: 'PlantParameterDefinition', entityId: parameterId },
      });
      return updated;
    });
  }

  async deleteParameterDefinition(versionId: string, parameterId: string, actor: AuthenticatedUser) {
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
        data: { actorUserId: actor.id, action: 'PARAMETER_DEFINITION_DELETED', entityType: 'PlantParameterDefinition', entityId: parameterId },
      });
      return { id: parameterId, deleted: true };
    });
  }

  async publishCatalogVersion(versionId: string, actor: AuthenticatedUser) {
    const version = await this.prisma.plantCatalogVersion.findUnique({
      where: { id: versionId },
      include: { parameterDefinitions: true },
    });
    if (!version) throw new NotFoundException('Plant catalog version not found');
    if (version.status !== PlantVersionStatus.DRAFT) throw new ConflictException('Only draft catalog versions can be published');
    const schema = buildParameterObjectSchema(version.parameterDefinitions);
    const partialSchema = buildParameterObjectSchema(version.parameterDefinitions, { partial: true });
    try {
      validatePlantLayer(version.profileDefaults as Record<string, unknown>, partialSchema);
      const templates = version.stageTemplates as unknown[];
      if (!templates.length) validatePlantLayer(version.profileDefaults as Record<string, unknown>, schema);
      for (const [index, template] of templates.entries()) {
        if (!template || typeof template !== 'object' || Array.isArray(template)) {
          throw new Error(`Stage template ${index + 1} must be an object`);
        }
        const config = (template as { config?: unknown }).config ?? EMPTY_CONFIG;
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Stage template config must be an object');
        validatePlantLayer(config as Record<string, unknown>, partialSchema);
        validatePlantLayer(mergePlantConfig(version.profileDefaults as Record<string, unknown>, config as Record<string, unknown>), schema);
      }
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
        data: { actorUserId: actor.id, action: 'CATALOG_VERSION_PUBLISHED', entityType: 'PlantCatalogVersion', entityId: versionId, toChecksum: checksum },
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
    const grant = await this.prisma.platformAdminGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw new NotFoundException('Platform grant not found');
    if (grant.revokedAt) return grant;
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.platformAdminGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, action: 'PLATFORM_GRANT_REVOKED', entityType: 'PlatformAdminGrant', entityId: grantId, details: { userId: grant.userId } },
      });
      return revoked;
    });
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
    const profile = await this.prisma.plantProfile.findFirst({
      where: { id: profileId, organizationId, status: 'ACTIVE' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { growthStages: { orderBy: { sequence: 'asc' }, include: { parameterConfig: true } } } } },
    });
    if (!profile) throw new NotFoundException('Plant profile not found');
    const prior = profile.versions[0];
    if (!prior || prior.status === PlantProfileVersionStatus.DRAFT) throw new ConflictException('A draft version already exists or no validated version is available');
    if (prior.status !== PlantProfileVersionStatus.VALIDATED) throw new ConflictException('Only a validated profile version can be used as a draft base');
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.plantProfileVersion.create({
        data: {
          plantProfileId: profileId, organizationId, plantCatalogId: profile.plantCatalogId,
          version: prior.version + 1, sourceCatalogVersionId: prior.sourceCatalogVersionId,
          adoptedFromVersionId: prior.id, status: PlantProfileVersionStatus.DRAFT,
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
    });
  }

  async updateProfileDraft(organizationId: string, versionId: string, dto: UpdateProfileDraftDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const version = await this.prisma.plantProfileVersion.findFirst({ where: { id: versionId, organizationId } });
    if (!version) throw new NotFoundException('Plant profile version not found');
    if (version.status !== PlantProfileVersionStatus.DRAFT) throw new ConflictException('Only draft profile versions can be edited');
    return this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined) await tx.plantProfile.update({ where: { id: version.plantProfileId }, data: { name: dto.name.trim() } });
      const updated = await tx.plantProfileVersion.update({
        where: { id: versionId },
        data: dto.profileConfig !== undefined ? { profileConfig: dto.profileConfig as Prisma.InputJsonValue } : {},
      });
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: 'PLANT_PROFILE_DRAFT_EDITED', entityType: 'PlantProfileVersion', entityId: versionId } });
      return updated;
    });
  }

  async createGrowthStage(organizationId: string, versionId: string, dto: CreateGrowthStageDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const version = await this.prisma.plantProfileVersion.findFirst({
      where: { id: versionId, organizationId },
      include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } },
    });
    if (!version) throw new NotFoundException('Plant profile version not found');
    if (version.status !== PlantProfileVersionStatus.DRAFT) throw new ConflictException('Stages can only be added to draft profile versions');
    try {
      validatePlantLayer(dto.config ?? EMPTY_CONFIG, buildParameterObjectSchema(version.sourceCatalogVersion.parameterDefinitions, { partial: true }));
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Stage configuration is invalid');
    }
    return this.prisma.$transaction(async (tx) => {
      const stage = await tx.growthStage.create({
        data: { plantProfileVersionId: versionId, ...this.stageCreateInput(dto, version.configSchemaVersion) },
        include: { parameterConfig: true },
      });
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: 'GROWTH_STAGE_CREATED', entityType: 'GrowthStage', entityId: stage.id } });
      return stage;
    });
  }

  async updateGrowthStage(organizationId: string, stageId: string, dto: UpdateGrowthStageDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const stage = await this.prisma.growthStage.findFirst({
      where: { id: stageId, plantProfileVersion: { organizationId } },
      include: { plantProfileVersion: { include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } } }, parameterConfig: true },
    });
    if (!stage) throw new NotFoundException('Growth stage not found');
    if (stage.plantProfileVersion.status !== PlantProfileVersionStatus.DRAFT) throw new ConflictException('Only stages in draft profile versions can be edited');
    if (dto.config !== undefined) {
      try {
        validatePlantLayer(dto.config, buildParameterObjectSchema(stage.plantProfileVersion.sourceCatalogVersion.parameterDefinitions, { partial: true }));
      } catch (error) {
        throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Stage configuration is invalid');
      }
    }
    return this.prisma.$transaction(async (tx) => {
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
      await tx.plantConfigAuditEvent.create({ data: { actorUserId: actor.id, organizationId, action: 'GROWTH_STAGE_EDITED', entityType: 'GrowthStage', entityId: stageId } });
      return updated;
    });
  }

  async listAudit(organizationId: string, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    return this.prisma.plantConfigAuditEvent.findMany({
      where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, actorUserId: true, action: true, entityType: true, entityId: true, fromChecksum: true, toChecksum: true, details: true, requestId: true, createdAt: true },
    });
  }

  async createProfile(organizationId: string, dto: CreatePlantProfileDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const source = await this.getPublishedCatalogVersion(dto.catalogVersionId);
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
    const profile = await this.prisma.plantProfile.findFirst({
      where: { id: profileId, organizationId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { growthStages: { include: { parameterConfig: true }, orderBy: { sequence: 'asc' } } } } },
    });
    if (!profile) throw new NotFoundException('Plant profile not found');
    const prior = profile.versions[0];
    if (!prior) throw new ConflictException('Plant profile has no source version');
    if (prior.status !== PlantProfileVersionStatus.VALIDATED) {
      throw new ConflictException('Only a validated profile version can be used as an adoption base');
    }
    const source = await this.getPublishedCatalogVersion(dto.catalogVersionId);
    if (source.plantCatalogId !== profile.plantCatalogId) throw new ConflictException('Catalog source cannot change for an existing profile');
    const latest = await this.prisma.plantProfileVersion.aggregate({ where: { plantProfileId: profileId }, _max: { version: true } });
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.plantProfileVersion.create({
        data: {
        plantProfileId: profileId,
        organizationId,
        plantCatalogId: profile.plantCatalogId,
        version: (latest._max.version ?? 0) + 1,
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
    });
  }

  async validateProfileVersion(organizationId: string, versionId: string, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const version = await this.prisma.plantProfileVersion.findFirst({
      where: { id: versionId, organizationId },
      include: {
        sourceCatalogVersion: { include: { parameterDefinitions: true } },
        growthStages: { orderBy: { sequence: 'asc' }, include: { parameterConfig: true } },
      },
    });
    if (!version) throw new NotFoundException('Plant profile version not found');
    if (version.status !== PlantProfileVersionStatus.DRAFT) throw new ConflictException('Only draft profile versions can be validated');
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
      profileConfig: version.profileConfig,
      stages: version.growthStages.map((stage) => ({
        code: stage.code, sequence: stage.sequence,
        minDurationDays: stage.minDurationDays, maxDurationDays: stage.maxDurationDays,
        transitionCriteria: stage.transitionCriteria,
        config: stage.parameterConfig?.config ?? {},
      })),
    });
    return this.prisma.$transaction(async (tx) => {
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
      const validated = await tx.plantProfileVersion.update({
        where: { id: version.id },
        data: { status: PlantProfileVersionStatus.VALIDATED, checksum, validatedAt: new Date(), validatedByUserId: actor.id },
      });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'PLANT_PROFILE_VERSION_VALIDATED', entityType: 'PlantProfileVersion', entityId: version.id, toChecksum: checksum },
      });
      return validated;
    });
  }

  async activateZone(zoneId: string, dto: ActivatePlantProfileDto, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, dto.organizationId, true);
    const zone = await this.prisma.zone.findFirst({
      where: { id: zoneId, deletedAt: null },
      select: { id: true, greenhouseId: true, greenhouse: { select: { organizationId: true } } },
    });
    if (!zone || zone.greenhouse.organizationId !== dto.organizationId) throw new NotFoundException('Zone not found in organization');
    const version = await this.prisma.plantProfileVersion.findFirst({
      where: { id: dto.plantProfileVersionId, organizationId: dto.organizationId, status: PlantProfileVersionStatus.VALIDATED },
      include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } },
    });
    if (!version) throw new UnprocessableEntityException('A validated plant profile version is required');
    const stage = await this.prisma.growthStage.findFirst({ where: { id: dto.growthStageId, plantProfileVersionId: version.id }, include: { parameterConfig: true } });
    if (!stage) throw new UnprocessableEntityException('Growth stage must belong to the selected profile version');
    const current = await this.prisma.zonePlantAssignment.findFirst({ where: { zoneId, status: ZonePlantAssignmentStatus.ACTIVE } });
    const schema = buildParameterObjectSchema(version.sourceCatalogVersion.parameterDefinitions);
    const effective = mergePlantConfig(
      (version.profileConfig as Record<string, unknown>),
      (stage.parameterConfig?.config ?? EMPTY_CONFIG) as Record<string, unknown>,
    );
    try {
      validatePlantLayer(effective, schema);
    } catch (error) {
      throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Effective zone configuration is invalid');
    }
    return this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.zonePlantAssignment.update({ where: { id: current.id }, data: { status: ZonePlantAssignmentStatus.ENDED, endedAt: new Date() } });
      }
      const assignment = await tx.zonePlantAssignment.create({
        data: {
          zoneId, greenhouseId: zone.greenhouseId, organizationId: dto.organizationId,
          plantProfileVersionId: version.id, growthStageId: stage.id,
          status: ZonePlantAssignmentStatus.ACTIVE, assignedByUserId: actor.id,
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
      return assignment;
    });
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

  async revokeAssignment(assignmentId: string, organizationId: string, actor: AuthenticatedUser) {
    await this.requireOrganization(actor.id, organizationId, true);
    const assignment = await this.prisma.zonePlantAssignment.findFirst({ where: { id: assignmentId, organizationId } });
    if (!assignment) throw new NotFoundException('Zone plant assignment not found');
    if (assignment.status !== ZonePlantAssignmentStatus.ACTIVE) return assignment;
    return this.prisma.$transaction(async (tx) => {
      const ended = await tx.zonePlantAssignment.update({ where: { id: assignmentId }, data: { status: ZonePlantAssignmentStatus.ENDED, endedAt: new Date() } });
      await tx.plantConfigAuditEvent.create({
        data: { actorUserId: actor.id, organizationId, action: 'ZONE_PLANT_DEACTIVATED', entityType: 'ZonePlantAssignment', entityId: assignmentId },
      });
      return ended;
    });
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

  private async getPublishedCatalogVersion(id: string) {
    const version = await this.prisma.plantCatalogVersion.findUnique({
      where: { id }, include: { parameterDefinitions: true },
    });
    if (!version || version.status !== PlantVersionStatus.PUBLISHED) throw new NotFoundException('Published plant catalog version not found');
    return version;
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
    version: { profileDefaults: unknown; stageTemplates: unknown },
    definitions: Array<{ parameterKey: string; valueSchema: unknown; metadataSchema?: unknown }>,
  ) {
    try {
      const schema = buildParameterObjectSchema(definitions);
      const partialSchema = buildParameterObjectSchema(definitions, { partial: true });
      const defaults = version.profileDefaults as Record<string, unknown>;
      validatePlantLayer(defaults, partialSchema);
      const templates = version.stageTemplates as unknown[];
      if (!templates.length) {
        validatePlantLayer(defaults, schema);
        return;
      }
      for (const [index, template] of templates.entries()) {
        if (!isRecord(template)) throw new Error(`Stage template ${index + 1} must be an object`);
        const config = template.config ?? EMPTY_CONFIG;
        if (!isRecord(config)) throw new Error('Stage template config must be an object');
        validatePlantLayer(config, partialSchema);
        validatePlantLayer(mergePlantConfig(defaults, config), schema);
      }
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
