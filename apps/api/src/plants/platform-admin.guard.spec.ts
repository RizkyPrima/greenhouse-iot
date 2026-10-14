import { ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

describe('PlatformAdminGuard', () => {
  const user = { id: 'platform-user', isActive: true } as AuthenticatedUser;
  const context = (currentUser: AuthenticatedUser) => ({
    switchToHttp: () => ({ getRequest: () => ({ user: currentUser }) }),
  }) as never;

  it('requires a separate active platform grant', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const guard = new PlatformAdminGuard({ platformAdminGrant: { findFirst } } as never);
    await expect(guard.canActivate(context(user))).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: user.id, permission: 'PLANT_CATALOG_ADMIN', revokedAt: null },
      select: { id: true },
    });
  });

  it('allows an active user with the platform grant without consulting tenant membership', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'grant-1' });
    const guard = new PlatformAdminGuard({ platformAdminGrant: { findFirst } } as never);
    await expect(guard.canActivate(context(user))).resolves.toBe(true);
  });
});
