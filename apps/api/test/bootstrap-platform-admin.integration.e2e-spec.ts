import { randomUUID } from 'node:crypto';
import { PlatformPermission, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapResearchGrantAdmin } from '../scripts/bootstrap-platform-admin.js';

const DATABASE_URL_ENV = 'BOOTSTRAP_TEST_DATABASE_URL';
const PREFLIGHT_ENV = 'BOOTSTRAP_TEST_PREFLIGHT';
const SERVER_ADDRESS_ENV = 'BOOTSTRAP_TEST_SERVER_ADDRESS';
const PREFLIGHT_TOKEN = 'bootstrap-platform-admin:postgres16:127.0.0.1:55432:plants_phase1023_test:plants_test:disposable-only';
const REQUIRED_MIGRATIONS = [
  '20261001064817_init_phase_4_greenhouse',
  '20261001073359_add_phase5_telemetry',
  '20261002032900_add_phase6_auth_users_memberships',
  '20261012120000_complete_control_command_audit',
  '20261014100000_phase10_1_plant_standardization',
  '20261015090000_phase10_4_2_research_registry',
  '20261015130000_phase10_4_2h_research_grant_admin',
];

let prisma: PrismaClient | undefined;
let databaseUrl = '';
let expectedServerAddress = '';
let operatorUserId = '';
const fixtureUserIds = new Set<string>();
const createdTriggerNames: string[] = [];

// This suite exercises transaction behavior with fixture identities only. It does not
// prove or replace the trusted signer required by the operator CLI, which stays blocked.

function targetConfirmation(args: {
  environment: string;
  expectedServerAddress: string;
  expectedServerPort: number;
  expectedDatabase: string;
  expectedDatabaseRole: string;
  userId: string;
  changeReference: string;
}): string {
  return `BOOTSTRAP-RESEARCH-SOURCE-GRANT-ADMIN:${JSON.stringify([
    args.environment,
    args.expectedServerAddress,
    args.expectedServerPort,
    args.expectedDatabase,
    args.expectedDatabaseRole,
    args.userId,
    args.changeReference,
  ])}`;
}

function requireDisposableTarget(): { url: string; host: string; port: string; database: string; role: string; serverAddress: string } {
  const urlValue = process.env[DATABASE_URL_ENV];
  const serverAddress = process.env[SERVER_ADDRESS_ENV];
  if (!urlValue || process.env[PREFLIGHT_ENV] !== PREFLIGHT_TOKEN || !serverAddress) {
    throw new Error(`Refusing bootstrap integration tests. Require ${DATABASE_URL_ENV}, ${SERVER_ADDRESS_ENV}, and the exact disposable ${PREFLIGHT_ENV} marker; this suite never reads .env.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error(`${DATABASE_URL_ENV} is not a valid PostgreSQL URL.`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const role = decodeURIComponent(parsed.username);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.hostname !== '127.0.0.1'
    || parsed.port !== '55432'
    || database !== 'plants_phase1023_test'
    || role !== 'plants_test'
    || !parsed.password
    || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(serverAddress)
  ) {
    throw new Error(`${DATABASE_URL_ENV} must target the dedicated loopback PostgreSQL disposable database plants_phase1023_test as plants_test at 127.0.0.1:55432, with its independently verified server address.`);
  }
  return { url: urlValue, host: parsed.hostname, port: parsed.port, database, role, serverAddress };
}

function argsFor(userId: string) {
  const environment = 'disposable-test'; // Descriptive label only; the connection identity is checked separately.
  const expectedDatabase = 'plants_phase1023_test';
  const expectedServerPort = 5432;
  const changeReference = `CHG-TEST-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  return {
    environment,
    expectedDatabase,
    expectedServerAddress,
    expectedServerPort,
    expectedDatabaseRole: 'plants_test',
    userId,
    changeReference,
    confirmation: targetConfirmation({ environment, expectedServerAddress, expectedServerPort, expectedDatabase, expectedDatabaseRole: 'plants_test', userId, changeReference }),
  };
}

async function createFixtureUser(): Promise<string> {
  const id = `bootstrap-test-${randomUUID().replaceAll('-', '')}`;
  await prisma!.user.create({
    data: {
      id,
      email: `${id}@example.invalid`,
      passwordHash: 'test-fixture-not-a-credential',
      name: 'Disposable bootstrap integration fixture',
      isActive: true,
    },
  });
  fixtureUserIds.add(id);
  return id;
}

async function createAuditFailureTrigger(): Promise<{ trigger: string; fn: string }> {
  const suffix = randomUUID().replaceAll('-', '');
  const trigger = `bootstrap_audit_fail_${suffix}`;
  const fn = `bootstrap_audit_fail_fn_${suffix}`;
  if (!/^[a-z0-9_]+$/.test(trigger) || !/^[a-z0-9_]+$/.test(fn)) throw new Error('Generated disposable trigger identifier is invalid');

  await prisma!.$executeRawUnsafe(`
    CREATE FUNCTION public."${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."action" = 'RESEARCH_SOURCE_GRANT_ADMIN_BOOTSTRAPPED'
         AND NEW."details" ->> 'recipientUserId' LIKE 'bootstrap-test-%' THEN
        RAISE EXCEPTION 'intentional disposable bootstrap audit failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  try {
    await prisma!.$executeRawUnsafe(`
      CREATE TRIGGER "${trigger}"
      BEFORE INSERT ON public."plant_config_audit_events"
      FOR EACH ROW EXECUTE FUNCTION public."${fn}"()
    `);
    createdTriggerNames.push(trigger, fn);
  } catch (error) {
    await prisma!.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${fn}"()`);
    throw error;
  }
  return { trigger, fn };
}

async function dropAuditFailureTrigger(trigger: string, fn: string): Promise<void> {
  await prisma!.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON public."plant_config_audit_events"`);
  await prisma!.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${fn}"()`);
  const triggerIndex = createdTriggerNames.indexOf(trigger);
  if (triggerIndex >= 0) createdTriggerNames.splice(triggerIndex, 1);
  const functionIndex = createdTriggerNames.indexOf(fn);
  if (functionIndex >= 0) createdTriggerNames.splice(functionIndex, 1);
}

