import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PlantsService } from './plants.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

describe('PlantsService tenant access', () => {
  const actor = {
    id: 'user-1', email: 'person@example.test', name: 'Person', isActive: true,
    organizationId: 'org-a', membershipId: 'membership-a', role: UserRole.VIEWER,
    memberships: [], organization: null, membership: null,
  } as unknown as AuthenticatedUser;

  it('scopes profile queries to the organization whose membership was checked', async () => {
    const getMembership = vi.fn().mockResolvedValue({ organizationId: 'org-a', role: UserRole.VIEWER });
    const organizationExists = vi.fn().mockResolvedValue(true);
    const findMany = vi.fn().mockResolvedValue([{ id: 'profile-a', organizationId: 'org-a' }]);
    const service = new PlantsService(
      { plantProfile: { findMany } } as never,
      { getMembership, organizationExists } as never,
    );

    await expect(service.listProfiles('org-a', actor)).resolves.toEqual([{ id: 'profile-a', organizationId: 'org-a' }]);
    expect(getMembership).toHaveBeenCalledWith(actor.id, 'org-a');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', status: 'ACTIVE' } }));
  });

  it('does not query another tenant after membership authorization fails', async () => {
    const findMany = vi.fn();
    const service = new PlantsService(
      { plantProfile: { findMany } } as never,
      {
        getMembership: vi.fn().mockRejectedValue(new ForbiddenException()),
        organizationExists: vi.fn(),
      } as never,
    );

    await expect(service.listProfiles('org-other', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects self-grant before looking up or writing a platform grant', async () => {
    const userFindUnique = vi.fn();
    const transaction = vi.fn();
    const service = new PlantsService(
      { user: { findUnique: userFindUnique }, $transaction: transaction } as never,
      {} as never,
    );

    await expect(service.createPlatformGrant(actor.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not edit a validated profile version', async () => {
    const update = vi.fn();
    const transaction = vi.fn();
    const service = new PlantsService(
      { plantProfileVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'version-1', status: 'VALIDATED' }) }, $transaction: transaction } as never,
      { getMembership: vi.fn().mockResolvedValue({ role: UserRole.ADMIN }), organizationExists: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.updateProfileDraft('org-a', 'version-1', { profileConfig: { humidity: 65 } }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('PlantsService platform catalog reads', () => {
  it('includes unpublished catalogs and every version for guarded admin listing', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new PlantsService({ plantCatalog: { findMany } } as never, {} as never);

    await expect(service.listCatalogForAdmin()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      include: { versions: { orderBy: { version: 'desc' }, include: { parameterDefinitions: true } } },
      orderBy: { commonName: 'asc' },
    });
  });

  it('loads the requested catalog including drafts for guarded admin detail', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'catalog-1', versions: [{ status: 'DRAFT' }] });
    const service = new PlantsService({ plantCatalog: { findUnique } } as never, {} as never);

    await expect(service.getCatalogForAdmin('catalog-1')).resolves.toMatchObject({ id: 'catalog-1' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'catalog-1' },
      include: { versions: { orderBy: { version: 'desc' }, include: { parameterDefinitions: true } } },
    });
  });
});
