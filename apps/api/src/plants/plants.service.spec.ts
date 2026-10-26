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

describe('PlantsService organization catalog access', () => {
  const owner = { ...actor, role: UserRole.OWNER } as AuthenticatedUser;

  it('creates a catalog owned by the selected organization and records its audit event', async () => {
    const catalog = { id: 'catalog-a', organizationId: 'org-a' };
    const tx = {
      plantCatalog: { create: vi.fn().mockResolvedValue(catalog) },
      plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new PlantsService(
      { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      { getMembership: vi.fn().mockResolvedValue({ role: UserRole.OWNER }), organizationExists: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.createCatalog('org-a', { code: 'Basil', scientificName: 'Ocimum basilicum', commonName: 'Basil' }, owner))
      .resolves.toEqual(catalog);
    expect(tx.plantCatalog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', code: 'basil' }) }));
    expect(tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', action: 'CATALOG_CREATED' }) }));
  });

  it('rejects non-owner/admin catalog creation before writing', async () => {
    const create = vi.fn();
    const service = new PlantsService(
      { $transaction: vi.fn(), plantCatalog: { create } } as never,
      { getMembership: vi.fn().mockResolvedValue({ role: UserRole.VIEWER }), organizationExists: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.createCatalog('org-a', { code: 'basil', scientificName: 'Ocimum basilicum', commonName: 'Basil' }, owner))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('scopes catalog listing and draft visibility to the selected organization', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new PlantsService(
      { plantCatalog: { findMany } } as never,
      { getMembership: vi.fn().mockResolvedValue({ role: UserRole.OWNER }), organizationExists: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.listCatalogForOrganization('org-a', owner)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a' } }));
  });

  it('does not query catalogs if the caller is not an organization member', async () => {
    const findMany = vi.fn();
    const service = new PlantsService(
      { plantCatalog: { findMany } } as never,
      { getMembership: vi.fn().mockRejectedValue(new ForbiddenException()), organizationExists: vi.fn() } as never,
    );

    await expect(service.listCatalogForOrganization('org-b', owner)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('PlantsService zone assignment reads', () => {
  const actor = { id: 'member-a' } as AuthenticatedUser;

  it('scopes assignment history to the selected zone and its owning organization', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'assignment-a', status: 'ACTIVE', overrides: [] }]);
    const service = new PlantsService(
      { zonePlantAssignment: { findMany } } as never,
      {
        zoneOrganizationId: vi.fn().mockResolvedValue('org-a'),
        getMembership: vi.fn().mockResolvedValue({ role: UserRole.VIEWER }),
        organizationExists: vi.fn().mockResolvedValue(true),
      } as never,
    );

    await expect(service.listZoneAssignments('zone-a', actor)).resolves.toMatchObject([{ id: 'assignment-a' }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { zoneId: 'zone-a', organizationId: 'org-a' } }));
  });

  it('does not query assignment history when the user is not a member of the zone organization', async () => {
    const findMany = vi.fn();
    const service = new PlantsService(
      { zonePlantAssignment: { findMany } } as never,
      {
        zoneOrganizationId: vi.fn().mockResolvedValue('org-b'),
        getMembership: vi.fn().mockRejectedValue(new ForbiddenException()),
        organizationExists: vi.fn(),
      } as never,
    );

    await expect(service.listZoneAssignments('zone-b', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