describe('first platform admin bootstrap (verified disposable PostgreSQL)', () => {
  beforeAll(async () => {
    const target = requireDisposableTarget();
    databaseUrl = target.url;
    expectedServerAddress = target.serverAddress;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
    await prisma.$connect();

    const identity = await prisma.$queryRaw<Array<{
      database: string;
      role: string;
      serverAddress: string | null;
      serverVersion: number;
    }>>`
      SELECT current_database() AS "database",
             current_user AS "role",
             inet_server_addr()::text AS "serverAddress",
             current_setting('server_version_num')::integer AS "serverVersion"
    `;
    const actual = identity[0];
    if (
      actual?.database !== target.database
      || actual.role !== target.role
      || actual.serverAddress !== target.serverAddress
      || actual.serverVersion < 160000
      || actual.serverVersion >= 170000
    ) {
      throw new Error('Actual PostgreSQL identity does not match the independently verified disposable PostgreSQL 16 target.');
    }

    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM public."_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const applied = new Set(migrations.map((row) => row.migration_name));
    const missing = REQUIRED_MIGRATIONS.filter((name) => !applied.has(name));
    if (missing.length) throw new Error(`Disposable database is missing required migrations: ${missing.join(', ')}. No migration is run by this suite.`);

    const activeBootstrapGrants = await prisma.platformAdminGrant.count({
      where: { permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN, revokedAt: null },
    });
    if (activeBootstrapGrants !== 0) throw new Error('Disposable database already contains an active bootstrap permission grant; refusing to run fixtures.');

    operatorUserId = await createFixtureUser();

  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    try {
      for (let index = createdTriggerNames.length - 2; index >= 0; index -= 2) {
        const trigger = createdTriggerNames[index];
        const fn = createdTriggerNames[index + 1];
        await dropAuditFailureTrigger(trigger, fn);
      }
      if (fixtureUserIds.size) {
        const grants = await prisma.platformAdminGrant.findMany({ where: { userId: { in: [...fixtureUserIds] } }, select: { id: true } });
        const grantIds = grants.map((grant) => grant.id);
        if (grantIds.length) {
          await prisma.plantConfigAuditEvent.deleteMany({ where: { entityId: { in: grantIds } } });
          await prisma.platformAdminGrant.deleteMany({ where: { id: { in: grantIds } } });
        }
        await prisma.user.deleteMany({ where: { id: { in: [...fixtureUserIds] } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects wrong database, server address, server port, and role before creating any grant', async () => {
    const userId = await createFixtureUser();
    const args = argsFor(userId);
    const wrongDatabase = { ...args, expectedDatabase: 'wrong_database' };
    wrongDatabase.confirmation = targetConfirmation(wrongDatabase);
    const wrongAddress = { ...args, expectedServerAddress: '192.0.2.123' };
    wrongAddress.confirmation = targetConfirmation(wrongAddress);
    const wrongPort = { ...args, expectedServerPort: 5433 };
    wrongPort.confirmation = targetConfirmation(wrongPort);
    const wrongRole = { ...args, expectedDatabaseRole: 'wrong_role' };
    wrongRole.confirmation = targetConfirmation(wrongRole);
    await expect(bootstrapResearchGrantAdmin(prisma!, wrongDatabase, operatorUserId, databaseUrl)).rejects.toThrow('Configured database name');
    await expect(bootstrapResearchGrantAdmin(prisma!, wrongAddress, operatorUserId, databaseUrl)).rejects.toThrow('identity');
    await expect(bootstrapResearchGrantAdmin(prisma!, wrongPort, operatorUserId, databaseUrl)).rejects.toThrow('identity');
    await expect(bootstrapResearchGrantAdmin(prisma!, wrongRole, operatorUserId, databaseUrl)).rejects.toThrow('identity');
    expect(await prisma!.platformAdminGrant.count({ where: { userId } })).toBe(0);
  });

  it('rejects self-grant after entering the locked transaction, without writing grant or audit', async () => {
    const args = argsFor(operatorUserId);
    await expect(bootstrapResearchGrantAdmin(prisma!, args, operatorUserId, databaseUrl)).rejects.toThrow('Self-grant');
    expect(await prisma!.platformAdminGrant.count({
      where: { userId: operatorUserId, permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN },
    })).toBe(0);
    expect(await prisma!.plantConfigAuditEvent.count({
      where: { actorUserId: operatorUserId, action: 'RESEARCH_SOURCE_GRANT_ADMIN_BOOTSTRAPPED' },
    })).toBe(0);
  });

  it('serializes two actual concurrent bootstrap transactions through the PostgreSQL advisory lock', async () => {
    const userId = await createFixtureUser();
    const args = argsFor(userId);
    const secondConnection = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
    await secondConnection.$connect();
    try {
      const [first, second] = await Promise.allSettled([
        bootstrapResearchGrantAdmin(prisma!, args, operatorUserId, databaseUrl),
        bootstrapResearchGrantAdmin(secondConnection, args, operatorUserId, databaseUrl),
      ]);
      expect([first, second].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect([first, second].filter((result) => result.status === 'rejected')).toHaveLength(1);
      const grants = await prisma!.platformAdminGrant.findMany({ where: { userId, permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN, revokedAt: null } });
      expect(grants).toHaveLength(1);
      expect(grants[0].grantedByUserId).toBe(operatorUserId);
      const audits = await prisma!.plantConfigAuditEvent.findMany({
        where: { entityId: grants[0].id, action: 'RESEARCH_SOURCE_GRANT_ADMIN_BOOTSTRAPPED' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].actorUserId).toBe(operatorUserId);
      expect(audits[0].details).toMatchObject({ recipientUserId: userId, permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN });
      await prisma!.plantConfigAuditEvent.deleteMany({ where: { entityId: grants[0].id } });
      await prisma!.platformAdminGrant.deleteMany({ where: { id: grants[0].id } });
    } finally {
      await secondConnection.$disconnect();
    }
  });

  it('holds the transaction advisory lock across two real PostgreSQL connections until commit', async () => {
    const secondConnection = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
    await secondConnection.$connect();
    let signalAcquired!: () => void;
    let releaseFirst!: () => void;
    const acquired = new Promise<void>((resolve) => { signalAcquired = resolve; });
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    try {
      const firstTransaction = prisma!.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(731904210, 1042)`;
        signalAcquired();
        await holdFirst;
      });
      await acquired;

      let secondAcquired = false;
      const secondTransaction = secondConnection.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(731904210, 1042)`;
        secondAcquired = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const secondWasBlocked = !secondAcquired;
      releaseFirst();
      await Promise.all([firstTransaction, secondTransaction]);
      expect(secondWasBlocked).toBe(true);
      expect(secondAcquired).toBe(true);
    } finally {
      releaseFirst?.();
      await secondConnection.$disconnect();
    }
  });

  it('rolls back the grant on real PostgreSQL when its audit insert fails', async () => {
    const userId = await createFixtureUser();
    const { trigger, fn } = await createAuditFailureTrigger();
    try {
      await expect(bootstrapResearchGrantAdmin(prisma!, argsFor(userId), operatorUserId, databaseUrl)).rejects.toThrow();
      expect(await prisma!.platformAdminGrant.count({
        where: { userId, permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN, revokedAt: null },
      })).toBe(0);
      const audits = await prisma!.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM public."plant_config_audit_events"
        WHERE action = 'RESEARCH_SOURCE_GRANT_ADMIN_BOOTSTRAPPED'
          AND details ->> 'recipientUserId' = ${userId}
      `;
      expect(Number(audits[0].count)).toBe(0);
    } finally {
      await dropAuditFailureTrigger(trigger, fn);
    }
  });
});
