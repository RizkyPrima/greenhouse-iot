import { describe, expect, it, vi } from 'vitest';
import { ResearchAdminGuard } from './research-admin.guard.js';

function context(user: unknown) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as never;
}

describe('ResearchAdminGuard', () => {
  it('requires a separate active research source grant', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'grant' });
    const guard = new ResearchAdminGuard({ platformAdminGrant: { findFirst } } as never);
    await expect(guard.canActivate(context({ id: 'u1', isActive: true }))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', permission: 'RESEARCH_SOURCE_ADMIN', revokedAt: null },
      select: { id: true },
    });
  });

  it('rejects inactive users and users with only a catalog grant', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const guard = new ResearchAdminGuard({ platformAdminGrant: { findFirst } } as never);
    await expect(guard.canActivate(context({ id: 'u1', isActive: false }))).rejects.toThrow();
    await expect(guard.canActivate(context({ id: 'u1', isActive: true }))).rejects.toThrow();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('does not authorize registry access after the research grant is revoked', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const guard = new ResearchAdminGuard({ platformAdminGrant: { findFirst } } as never);
    await expect(guard.canActivate(context({ id: 'u1', isActive: true }))).rejects.toThrow();
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', permission: 'RESEARCH_SOURCE_ADMIN', revokedAt: null },
      select: { id: true },
    });
  });
});
