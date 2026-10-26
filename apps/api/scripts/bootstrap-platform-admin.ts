import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient, PlatformPermission } from '@prisma/client';

export type BootstrapArgs = {
  environment: string;
  expectedDatabase: string;
  expectedServerAddress: string;
  expectedServerPort: number;
  expectedDatabaseRole: string;
  userId: string;
  changeReference: string;
  confirmation: string;
};

type BootstrapClient = Pick<PrismaClient, '$queryRaw' | '$transaction'>;
type BootstrapTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const permission = PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN;
const CHANGE_REFERENCE_PATTERN = /^(?:CHG|CHANGE|APPROVAL|RFC|SEC)-[A-Z0-9][A-Z0-9-]{1,59}$/i;
const confirmationFor = (args: Pick<BootstrapArgs, 'environment' | 'expectedServerAddress' | 'expectedServerPort' | 'expectedDatabase' | 'expectedDatabaseRole' | 'userId' | 'changeReference'>) =>
  `BOOTSTRAP-RESEARCH-SOURCE-GRANT-ADMIN:${JSON.stringify([
    args.environment,
    args.expectedServerAddress,
    args.expectedServerPort,
    args.expectedDatabase,
    args.expectedDatabaseRole,
    args.userId,
    args.changeReference,
  ])}`;

