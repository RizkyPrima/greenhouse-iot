import 'reflect-metadata';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PlantProfileVersionStatus, PlantVersionStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appConfig, databaseConfig } from '../src/config/app.config.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PlantsModule } from '../src/plants/plants.module.js';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter.js';

const PREFLIGHT = 'greenhouse-plants-test-pg-1023:16.15:tmpfs';
const JWT_SECRET_FOR_TESTS = 'phase1023-only-local-test-signing-secret-32';
const databaseUrl = process.env.PLANTS_E2E_DATABASE_URL;
if (!databaseUrl || process.env.PLANTS_E2E_PREFLIGHT_VERIFIED !== PREFLIGHT) {
  throw new Error('Run test/plants.integration.e2e-spec.ts only through scripts/run-plants-e2e.ps1 after disposable-target verification.');
}
const parsedDatabaseUrl = new URL(databaseUrl);
if (parsedDatabaseUrl.hostname !== '127.0.0.1'
  || parsedDatabaseUrl.port !== '55432'
  || parsedDatabaseUrl.pathname !== '/plants_phase1023_test'
  || parsedDatabaseUrl.username !== 'plants_test') {
  throw new Error('Plants HTTP integration tests require the dedicated loopback-only PostgreSQL target.');
}
// No .env is loaded by this harness. Prisma receives only the explicit disposable URL.
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = JWT_SECRET_FOR_TESTS;
process.env.NODE_ENV = 'test';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [appConfig, databaseConfig] }),
    AuthModule,
    PlantsModule,
  ],
})
class PlantsHttpIntegrationModule {}

