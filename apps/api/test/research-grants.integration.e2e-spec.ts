import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter.js';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ResearchGrantAdminGuard } from '../src/research/research-grant-admin.guard.js';
import { ResearchGrantsController } from '../src/research/research-grants.controller.js';
import { ResearchGrantsService } from '../src/research/research-grants.service.js';

const DATABASE_URL_ENV = 'RESEARCH_GRANTS_E2E_DATABASE_URL';
const PREFLIGHT_ENV = 'RESEARCH_GRANTS_E2E_PREFLIGHT_TOKEN';
const PREFLIGHT_TOKEN = 'research-grants-e2e:postgres16:127.0.0.1:55432:disposable-only';
const TEST_JWT_SECRET = 'research-grants-e2e-only-signing-secret-32-chars';
const DATABASE_URL = requireDedicatedDatabaseUrl();
const API_PATH = '/api/platform/research-source-grants';
const REQUIRED_MIGRATIONS = [
  '20261014100000_phase10_1_plant_standardization',
  '20261015090000_phase10_4_2_research_registry',
  '20261015130000_phase10_4_2h_research_grant_admin',
];

function requireDedicatedDatabaseUrl(): string {
  const value = process.env[DATABASE_URL_ENV];
  if (!value || process.env[PREFLIGHT_ENV] !== PREFLIGHT_TOKEN) {
    throw new Error(
      `Refusing Research Grants e2e setup. Set ${DATABASE_URL_ENV} and separately verify the disposable target with ${PREFLIGHT_ENV}.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${DATABASE_URL_ENV} is not a valid PostgreSQL URL.`);
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const username = decodeURIComponent(parsed.username);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.hostname !== '127.0.0.1'
    || parsed.port !== '55432'
    || databaseName !== 'research_test'
    || username !== 'research_test'
    || !parsed.password
  ) {
    throw new Error(
      `${DATABASE_URL_ENV} must target PostgreSQL database research_test as user research_test at 127.0.0.1:55432.`,
    );
  }
  return value;
}

const testConfigService = {
  getOrThrow(key: string): string {
    if (key !== 'JWT_SECRET') throw new Error(`Unexpected test configuration key: ${key}`);
    return TEST_JWT_SECRET;
  },
};

