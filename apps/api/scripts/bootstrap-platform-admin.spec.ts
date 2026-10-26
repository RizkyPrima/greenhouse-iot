import { PlatformPermission } from '@prisma/client';
import {
  assertOperatorCanReceiveBootstrap,
  assertOperatorIsActive,
  bootstrapResearchGrantAdmin,
  resolveTrustedOperatorIdentity,
  validateChangeReference,
} from './bootstrap-platform-admin.js';

const args = {
  environment: 'isolated-test',
  expectedDatabase: 'greenhouse_bootstrap_test',
  expectedServerAddress: '127.0.0.1',
  expectedServerPort: 5432,
  expectedDatabaseRole: 'test_role',
  userId: 'approved-user',
  changeReference: 'CHG-2026-1234',
  confirmation: 'BOOTSTRAP-RESEARCH-SOURCE-GRANT-ADMIN:["isolated-test","127.0.0.1",5432,"greenhouse_bootstrap_test","test_role","approved-user","CHG-2026-1234"]',
};

function harness(options: { identity?: object; user?: object | null; existing?: object | null; auditFails?: boolean } = {}) {
  let activeGrant: object | null = options.existing ?? null;
  let committed = false;
  let rolledBack = false;
  let lockQueue = Promise.resolve();
  const tx = {
    $queryRaw: vi.fn(async () => {
      let release!: () => void;
      const previous = lockQueue;
      lockQueue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      release();
      return [];
    }),
    user: { findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => options.user === undefined ? { id: where.id, isActive: true } : where.id === args.userId ? options.user : { id: where.id, isActive: true }) },
    platformAdminGrant: {
      findFirst: vi.fn(async () => activeGrant),
      create: vi.fn(async ({ data }: { data: object }) => {
        activeGrant = { id: 'grant-1', ...data };
        return { id: 'grant-1' };
      }),
    },
    plantConfigAuditEvent: {
      create: vi.fn(async () => {
        if (options.auditFails) throw new Error('audit failure');
        return { id: 'audit-1' };
      }),
    },
  };
  const client = {
    $queryRaw: vi.fn().mockResolvedValue([options.identity ?? { database: args.expectedDatabase, serverAddress: args.expectedServerAddress, serverPort: args.expectedServerPort, role: args.expectedDatabaseRole }]),
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
      const before = activeGrant;
      try {
        const result = await work(tx);
        committed = true;
        return result;
      } catch (error) {
        activeGrant = before;
        rolledBack = true;
        throw error;
      }
    }),
  };
  return { client, tx, get activeGrant() { return activeGrant; }, get committed() { return committed; }, get rolledBack() { return rolledBack; } };
}