function readArgs(argv: string[]): BootstrapArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--') || values.has(key)) {
      throw new Error('Invalid or duplicate command-line argument');
    }
    values.set(key, value);
    index += 1;
  }
  const get = (key: string) => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing required argument ${key}`);
    return value;
  };
  const allowed = new Set(['--environment', '--expected-database', '--expected-server-address', '--expected-server-port', '--expected-database-role', '--user-id', '--change-reference', '--confirm']);
  if ([...values.keys()].some((key) => !allowed.has(key))) throw new Error('Unknown command-line argument');
  const rawPort = get('--expected-server-port');
  if (!/^\d+$/.test(rawPort)) throw new Error('Expected server port must be an integer between 1 and 65535');
  const expectedServerPort = Number(rawPort);
  if (!Number.isInteger(expectedServerPort) || expectedServerPort < 1 || expectedServerPort > 65535) {
    throw new Error('Expected server port must be an integer between 1 and 65535');
  }
  return {
    environment: get('--environment'),
    expectedDatabase: get('--expected-database'),
    expectedServerAddress: get('--expected-server-address'),
    expectedServerPort,
    expectedDatabaseRole: get('--expected-database-role'),
    userId: get('--user-id'),
    changeReference: get('--change-reference'),
    confirmation: get('--confirm'),
  };
}

export function assertOperatorCanReceiveBootstrap(targetUserId: string, operatorUserId: string | null | undefined): void {
  if (typeof operatorUserId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(operatorUserId)) {
    throw new Error('Trusted operator identity is unavailable or invalid');
  }
  if (operatorUserId === targetUserId) throw new Error('Self-grant is prohibited');
}

/** No trusted bootstrap signer is configured; app JWTs are not approval evidence. */
export function resolveTrustedOperatorIdentity(): never {
  throw new Error('Trusted bootstrap signer is unavailable; platform admin bootstrap is deployment-blocked');
}

export async function assertOperatorIsActive(tx: BootstrapTransaction, operatorUserId: string): Promise<void> {
  const operator = await tx.user.findUnique({ where: { id: operatorUserId }, select: { id: true, isActive: true } });
  if (!operator?.isActive) throw new Error('Trusted operator identity is unavailable or inactive');
}

export function validateChangeReference(value: string): void {
  if (typeof value !== 'string' || value.length > 64 || !CHANGE_REFERENCE_PATTERN.test(value)) {
    throw new Error('Change reference must be a non-sensitive ticket ID such as CHG-2026-1234 (6–64 characters)');
  }
}

export async function bootstrapResearchGrantAdmin(client: BootstrapClient, args: BootstrapArgs, operatorUserId: string, connectionUrl = process.env.DATABASE_URL) {
  validateChangeReference(args.changeReference);
  if (args.confirmation !== confirmationFor(args)) throw new Error('Explicit target confirmation does not match');

  if (!connectionUrl) throw new Error('DATABASE_URL is required');
  let configuredUrl: URL;
  try {
    configuredUrl = new URL(connectionUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(configuredUrl.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  if (decodeURIComponent(configuredUrl.pathname.slice(1)) !== args.expectedDatabase) {
    throw new Error('Configured database name does not match the approved target');
  }
  const identity = await client.$queryRaw<Array<{ database: string; serverAddress: string | null; serverPort: number; role: string }>>`
    SELECT current_database() AS "database",
           inet_server_addr()::text AS "serverAddress",
           inet_server_port() AS "serverPort",
           current_user AS "role"
  `;
  const actual = identity[0];
  if (!actual || actual.database !== args.expectedDatabase || actual.serverAddress !== args.expectedServerAddress || actual.serverPort !== args.expectedServerPort || actual.role !== args.expectedDatabaseRole) {
    throw new Error('Connected database identity does not match the approved target');
  }

  return client.$transaction(async (tx) => {
    // One stable transaction-scoped lock serializes every invocation of this bootstrap.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(731904210, 1042)`;

    await assertOperatorIsActive(tx, operatorUserId);
    assertOperatorCanReceiveBootstrap(args.userId, operatorUserId);

    const target = await tx.user.findUnique({ where: { id: args.userId }, select: { id: true, isActive: true } });
    if (!target) throw new Error('Target user was not found');
    if (!target.isActive) throw new Error('Target user is inactive');

    const existing = await tx.platformAdminGrant.findFirst({
      where: { permission, revokedAt: null },
      select: { id: true },
    });
    if (existing) throw new Error('An active grant already exists; bootstrap is one-time and will not replace it');

    const now = new Date();
    const grant = await tx.platformAdminGrant.create({
      data: { userId: target.id, permission, grantedByUserId: operatorUserId, grantedAt: now },
      select: { id: true },
    });
    await tx.plantConfigAuditEvent.create({
      data: {
        actorUserId: operatorUserId,
        action: 'RESEARCH_SOURCE_GRANT_ADMIN_BOOTSTRAPPED',
        entityType: 'PlatformAdminGrant',
        entityId: grant.id,
        details: {
          permission,
          recipientUserId: target.id,
          environment: args.environment,
          changeReference: args.changeReference,
          bootstrapId: randomUUID(),
        },
        createdAt: now,
      },
    });
    return { status: 'created' as const, permission, grantId: grant.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function main() {
  let prisma: PrismaClient | undefined;
  try {
    const args = readArgs(process.argv.slice(2));
    if (args.confirmation !== confirmationFor(args)) throw new Error('Explicit target confirmation does not match');
    const operatorUserId = resolveTrustedOperatorIdentity();
    prisma = new PrismaClient();
    const result = await bootstrapResearchGrantAdmin(prisma, args, operatorUserId);
    console.log(JSON.stringify(result));
  } catch (error) {
    const expectedMessages = new Set([
      'Invalid or duplicate command-line argument', 'Unknown command-line argument', 'DATABASE_URL is required',
      'DATABASE_URL is not a valid PostgreSQL URL', 'DATABASE_URL must use PostgreSQL',
      'Configured database name does not match the approved target', 'Connected database identity does not match the approved target',
      'Expected server port must be an integer between 1 and 65535',
      'Trusted bootstrap signer is unavailable; platform admin bootstrap is deployment-blocked',
      'Trusted operator identity is unavailable or invalid', 'Trusted operator identity is unavailable or inactive', 'Self-grant is prohibited',
      'Target user was not found', 'Target user is inactive',
      'An active grant already exists; bootstrap is one-time and will not replace it',
      'Explicit target confirmation does not match',
      'Change reference must be a non-sensitive ticket ID such as CHG-2026-1234 (6–64 characters)',
    ]);
    const message = error instanceof Error && expectedMessages.has(error.message) ? error.message : 'Bootstrap failed; inspect database and application audit logs without sharing credentials';
    console.error(JSON.stringify({ status: 'failed', reason: message }));
    process.exitCode = 1;
  } finally {
    try {
      await prisma?.$disconnect();
    } catch {
      console.error(JSON.stringify({ status: 'failed', reason: 'Database client shutdown failed' }));
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
