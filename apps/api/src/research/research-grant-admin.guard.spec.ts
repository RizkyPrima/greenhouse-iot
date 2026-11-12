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

  it('allows an active organization owner without a separate platform grant', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'owner-membership' });
    const guard = new ResearchGrantAdminGuard({ organizationMembership: { findFirst } } as never);

    await expect(guard.canActivate(context({ id: 'owner', isActive: true }))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'owner', role: 'OWNER', organization: { deletedAt: null } },
      select: { id: true },
    });
  });

  it('rejects users without an owner membership and inactive users', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const guard = new ResearchGrantAdminGuard({ organizationMembership: { findFirst } } as never);

    await expect(guard.canActivate(context({ id: 'admin', isActive: true, role: 'ADMIN' }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledTimes(1);
    await expect(guard.canActivate(context({ id: 'inactive', isActive: false }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it.each(['OPERATOR', 'VIEWER'])('rejects an active %s without an owner membership', async (role) => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const guard = new ResearchGrantAdminGuard({ organizationMembership: { findFirst } } as never);

    await expect(guard.canActivate(context({ id: role.toLowerCase(), isActive: true, role }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: role.toLowerCase(), role: 'OWNER', organization: { deletedAt: null } },
      select: { id: true },
    });
  });
});