describe('first platform admin bootstrap', () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeEach(() => { process.env.DATABASE_URL = `postgresql://test:test@127.0.0.1:${args.expectedServerPort}/greenhouse_bootstrap_test`; });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it('requires exact explicit target confirmation before database access', async () => {
    const h = harness();
    await expect(bootstrapResearchGrantAdmin(h.client as never, { ...args, confirmation: 'yes' }, 'operator-user')).rejects.toThrow('confirmation');
    expect(h.client.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['environment label', { environment: 'other-environment' }],
    ['server address', { expectedServerAddress: '192.0.2.8' }],
    ['server port', { expectedServerPort: 55432 }],
    ['database name', { expectedDatabase: 'other_database' }],
    ['database role', { expectedDatabaseRole: 'other_role' }],
    ['target user', { userId: 'other-user' }],
    ['change reference', { changeReference: 'CHG-2026-9999' }],
  ])('requires the confirmation to bind the %s', async (_field, changed) => {
    const h = harness();
    await expect(bootstrapResearchGrantAdmin(h.client as never, { ...args, ...changed }, 'operator-user')).rejects.toThrow('confirmation');
    expect(h.client.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an actual server port that differs from the approved port', async () => {
    const h = harness({ identity: { database: args.expectedDatabase, serverAddress: args.expectedServerAddress, serverPort: 55432, role: args.expectedDatabaseRole } });
    await expect(bootstrapResearchGrantAdmin(
      h.client as never,
      args,
      'operator-user',
      'postgresql://test:test@127.0.0.1:5432/greenhouse_bootstrap_test',
    )).rejects.toThrow('identity');
    expect(h.client.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a self-grant and permits a different operator ID in the transaction helper', () => {
    expect(() => assertOperatorCanReceiveBootstrap(args.userId, args.userId)).toThrow('Self-grant');
    expect(() => assertOperatorCanReceiveBootstrap(args.userId, 'different-operator')).not.toThrow();
  });

  it('rejects self-grant inside the transaction after acquiring the lock', async () => {
    const h = harness();
    const selfGrantArgs = {
      ...args,
      userId: 'operator-user',
      confirmation: 'BOOTSTRAP-RESEARCH-SOURCE-GRANT-ADMIN:["isolated-test","127.0.0.1",5432,"greenhouse_bootstrap_test","test_role","operator-user","CHG-2026-1234"]',
    };
    await expect(bootstrapResearchGrantAdmin(h.client as never, selfGrantArgs, 'operator-user')).rejects.toThrow('Self-grant');
    expect(h.client.$transaction).toHaveBeenCalledOnce();
    expect(h.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(h.tx.platformAdminGrant.create).not.toHaveBeenCalled();
  });

  it.each([null, '', '   ', 'invalid operator id'])('rejects missing or invalid verified operator identity (%s)', (operatorId) => {
    expect(() => assertOperatorCanReceiveBootstrap(args.userId, operatorId)).toThrow('Trusted operator identity');
  });

  it('does not treat application JWT environment values as bootstrap approval', () => {
    const previousSecret = process.env.JWT_SECRET;
    const previousAccessToken = process.env.BOOTSTRAP_OPERATOR_ACCESS_TOKEN;
    process.env.JWT_SECRET = 'test-only-app-signing-secret';
    process.env.BOOTSTRAP_OPERATOR_ACCESS_TOKEN = 'not-a-bootstrap-approval';
    try {
      expect(() => resolveTrustedOperatorIdentity()).toThrow('signer is unavailable');
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      if (previousAccessToken === undefined) delete process.env.BOOTSTRAP_OPERATOR_ACCESS_TOKEN;
      else process.env.BOOTSTRAP_OPERATOR_ACCESS_TOKEN = previousAccessToken;
    }
  });

  it('fails closed because no trusted bootstrap signer is configured', () => {
    expect(() => resolveTrustedOperatorIdentity()).toThrow('signer is unavailable');
    expect(() => resolveTrustedOperatorIdentity()).toThrow('deployment-blocked');
  });

  it('requires a non-empty, bounded, non-sensitive change reference format', async () => {
    expect(() => validateChangeReference('')).toThrow('Change reference');
    expect(() => validateChangeReference('ticket-2026-1')).toThrow('Change reference');
    expect(() => validateChangeReference(`CHG-${'A'.repeat(61)}`)).toThrow('Change reference');
    expect(() => validateChangeReference('CHG-2026-1234')).not.toThrow();
    expect(() => validateChangeReference(`CHG-A${'B'.repeat(59)}`)).not.toThrow();
    const h = harness();
    await expect(bootstrapResearchGrantAdmin(h.client as never, { ...args, changeReference: 'not-a-ticket' }, 'operator-user')).rejects.toThrow('Change reference');
    expect(h.client.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['database', { database: 'other_db', serverAddress: args.expectedServerAddress, role: args.expectedDatabaseRole }],
    ['server address', { database: args.expectedDatabase, serverAddress: '192.0.2.5', role: args.expectedDatabaseRole }],
    ['database role', { database: args.expectedDatabase, serverAddress: args.expectedServerAddress, role: 'other_role' }],
  ])('rejects a %s identity mismatch before opening a transaction', async (_field, identity) => {
    const h = harness({ identity });
    await expect(bootstrapResearchGrantAdmin(h.client as never, args, 'operator-user')).rejects.toThrow('identity');
    expect(h.client.$transaction).not.toHaveBeenCalled();
  });

  it('rejects missing and inactive users without creating grants', async () => {
    for (const user of [null, { id: args.userId, isActive: false }]) {
      const h = harness({ user });
      await expect(bootstrapResearchGrantAdmin(h.client as never, args, 'operator-user')).rejects.toThrow(user ? 'inactive' : 'not found');
      expect(h.tx.platformAdminGrant.create).not.toHaveBeenCalled();
    }
  });

  it('requires the verified operator account to remain active', async () => {
    const tx = { user: { findUnique: vi.fn().mockResolvedValue({ id: 'operator-user', isActive: false }) } };
    await expect(assertOperatorIsActive(tx as never, 'operator-user')).rejects.toThrow('unavailable or inactive');
  });

  it('rejects any existing active grant for the permission', async () => {
    const h = harness({ existing: { id: 'other-users-grant', userId: 'someone-else', permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN } });
    await expect(bootstrapResearchGrantAdmin(h.client as never, args, 'operator-user')).rejects.toThrow('already exists');
    expect(h.tx.platformAdminGrant.create).not.toHaveBeenCalled();
  });

  it('rolls back the grant if its audit insert fails', async () => {
    const h = harness({ auditFails: true });
    await expect(bootstrapResearchGrantAdmin(h.client as never, args, 'operator-user')).rejects.toThrow('audit failure');
    expect(h.rolledBack).toBe(true);
    expect(h.committed).toBe(false);
    expect(h.activeGrant).toBeNull();
  });

  it('creates only the requested permission and records its audit atomically', async () => {
    const h = harness();
    await expect(bootstrapResearchGrantAdmin(h.client as never, args, 'operator-user')).resolves.toMatchObject({ status: 'created', permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN });
    expect(h.tx.platformAdminGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: args.userId, permission: PlatformPermission.RESEARCH_SOURCE_GRANT_ADMIN, grantedByUserId: 'operator-user' }),
      select: { id: true },
    });
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'operator-user', action: 'RESEARCH_SOURCE_GRANT_ADMIN_BOOTSTRAPPED', entityType: 'PlatformAdminGrant', entityId: 'grant-1', details: expect.objectContaining({ recipientUserId: args.userId, changeReference: args.changeReference }) }) });
    expect(h.committed).toBe(true);
  });

  it('serializes concurrent bootstrap attempts so only one can create an active grant', async () => {
    let active: object | null = null;
    let transactionTail = Promise.resolve();
    const serial = async (work: () => Promise<unknown>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const before = active;
      try { return await work(); } catch (error) { active = before; throw error; } finally { release(); }
    };
    const clients = Array.from({ length: 2 }, () => {
      const h = harness();
      const tx = h.tx;
      tx.$queryRaw.mockResolvedValue([]);
      tx.platformAdminGrant.findFirst.mockImplementation(async () => active);
      tx.platformAdminGrant.create.mockImplementation(async ({ data }: { data: object }) => { active = { id: 'shared-grant', ...data }; return { id: 'shared-grant' }; });
      const client = {
        $queryRaw: h.client.$queryRaw,
        $transaction: (work: (inner: typeof tx) => Promise<unknown>) => serial(() => work(tx)),
      };
      return { h, client };
    });
    const results = await Promise.allSettled(clients.map(({ client }) => bootstrapResearchGrantAdmin(client as never, args, 'operator-user')));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
