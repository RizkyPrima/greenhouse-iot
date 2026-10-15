import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ResearchGrantAdminGuard } from './research-grant-admin.guard.js';

function context(user?: unknown, headers: Record<string, string> = {}) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  } as never;
}

describe('ResearchGrantAdminGuard', () => {
  it('rejects a request without authentication at the global JWT guard', async () => {
    const jwtGuard = new JwtAuthGuard(
      { getAllAndOverride: () => false } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(jwtGuard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects missing management grant, including catalog-only and tenant-role users', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const guard = new ResearchGrantAdminGuard({ platformAdminGrant: { findFirst } } as never);

    await expect(guard.canActivate(context({ id: 'catalog-admin', isActive: true, role: 'OWNER' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context({ id: 'tenant-admin', isActive: true, role: 'ADMIN' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'catalog-admin', permission: 'RESEARCH_SOURCE_GRANT_ADMIN', revokedAt: null },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'tenant-admin', permission: 'RESEARCH_SOURCE_GRANT_ADMIN', revokedAt: null },
      select: { id: true },
    });
  });

  it('allows only an active user with an active research grant-management permission', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'manager-grant' });
    const guard = new ResearchGrantAdminGuard({ platformAdminGrant: { findFirst } } as never);

    await expect(guard.canActivate(context({ id: 'manager', isActive: true }))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'manager', permission: 'RESEARCH_SOURCE_GRANT_ADMIN', revokedAt: null },
      select: { id: true },
    });
    await expect(guard.canActivate(context({ id: 'inactive', isActive: false }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