describe('Plants API HTTP integration (isolated PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let tokenByUser: Record<string, string>;
  let ids: Record<string, string>;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const auth = (key: string) => ({ Authorization: `Bearer ${tokenByUser[key]}` });
  const userData = (key: string) => ({
    id: `plant-e2e-${key}-${runId}`,
    email: `${key}-${runId}@plant-e2e.invalid`,
    name: `Plant E2E ${key}`,
    passwordHash: 'not-used-by-this-http-test',
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [PlantsHttpIntegrationModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const users = Object.fromEntries(await Promise.all(
      ['platform', 'delegate', 'ownerA', 'adminA', 'operatorA', 'viewerA', 'ownerB'].map(async (key) => [
        key,
        await prisma.user.create({ data: userData(key) }),
      ]),
    )) as Record<string, { id: string }>;
    const organizationA = await prisma.organization.create({ data: { name: `Plant Test A ${runId}`, slug: `plant-test-a-${runId}` } });
    const organizationB = await prisma.organization.create({ data: { name: `Plant Test B ${runId}`, slug: `plant-test-b-${runId}` } });
    const memberships = [
      ['ownerA', organizationA.id, UserRole.OWNER],
      ['adminA', organizationA.id, UserRole.ADMIN],
      ['operatorA', organizationA.id, UserRole.OPERATOR],
      ['viewerA', organizationA.id, UserRole.VIEWER],
      ['ownerB', organizationB.id, UserRole.OWNER],
    ] as const;
    await Promise.all(memberships.map(([key, organizationId, role]) => prisma.organizationMembership.create({
      data: { userId: users[key].id, organizationId, role },
    })));
    const greenhouseA = await prisma.greenhouse.create({ data: { organizationId: organizationA.id, name: 'Greenhouse A', code: `GHA-${runId}`, timezone: 'Asia/Jakarta' } });
    const greenhouseB = await prisma.greenhouse.create({ data: { organizationId: organizationB.id, name: 'Greenhouse B', code: `GHB-${runId}`, timezone: 'Asia/Jakarta' } });
    const zoneA = await prisma.zone.create({ data: { greenhouseId: greenhouseA.id, name: 'Zone A', code: `ZA-${runId}` } });
    const zoneB = await prisma.zone.create({ data: { greenhouseId: greenhouseB.id, name: 'Zone B', code: `ZB-${runId}` } });

    const catalog = await prisma.plantCatalog.create({ data: { organizationId: organizationA.id, code: `plant-${runId}`, scientificName: 'Testus plantus', commonName: `Test Plant ${runId}` } });
    const catalogVersion = await prisma.plantCatalogVersion.create({
      data: {
        plantCatalogId: catalog.id,
        version: 1,
        status: PlantVersionStatus.DRAFT,
        configSchemaVersion: 'plant-config/v1',
        profileDefaults: { temperature: 20 },
        stageTemplates: [],
        checksum: `catalog-${runId}`,
        createdByUserId: users.platform.id,
        parameterDefinitions: { create: [{
          parameterKey: 'temperature',
          label: 'Temperature',
          dataType: 'number',
          unit: 'C',
          valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number', minimum: 0, maximum: 50 },
          metadataSchema: { required: true },
        }] },
      },
    });
    await prisma.plantCatalogVersion.update({
      where: { id: catalogVersion.id },
      data: { status: PlantVersionStatus.PUBLISHED, publishedByUserId: users.platform.id, publishedAt: new Date() },
    });

    const catalogB = await prisma.plantCatalog.create({ data: { organizationId: organizationB.id, code: `plant-b-${runId}`, scientificName: 'Testus plantus', commonName: `Test Plant B ${runId}` } });
    const catalogVersionB = await prisma.plantCatalogVersion.create({
      data: {
        plantCatalogId: catalogB.id, version: 1, status: PlantVersionStatus.PUBLISHED,
        configSchemaVersion: 'plant-config/v1', profileDefaults: { temperature: 20 }, stageTemplates: [],
        checksum: `catalog-b-${runId}`, createdByUserId: users.platform.id,
        publishedByUserId: users.platform.id, publishedAt: new Date(),
        parameterDefinitions: { create: [{
          parameterKey: 'temperature', label: 'Temperature', dataType: 'number', unit: 'C',
          valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number', minimum: 0, maximum: 50 },
          metadataSchema: { required: true },
        }] },
      },
    });

    const profileA = await seedProfile(organizationA.id, users.ownerA.id, 'a', catalog.id, catalogVersion.id);
    const profileB = await seedProfile(organizationB.id, users.ownerB.id, 'b', catalogB.id, catalogVersionB.id);
    const assignmentB = await prisma.zonePlantAssignment.create({
      data: {
        zoneId: zoneB.id,
        greenhouseId: greenhouseB.id,
        organizationId: organizationB.id,
        plantProfileVersionId: profileB.validVersionId,
        growthStageId: profileB.validStageId,
        assignedByUserId: users.ownerB.id,
      },
    });
    const overrideB = await prisma.zoneParameterOverride.create({
      data: {
        assignmentId: assignmentB.id,
        revision: 1,
        overrideConfig: { temperature: 24 },
        configSchemaVersion: 'plant-config/v1',
        checksum: `override-${runId}`,
        createdByUserId: users.ownerB.id,
      },
    });

    tokenByUser = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([key, user]) => [
      key,
      await jwt.signAsync({ sub: user.id, type: 'access' }, { secret: JWT_SECRET_FOR_TESTS, expiresIn: '1h' }),
    ])));
    ids = {
      orgA: organizationA.id, orgB: organizationB.id,
      catalog: catalog.id, catalogVersion: catalogVersion.id,
      profileA: profileA.profileId, validVersionA: profileA.validVersionId, draftVersionA: profileA.draftVersionId,
      validStageA: profileA.validStageId, draftStageA: profileA.draftStageId,
      profileB: profileB.profileId, validVersionB: profileB.validVersionId, validStageB: profileB.validStageId,
      zoneA: zoneA.id, zoneB: zoneB.id, assignmentB: assignmentB.id, overrideB: overrideB.id,
      greenhouseA: greenhouseA.id,
    };

    async function seedProfile(organizationId: string, userId: string, key: string, plantCatalogId: string, sourceCatalogVersionId: string) {
      const profile = await prisma.plantProfile.create({
        data: { organizationId, plantCatalogId, code: `profile-${key}-${runId}`, name: `Profile ${key}`, createdByUserId: userId },
      });
      const validVersion = await prisma.plantProfileVersion.create({
        data: {
          plantProfileId: profile.id, organizationId, plantCatalogId, version: 1,
          sourceCatalogVersionId, status: PlantProfileVersionStatus.DRAFT,
          configSchemaVersion: 'plant-config/v1', profileConfig: { temperature: 22 },
          createdByUserId: userId,
        },
      });
      const validStage = await prisma.growthStage.create({ data: {
        plantProfileVersionId: validVersion.id, code: 'vegetative', label: 'Vegetative', sequence: 1,
        parameterConfig: { create: { config: { temperature: 23 }, configSchemaVersion: 'plant-config/v1', checksum: `stage-${key}-${runId}` } },
      } });
      await prisma.plantProfileVersion.update({
        where: { id: validVersion.id },
        data: {
          status: PlantProfileVersionStatus.VALIDATED,
          checksum: `profile-${key}-${runId}`,
          validatedByUserId: userId,
          validatedAt: new Date(),
        },
      });
      const draftVersion = await prisma.plantProfileVersion.create({
        data: {
          plantProfileId: profile.id, organizationId, plantCatalogId, version: 2,
          sourceCatalogVersionId, adoptedFromVersionId: validVersion.id,
          status: PlantProfileVersionStatus.DRAFT, configSchemaVersion: 'plant-config/v1',
          profileConfig: { temperature: 21 }, createdByUserId: userId,
        },
      });
      const draftStage = await prisma.growthStage.create({ data: {
        plantProfileVersionId: draftVersion.id, code: 'seedling', label: 'Seedling', sequence: 1,
        parameterConfig: { create: { config: { temperature: 21 }, configSchemaVersion: 'plant-config/v1' } },
      } });
      return { profileId: profile.id, validVersionId: validVersion.id, validStageId: validStage.id, draftVersionId: draftVersion.id, draftStageId: draftStage.id };
    }
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication and organization membership for tenant reads', async () => {
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgA}/plant-profiles`).expect(401);
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgA}/plant-profiles`).set(auth('platform')).expect(403);
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgA}/plant-profiles/${ids.profileA}`).set(auth('viewerA')).expect(200);
  });

  it('enforces OWNER/ADMIN write allow-lists while members retain read access', async () => {
    const body = {
      catalogVersionId: ids.catalogVersion, code: `created-${runId}`, name: 'Created by admin',
      profileConfig: { temperature: 22 }, stages: [{ code: 'seedling', label: 'Seedling', sequence: 1, config: { temperature: 24 } }],
    };
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-profiles`).set(auth('operatorA')).send(body).expect(403);
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-profiles`).set(auth('viewerA')).send(body).expect(403);
    const created = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-profiles`).set(auth('adminA')).send(body).expect(201);
    expect(await prisma.plantProfile.findUnique({ where: { id: created.body.id } })).not.toBeNull();
    expect(await prisma.plantConfigAuditEvent.count({ where: { organizationId: ids.orgA, entityId: created.body.id, action: 'PLANT_PROFILE_CREATED' } })).toBe(1);
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgA}/plant-config-audit`).set(auth('viewerA')).expect(403);
  });

  it('blocks cross-tenant profile, stage, assignment, override, effective-config, and audit access', async () => {
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgB}/plant-profiles`).set(auth('ownerA')).expect(403);
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgA}/plant-profiles/${ids.profileB}`).set(auth('ownerA')).expect(404);
    await request(app.getHttpServer()).patch(`/api/organizations/${ids.orgA}/plant-profile-versions/${ids.validVersionB}/draft`).set(auth('ownerA')).send({ profileConfig: { temperature: 30 } }).expect(404);
    await request(app.getHttpServer()).patch(`/api/organizations/${ids.orgA}/growth-stages/${ids.validStageB}`).set(auth('ownerA')).send({ label: 'Changed' }).expect(404);
    await request(app.getHttpServer()).post(`/api/plant-assignments/${ids.assignmentB}/overrides`).set(auth('ownerA')).send({ overrideConfig: { temperature: 30 } }).expect(403);
    await request(app.getHttpServer()).get(`/api/plant-assignments/${ids.assignmentB}/effective-config`).set(auth('ownerA')).expect(403);
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-assignments/${ids.assignmentB}/deactivate`).set(auth('ownerA')).expect(404);
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgB}/plant-config-audit`).set(auth('ownerA')).expect(403);
    expect((await prisma.zonePlantAssignment.findUnique({ where: { id: ids.assignmentB } }))?.status).toBe('ACTIVE');
    expect(await prisma.zoneParameterOverride.count({ where: { assignmentId: ids.assignmentB } })).toBe(1);
  });

  it('lets organization owners manage only their own catalogs, independently of platform grants', async () => {
    const created = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog`).set(auth('ownerA'))
      .send({ code: `tenant-${runId}`, scientificName: 'Tenant plant', commonName: 'Tenant Plant' }).expect(201);
    await request(app.getHttpServer()).get(`/api/organizations/${ids.orgB}/plant-catalog/${created.body.id}`).set(auth('ownerB')).expect(404);
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog`).set(auth('platform'))
      .send({ code: `no-membership-${runId}`, scientificName: 'No membership', commonName: 'Denied' }).expect(403);
  });

  it('supports draft parameter PATCH/DELETE, rejects invalid schemas and protects referenced keys', async () => {
    const catalog = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog`).set(auth('ownerA')).send({ code: `params-${runId}`, scientificName: 'Parameter test', commonName: 'Parameter test' }).expect(201);
    const draft = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog/${catalog.body.id}/versions`).set(auth('ownerA')).send({ profileDefaults: {}, stageTemplates: [] }).expect(201);
    const parameterDto = {
      parameterKey: 'nutrientLevel', label: 'Nutrient level', dataType: 'number', unit: 'ppm',
      valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number', minimum: 0, maximum: 100 },
      metadataSchema: { required: false },
    };
    const parameter = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog/versions/${draft.body.id}/parameters`).set(auth('ownerA')).send(parameterDto).expect(201);
    await request(app.getHttpServer()).patch(`/api/organizations/${ids.orgA}/plant-catalog/versions/${draft.body.id}/parameters/${parameter.body.id}`).set(auth('ownerA')).send({ label: 'Nutrient ppm' }).expect(200);
    expect((await prisma.plantParameterDefinition.findUnique({ where: { id: parameter.body.id } }))?.label).toBe('Nutrient ppm');
    await request(app.getHttpServer()).delete(`/api/organizations/${ids.orgA}/plant-catalog/versions/${draft.body.id}/parameters/${parameter.body.id}`).set(auth('ownerA')).expect(200);
    expect(await prisma.plantParameterDefinition.findUnique({ where: { id: parameter.body.id } })).toBeNull();
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog/versions/${draft.body.id}/parameters`).set(auth('ownerA')).send({ ...parameterDto, parameterKey: 'badKey', valueSchema: { type: 'number' } }).expect(422);

    const dependentDraft = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog/${catalog.body.id}/versions`).set(auth('ownerA')).send({ profileDefaults: { nutrientLevel: 20 }, stageTemplates: [] }).expect(201);
    const dependent = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog/versions/${dependentDraft.body.id}/parameters`).set(auth('ownerA')).send(parameterDto).expect(201);
    await request(app.getHttpServer()).delete(`/api/organizations/${ids.orgA}/plant-catalog/versions/${dependentDraft.body.id}/parameters/${dependent.body.id}`).set(auth('ownerA')).expect(409);
    expect(await prisma.plantParameterDefinition.findUnique({ where: { id: dependent.body.id } })).not.toBeNull();
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-catalog/versions/${ids.catalogVersion}/parameters`).set(auth('ownerA')).send(parameterDto).expect(409);
  });

  it('protects validated profile versions and published catalog versions from draft edits', async () => {
    await request(app.getHttpServer()).patch(`/api/organizations/${ids.orgA}/plant-profile-versions/${ids.validVersionA}/draft`).set(auth('ownerA')).send({ profileConfig: { temperature: 30 } }).expect(409);
    await request(app.getHttpServer()).patch(`/api/organizations/${ids.orgA}/plant-catalog/versions/${ids.catalogVersion}/draft`).set(auth('ownerA')).send({ profileDefaults: { temperature: 30 } }).expect(409);
    const definition = await prisma.plantParameterDefinition.findFirst({ where: { plantCatalogVersionId: ids.catalogVersion } });
    if (definition) await request(app.getHttpServer()).delete(`/api/organizations/${ids.orgA}/plant-catalog/versions/${ids.catalogVersion}/parameters/${definition.id}`).set(auth('ownerA')).expect(409);
  });

  it('validates draft configuration, rejects invalid activation, and persists valid activation/override/audit changes', async () => {
    await request(app.getHttpServer()).post(`/api/zones/${ids.zoneA}/plant-assignments`).set(auth('ownerA')).send({ organizationId: ids.orgA, plantProfileVersionId: ids.draftVersionA, growthStageId: ids.draftStageA }).expect(422);
    await request(app.getHttpServer()).post(`/api/zones/${ids.zoneB}/plant-assignments`).set(auth('ownerA')).send({ organizationId: ids.orgA, plantProfileVersionId: ids.validVersionA, growthStageId: ids.validStageA }).expect(404);
    await request(app.getHttpServer()).post(`/api/zones/${ids.zoneA}/plant-assignments`).set(auth('ownerA')).send({ organizationId: ids.orgA, plantProfileVersionId: ids.validVersionA, growthStageId: ids.validStageB }).expect(422);

    const invalidDraft = await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-profiles`).set(auth('ownerA')).send({
      catalogVersionId: ids.catalogVersion, code: `invalid-${runId}`, name: 'Invalid config', profileConfig: { temperature: 200 },
      stages: [{ code: 'stage', label: 'Stage', sequence: 1, config: { temperature: 22 } }],
    }).expect(201);
    const invalidVersion = invalidDraft.body.versions[0];
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-profile-versions/${invalidVersion.id}/validate`).set(auth('ownerA')).expect(422);
    expect((await prisma.plantProfileVersion.findUnique({ where: { id: invalidVersion.id } }))?.status).toBe('DRAFT');

    const activated = await request(app.getHttpServer()).post(`/api/zones/${ids.zoneA}/plant-assignments`).set(auth('ownerA')).send({ organizationId: ids.orgA, plantProfileVersionId: ids.validVersionA, growthStageId: ids.validStageA }).expect(201);
    expect((await prisma.zonePlantAssignment.findUnique({ where: { id: activated.body.id } }))?.status).toBe('ACTIVE');
    await request(app.getHttpServer()).post(`/api/plant-assignments/${activated.body.id}/overrides`).set(auth('ownerA')).send({ overrideConfig: { temperature: -1 } }).expect(422);
    const override = await request(app.getHttpServer()).post(`/api/plant-assignments/${activated.body.id}/overrides`).set(auth('ownerA')).send({ overrideConfig: { temperature: 30 } }).expect(201);
    expect(await prisma.zoneParameterOverride.findUnique({ where: { id: override.body.id } })).toMatchObject({ revision: 1, supersededAt: null });
    await request(app.getHttpServer()).post(`/api/organizations/${ids.orgA}/plant-assignments/${activated.body.id}/deactivate`).set(auth('ownerA')).expect(201);
    expect((await prisma.zonePlantAssignment.findUnique({ where: { id: activated.body.id } }))?.status).toBe('ENDED');
    expect(await prisma.plantConfigAuditEvent.count({ where: { organizationId: ids.orgA, entityId: activated.body.id } })).toBeGreaterThanOrEqual(2);
  });
});

