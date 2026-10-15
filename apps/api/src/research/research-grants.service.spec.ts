import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlatformPermission } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ResearchGrantsService } from './research-grants.service.js';

const actor = { id: 'manager-1', isActive: true } as AuthenticatedUser;
const activeGrant = {
  id: 'research-grant-1',
  userId: 'research-user-1',
  permission: PlatformPermission.RESEARCH_SOURCE_ADMIN,
  grantedByUserId: actor.id,
  grantedAt: new Date('2026-10-15T00:00:00.000Z'),
  revokedAt: null,
};

function harness(options: {
  recipientActive?: boolean;
  existingGrant?: {
    id: string;
    userId: string;
    permission: PlatformPermission;
    grantedByUserId: string;
    grantedAt: Date;
    revokedAt: Date | null;
  } | null;
  createError?: unknown;
  auditError?: unknown;
} = {}) {
  const createdGrant = { ...activeGrant };
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue(options.recipientActive === false ? { id: 'research-user-1', isActive: false } : { id: 'research-user-1', isActive: true }) },
    platformAdminGrant: {
      create: options.createError
        ? vi.fn().mockRejectedValue(options.createError)
        : vi.fn().mockResolvedValue(createdGrant),
      findUnique: vi.fn().mockResolvedValue(options.existingGrant === undefined ? activeGrant : options.existingGrant),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    plantConfigAuditEvent: {
      create: options.auditError
        ? vi.fn().mockRejectedValue(options.auditError)
        : vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
  let commits = 0;
  let rollbacks = 0;
  const transaction = vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    try {
      const result = await callback(tx);
      commits += 1;
      return result;
    } catch (error) {
      rollbacks += 1;
      throw error;
    }
  });
  const service = new ResearchGrantsService({ $transaction: transaction } as never);
  return { service, tx, transaction, get commits() { return commits; }, get rollbacks() { return rollbacks; } };
}

describe('ResearchGrantsService', () => {
  it('creates a research-only grant and writes its actor/recipient/action audit in the transaction', async () => {
    const h = harness();
    await expect(h.service.create('research-user-1', actor)).resolves.toMatchObject({
      id: activeGrant.id,
      userId: 'research-user-1',
      permission: 'RESEARCH_SOURCE_ADMIN',
      grantedByUserId: actor.id,
    });
    expect(h.tx.platformAdminGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'research-user-1',
        permission: 'RESEARCH_SOURCE_ADMIN',
        grantedByUserId: actor.id,
        grantedAt: expect.any(Date),
      }),
    });
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        action: 'RESEARCH_SOURCE_GRANT_CREATED',
        entityType: 'PlatformAdminGrant',
        entityId: activeGrant.id,
        details: expect.objectContaining({ recipientUserId: 'research-user-1', permission: 'RESEARCH_SOURCE_ADMIN' }),
        createdAt: expect.any(Date),
      }),
    });
    expect(h.commits).toBe(1);
  });

  it('rejects self-grant before opening a transaction', async () => {
    const h = harness();
    await expect(h.service.create(actor.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive recipients', async () => {
    const h = harness({ recipientActive: false });
    await expect(h.service.create('research-user-1', actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.tx.platformAdminGrant.create).not.toHaveBeenCalled();
    expect(h.tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
  });

  it('returns a conflict when the active-grant unique constraint rejects a duplicate', async () => {
    const h = harness({ createError: { code: 'P2002' } });
    await expect(h.service.create('research-user-1', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
    expect(h.rollbacks).toBe(1);
  });

  it('revokes an active grant by setting revokedAt and writes an audit event', async () => {
    const h = harness();
    const result = await h.service.revoke(activeGrant.id, actor);
    expect(h.tx.platformAdminGrant.updateMany).toHaveBeenCalledWith({
      where: { id: activeGrant.id, permission: 'RESEARCH_SOURCE_ADMIN', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toMatchObject({ id: activeGrant.id, revokedAt: expect.any(Date) });
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        action: 'RESEARCH_SOURCE_GRANT_REVOKED',
        entityId: activeGrant.id,
        details: expect.objectContaining({ recipientUserId: activeGrant.userId, permission: 'RESEARCH_SOURCE_ADMIN' }),
        createdAt: expect.any(Date),
      }),
    });
  });

  it('makes repeated revocation idempotent without another update or audit event', async () => {
    const revoked = { ...activeGrant, revokedAt: new Date('2026-10-15T01:00:00.000Z') };
    const h = harness({ existingGrant: revoked });
    await expect(h.service.revoke(activeGrant.id, actor)).resolves.toEqual(revoked);
    expect(h.tx.platformAdminGrant.updateMany).not.toHaveBeenCalled();
    expect(h.tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
  });

  it('does not expose or revoke a grant of another permission', async () => {
    const catalogGrant = { ...activeGrant, permission: PlatformPermission.PLANT_CATALOG_ADMIN };
    const h = harness({ existingGrant: catalogGrant });
    await expect(h.service.revoke(activeGrant.id, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.tx.platformAdminGrant.updateMany).not.toHaveBeenCalled();
    expect(h.tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a grant when its audit insert fails within the transaction', async () => {
    const h = harness({ auditError: new Error('audit insert failed') });
    await expect(h.service.create('research-user-1', actor)).rejects.toThrow('audit insert failed');
    expect(h.tx.platformAdminGrant.create).toHaveBeenCalledOnce();
    expect(h.rollbacks).toBe(1);
    expect(h.commits).toBe(0);
  });

  it('rejects a revocation when its audit insert fails within the transaction', async () => {
    const h = harness({ auditError: new Error('audit insert failed') });
    await expect(h.service.revoke(activeGrant.id, actor)).rejects.toThrow('audit insert failed');
    expect(h.tx.platformAdminGrant.updateMany).toHaveBeenCalledOnce();
    expect(h.rollbacks).toBe(1);
    expect(h.commits).toBe(0);
  });

  it('uses the database unique constraint to resolve concurrent grant requests', async () => {
    let active = false;
    const h = harness();
    h.tx.platformAdminGrant.create.mockImplementation(async () => {
      if (active) throw { code: 'P2002' };
      active = true;
      return { ...activeGrant };
    });

    const results = await Promise.allSettled([
      h.service.create('research-user-1', actor),
      h.service.create('research-user-1', actor),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({ reason: expect.any(ConflictException) });
  });
});