@Module({
  imports: [JwtModule.register({ secret: TEST_JWT_SECRET })],
  controllers: [ResearchGrantsController],
  providers: [
    {
      provide: PrismaService,
      useFactory: () => new PrismaService({
        datasources: { db: { url: DATABASE_URL } },
        log: [],
      }),
    },
    { provide: ConfigService, useValue: testConfigService },
    { provide: Reflector, useValue: new Reflector() },
    ResearchGrantsService,
    ResearchGrantAdminGuard,
    JwtAuthGuard,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
class ResearchGrantsHttpIntegrationModule {}

describe('Research grant management HTTP integration (isolated PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let actor: { id: string; email: string };
  let recipient: { id: string; email: string };
  let actorToken: string;
  const testUserIds = new Set<string>();
  const testOrganizationIds = new Set<string>();

  async function createUser(label: string, isActive = true) {
    const id = `research-grants-e2e-${label}-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        id,
        email: `${id}@research-grants.invalid`,
        name: `Research grants test ${label}`,
        passwordHash: 'not-used-by-this-http-test',
        isActive,
      },
      select: { id: true, email: true },
    });
    testUserIds.add(user.id);
    return user;
  }

  async function issueToken(userId: string): Promise<string> {
    return jwt.signAsync({ sub: userId, type: 'access' }, { expiresIn: '10m' });
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createGrant() {
    return request(app.getHttpServer())
      .post(API_PATH)
      .set(auth(actorToken))
      .send({ userId: recipient.id })
      .expect(201);
  }

  async function withAuditInsertFailure<T>(action: string, run: () => Promise<T>): Promise<T> {
    const suffix = randomUUID().replaceAll('-', '');
    const triggerName = `rg_audit_fail_${suffix}`;
    const functionName = `rg_audit_fail_fn_${suffix}`;
    const actorIdLiteral = `'${actor.id.replaceAll("'", "''")}'`;
    const actionLiteral = `'${action.replaceAll("'", "''")}'`;
    let functionCreated = false;
    let triggerCreated = false;

    try {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION public."${functionName}"() RETURNS trigger
        LANGUAGE plpgsql AS $research_test$
        BEGIN
          IF NEW."actorUserId" = ${actorIdLiteral} AND NEW."action" = ${actionLiteral} THEN
            RAISE EXCEPTION 'intentional research grant audit insert failure';
          END IF;
          RETURN NEW;
        END;
        $research_test$
      `);
      functionCreated = true;
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON public."plant_config_audit_events"
        FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()
      `);
      triggerCreated = true;
      return await run();
    } finally {
      if (triggerCreated) {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON public."plant_config_audit_events"`,
        );
      }
      if (functionCreated) {
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${functionName}"()`);
      }
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ResearchGrantsHttpIntegrationModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const identity = await prisma.$queryRaw<Array<{
      database_name: string;
      database_user: string;
      server_version_num: number;
    }>>`
      SELECT current_database() AS database_name,
             current_user AS database_user,
             current_setting('server_version_num')::integer AS server_version_num
    `;
    const database = identity[0];
    if (
      database?.database_name !== 'research_test'
      || database.database_user !== 'research_test'
      || database.server_version_num < 160000
      || database.server_version_num >= 170000
    ) {
      throw new Error('Connected database identity does not match the verified PostgreSQL 16 research_test target.');
    }

    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM public."_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const applied = new Set(migrations.map((migration) => migration.migration_name));
    const missing = REQUIRED_MIGRATIONS.filter((name) => !applied.has(name));
    if (missing.length > 0) {
      throw new Error(`The disposable target is missing prerequisite migrations: ${missing.join(', ')}. No migration was run by this harness.`);
    }
  }, 30_000);

  beforeEach(async () => {
    actor = await createUser('grant-admin');
    recipient = await createUser('recipient');
    await prisma.platformAdminGrant.create({
      data: {
        userId: actor.id,
        permission: 'RESEARCH_SOURCE_GRANT_ADMIN',
        grantedByUserId: null,
      },
    });
    actorToken = await issueToken(actor.id);
  });

  afterEach(async () => {
    const ids = [...testUserIds];
    const organizationIds = [...testOrganizationIds];
    if (!prisma || ids.length === 0) return;

    await prisma.platformAdminGrant.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { grantedByUserId: { in: ids } }] },
    });
    if (organizationIds.length > 0) {
      await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }

    for (const userId of ids) {
      const immutableAuditCount = await prisma.plantConfigAuditEvent.count({ where: { actorUserId: userId } });
      if (immutableAuditCount === 0) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    }
    testUserIds.clear();
    testOrganizationIds.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication and a dedicated grant-management permission', async () => {
    await request(app.getHttpServer()).post(API_PATH).send({ userId: recipient.id }).expect(401);

    const catalogOnly = await createUser('catalog-only');
    await prisma.platformAdminGrant.create({
      data: { userId: catalogOnly.id, permission: 'PLANT_CATALOG_ADMIN' },
    });
    await request(app.getHttpServer())
      .post(API_PATH)
      .set(auth(await issueToken(catalogOnly.id)))
      .send({ userId: recipient.id })
      .expect(403);

    const tenantOwner = await createUser('tenant-owner');
    const organization = await prisma.organization.create({
      data: { name: `Research grant test ${randomUUID()}`, slug: `research-grant-${randomUUID()}` },
      select: { id: true },
    });
    testOrganizationIds.add(organization.id);
    await prisma.organizationMembership.create({
      data: { userId: tenantOwner.id, organizationId: organization.id, role: UserRole.OWNER },
    });
    await request(app.getHttpServer())
      .post(API_PATH)
      .set(auth(await issueToken(tenantOwner.id)))
      .send({ userId: recipient.id })
      .expect(403);
  });

  it('creates and persists a research grant with its audit event', async () => {
    const response = await createGrant();
    const grant = await prisma.platformAdminGrant.findUnique({ where: { id: response.body.id } });
    expect(grant).toMatchObject({
      userId: recipient.id,
      permission: 'RESEARCH_SOURCE_ADMIN',
      grantedByUserId: actor.id,
      revokedAt: null,
    });
    const audit = await prisma.plantConfigAuditEvent.findFirst({
      where: { entityId: response.body.id, action: 'RESEARCH_SOURCE_GRANT_CREATED' },
    });
    expect(audit).toMatchObject({ actorUserId: actor.id, entityType: 'PlatformAdminGrant' });
    expect(audit?.details).toMatchObject({ recipientUserId: recipient.id, permission: 'RESEARCH_SOURCE_ADMIN' });
  });

  it('rejects self-grant and inactive recipients without persisting a grant', async () => {
    await request(app.getHttpServer()).post(API_PATH).set(auth(actorToken)).send({ userId: actor.id }).expect(403);
    await prisma.user.update({ where: { id: recipient.id }, data: { isActive: false } });
    await request(app.getHttpServer()).post(API_PATH).set(auth(actorToken)).send({ userId: recipient.id }).expect(404);
    expect(await prisma.platformAdminGrant.count({
      where: { userId: recipient.id, permission: 'RESEARCH_SOURCE_ADMIN', revokedAt: null },
    })).toBe(0);
  });

  it('returns conflict for a duplicate active grant', async () => {
    await createGrant();
    await request(app.getHttpServer()).post(API_PATH).set(auth(actorToken)).send({ userId: recipient.id }).expect(409);
    expect(await prisma.platformAdminGrant.count({
      where: { userId: recipient.id, permission: 'RESEARCH_SOURCE_ADMIN', revokedAt: null },
    })).toBe(1);
  });

  it('revokes a grant, persists its audit, and keeps repeated revoke idempotent', async () => {
    const created = await createGrant();
    const route = `${API_PATH}/${created.body.id}/revoke`;
    await request(app.getHttpServer()).patch(route).set(auth(actorToken)).expect(200);
    const revoked = await prisma.platformAdminGrant.findUnique({ where: { id: created.body.id } });
    expect(revoked?.revokedAt).toBeInstanceOf(Date);

    await request(app.getHttpServer()).patch(route).set(auth(actorToken)).expect(200);
    expect(await prisma.plantConfigAuditEvent.count({
      where: { entityId: created.body.id, action: 'RESEARCH_SOURCE_GRANT_REVOKED' },
    })).toBe(1);
  });

  it('rolls back grant creation when the real PostgreSQL audit insert fails', async () => {
    await withAuditInsertFailure('RESEARCH_SOURCE_GRANT_CREATED', async () => {
      await request(app.getHttpServer())
        .post(API_PATH)
        .set(auth(actorToken))
        .send({ userId: recipient.id })
        .expect(500);
    });

    expect(await prisma.platformAdminGrant.count({
      where: { userId: recipient.id, permission: 'RESEARCH_SOURCE_ADMIN', revokedAt: null },
    })).toBe(0);
    expect(await prisma.plantConfigAuditEvent.count({
      where: { actorUserId: actor.id, action: 'RESEARCH_SOURCE_GRANT_CREATED' },
    })).toBe(0);
  });

  it('rolls back grant revocation when the real PostgreSQL audit insert fails', async () => {
    const created = await createGrant();
    await withAuditInsertFailure('RESEARCH_SOURCE_GRANT_REVOKED', async () => {
      await request(app.getHttpServer())
        .patch(`${API_PATH}/${created.body.id}/revoke`)
        .set(auth(actorToken))
        .expect(500);
    });

    const grant = await prisma.platformAdminGrant.findUnique({ where: { id: created.body.id } });
    expect(grant?.revokedAt).toBeNull();
    expect(await prisma.plantConfigAuditEvent.count({
      where: { entityId: created.body.id, action: 'RESEARCH_SOURCE_GRANT_REVOKED' },
    })).toBe(0);
  });

  it('resolves concurrent grant creation through the PostgreSQL active-grant constraint', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer()).post(API_PATH).set(auth(actorToken)).send({ userId: recipient.id }),
      request(app.getHttpServer()).post(API_PATH).set(auth(actorToken)).send({ userId: recipient.id }),
    ]);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(await prisma.platformAdminGrant.count({
      where: { userId: recipient.id, permission: 'RESEARCH_SOURCE_ADMIN', revokedAt: null },
    })).toBe(1);
    expect(await prisma.plantConfigAuditEvent.count({
      where: { actorUserId: actor.id, action: 'RESEARCH_SOURCE_GRANT_CREATED' },
    })).toBe(1);
  });

  it('handles concurrent revoke requests with one persisted revoke audit', async () => {
    const created = await createGrant();
    const route = `${API_PATH}/${created.body.id}/revoke`;
    const responses = await Promise.all([
      request(app.getHttpServer()).patch(route).set(auth(actorToken)),
      request(app.getHttpServer()).patch(route).set(auth(actorToken)),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect((await prisma.platformAdminGrant.findUnique({ where: { id: created.body.id } }))?.revokedAt).toBeInstanceOf(Date);
    expect(await prisma.plantConfigAuditEvent.count({
      where: { entityId: created.body.id, action: 'RESEARCH_SOURCE_GRANT_REVOKED' },
    })).toBe(1);
  });
});
