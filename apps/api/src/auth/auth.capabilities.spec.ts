import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

describe('current-user platform capabilities', () => {
  const createService = (findFirst: ReturnType<typeof vi.fn>) => new AuthService(
    { platformAdminGrant: { findFirst } } as never,
    {} as never,
    {} as never,
  );

  it('returns the plant catalog capability for a user with an active grant', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'grant-id' });
    const service = createService(findFirst);

    await expect(service.capabilities('user-id')).resolves.toEqual({
      data: { capabilities: { plantCatalogAdmin: true } },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-id', permission: 'PLANT_CATALOG_ADMIN', revokedAt: null },
      select: { id: true },
    });
  });

  it('returns false when the user has no grant', async () => {
    const service = createService(vi.fn().mockResolvedValue(null));
    await expect(service.capabilities('user-id')).resolves.toEqual({
      data: { capabilities: { plantCatalogAdmin: false } },
    });
  });

  it('returns false for a revoked grant by querying only non-revoked grants', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = createService(findFirst);

    await expect(service.capabilities('user-id')).resolves.toEqual({
      data: { capabilities: { plantCatalogAdmin: false } },
    });
    expect(findFirst.mock.calls[0][0].where.revokedAt).toBeNull();
  });

  it('requires authentication before the capabilities handler can run', async () => {
    const guard = new JwtAuthGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as never;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
