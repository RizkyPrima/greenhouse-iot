import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PlatformPermission, UserRole } from '@prisma/client';
import { PlantsService } from './plants.service.js';
import { configChecksum } from './plant-config.js';
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
    const tx = {
      plantProfileVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({ status: 'VALIDATED', draftRevision: 1 }),
      },
    };
    const transaction = vi.fn((work: (client: typeof tx) => unknown) => work(tx));
    const service = new PlantsService(
      { $transaction: transaction } as never,
      { getMembership: vi.fn().mockResolvedValue({ role: UserRole.ADMIN }), organizationExists: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.updateProfileDraft('org-a', 'version-1', { expectedRevision: 1, profileConfig: { humidity: 65 } }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.plantProfileVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'version-1', organizationId: 'org-a', status: 'DRAFT', draftRevision: 1 }),
    }));
  });
});

describe('PlantsService catalog parameters and publishing', () => {
  const owner = {
    id: 'owner-a', email: 'owner@example.test', name: 'Owner', isActive: true,
    organizationId: 'org-a', membershipId: 'membership-a', role: UserRole.OWNER,
    memberships: [], organization: null, membership: null,
  } as unknown as AuthenticatedUser;
  const authorization = {
    getMembership: vi.fn().mockResolvedValue({ organizationId: 'org-a', role: UserRole.OWNER }),
    organizationExists: vi.fn().mockResolvedValue(true),
  };

  it('creates a typed catalog parameter with an explicit unit and schema without inventing limits', async () => {
    const definition = { id: 'parameter-a', parameterKey: 'air_temperature' };
    const tx = {
      plantParameterDefinition: { create: vi.fn().mockResolvedValue(definition) },
      plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
    };
    const prisma = {
      plantCatalogVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: 'catalog-version-a' }),
        findUnique: vi.fn().mockResolvedValue({ id: 'catalog-version-a', status: 'DRAFT' }),
      },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const service = new PlantsService(prisma as never, authorization as never);
    const result = await service.createParameterDefinition('org-a', 'catalog-version-a', {
      parameterKey: 'air_temperature',
      label: 'Suhu udara',
      dataType: 'number',
      unit: '°C',
      valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' },
    }, owner);
    expect(result).toEqual(definition);
    expect(tx.plantParameterDefinition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ parameterKey: 'air_temperature', dataType: 'number', unit: '°C', valueSchema: expect.objectContaining({ type: 'number' }) }),
    }));
    expect(tx.plantConfigAuditEvent.create).toHaveBeenCalled();
  });

  it('publishes a valid draft and rejects an invalid draft before any publish write', async () => {
    const validVersion = {
      id: 'catalog-version-a', version: 2, status: 'DRAFT', configSchemaVersion: 'plant-config/v1',
      profileDefaults: {}, stageTemplates: [],
      edgeCompatibility: { mode: 'monitoring_only', controller: 'ESP32-S3', schema_version: 1, actuator_commands_enabled: false },
      parameterDefinitions: [{
        parameterKey: 'air_temperature', label: 'Suhu udara', dataType: 'number', unit: '°C',
        valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' }, metadataSchema: {},
      }],
    };
    const tx = {
      plantCatalogVersion: { update: vi.fn().mockResolvedValue({ id: 'catalog-version-a', status: 'PUBLISHED' }) },
      plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
    };
    const prisma = {
      plantCatalogVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: 'catalog-version-a' }),
        findUnique: vi.fn().mockResolvedValue(validVersion),
      },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const service = new PlantsService(prisma as never, authorization as never);
    await expect(service.publishCatalogVersion('org-a', 'catalog-version-a', owner)).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(tx.plantCatalogVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'catalog-version-a' }, data: expect.objectContaining({ status: 'PUBLISHED', checksum: expect.any(String) }),
    }));

    prisma.plantCatalogVersion.findUnique.mockResolvedValue({ ...validVersion, profileDefaults: { unregistered_parameter: 1 } });
    await expect(service.publishCatalogVersion('org-a', 'catalog-version-a', owner)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.plantCatalogVersion.update).toHaveBeenCalledTimes(1);
  });
});

describe('PlantsService draft revision CAS', () => {
  const owner = { ...{
    id: 'owner-1', email: 'owner@example.test', name: 'Owner', isActive: true,
    organizationId: 'org-a', membershipId: 'membership-a', role: UserRole.OWNER,
    memberships: [], organization: null, membership: null,
  } } as unknown as AuthenticatedUser;
  const authorization = {
    getMembership: vi.fn().mockResolvedValue({ organizationId: 'org-a', role: UserRole.OWNER }),
    organizationExists: vi.fn().mockResolvedValue(true),
  };

  it('returns a structured conflict when a growth stage code already exists', async () => {
    const tx = {
      plantProfileVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'version-1', status: 'DRAFT', draftRevision: 2, configSchemaVersion: 'plant-config/v1',
          sourceCatalogVersion: { parameterDefinitions: [] },
        }),
      },
      growthStage: {
        create: vi.fn().mockRejectedValue({
          code: 'P2002', meta: { target: ['plantProfileVersionId', 'code'] },
        }),
      },
      plantConfigAuditEvent: { create: vi.fn() },
    };
    const service = new PlantsService(
      { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      authorization as never,
    );

    await expect(service.createGrowthStage('org-a', 'version-1', {
      code: 'vegetative', label: 'Vegetative', sequence: 1, expectedRevision: 1,
    }, owner)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'GROWTH_STAGE_CODE_EXISTS',
        message: 'A growth stage with this code already exists in this profile version',
      },
    });
    expect(tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
  });

  it('increments the parent revision and writes the draft audit in one transaction', async () => {
    const updatedVersion = { id: 'version-1', status: 'DRAFT', draftRevision: 2, profileConfig: { sample: 'new' } };
    const tx = {
      plantProfileVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ id: 'version-1', plantProfileId: 'profile-1', status: 'DRAFT', draftRevision: 2 }),
        update: vi.fn().mockResolvedValue(updatedVersion),
      },
      plantProfile: { update: vi.fn().mockResolvedValue({}) },
      plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const service = new PlantsService(prisma as never, authorization as never);

    await expect(service.updateProfileDraft('org-a', 'version-1', {
      expectedRevision: 1,
      profileConfig: { sample: 'new' },
    }, owner)).resolves.toEqual(updatedVersion);
    expect(tx.plantProfileVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'version-1', organizationId: 'org-a', status: 'DRAFT', draftRevision: 1 },
      data: { draftRevision: { increment: 1 } },
    });
    expect(tx.plantProfileVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'version-1', organizationId: 'org-a', status: 'DRAFT', draftRevision: 2 },
    }));
    expect(tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ details: { draftRevision: 2 } }),
    }));
  });

  it('returns a deterministic stale-revision conflict with the current revision', async () => {
    const tx = {
      plantProfileVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({ status: 'DRAFT', draftRevision: 8 }),
      },
    };
    const service = new PlantsService(
      { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never,
      authorization as never,
    );

    const error = await service.updateProfileDraft('org-a', 'version-1', {
      expectedRevision: 7,
      profileConfig: { sample: 'stale' },
    }, owner).catch((caught: ConflictException) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'STALE_DRAFT_REVISION',
      message: 'The draft changed; reload it before retrying',
      expectedRevision: 7,
      currentRevision: 8,
    });
  });

  it('validates and seals the same post-CAS snapshot and includes its revision in the checksum', async () => {
    const stage = {
      id: 'stage-1', code: 'stage', sequence: 1, minDurationDays: null, maxDurationDays: null,
      transitionCriteria: null,
      parameterConfig: { id: 'stage-config-1', config: {}, configSchemaVersion: 'plant-config/v1' },
    };
    const snapshot = {
      id: 'version-1', organizationId: 'org-a', status: 'DRAFT', draftRevision: 2,
      configSchemaVersion: 'plant-config/v1', profileConfig: { sample: 'value' },
      sourceCatalogVersion: {
        checksum: 'catalog-checksum',
        parameterDefinitions: [{ parameterKey: 'sample', valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' }, metadataSchema: { required: true } }],
      },
      growthStages: [stage],
    };
    const sealed = { ...snapshot, status: 'VALIDATED', draftRevision: 2, checksum: 'sealed-checksum' };
    const tx = {
      plantProfileVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(sealed),
      },
      stageParameterConfig: { update: vi.fn().mockResolvedValue({}) },
      plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) };
    const service = new PlantsService(prisma as never, authorization as never);
    const expectedChecksum = configChecksum({
      sourceCatalogChecksum: 'catalog-checksum',
      configSchemaVersion: 'plant-config/v1',
      draftRevision: 2,
      profileConfig: { sample: 'value' },
      stages: [{ code: 'stage', sequence: 1, minDurationDays: null, maxDurationDays: null, transitionCriteria: null, config: {} }],
    });

    await service.validateProfileVersion('org-a', 'version-1', 1, owner);
    expect(tx.plantProfileVersion.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'version-1', organizationId: 'org-a', status: 'DRAFT', draftRevision: 1 },
      data: { draftRevision: { increment: 1 } },
    });
    expect(tx.plantProfileVersion.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'version-1', organizationId: 'org-a', status: 'DRAFT', draftRevision: 2 },
      data: expect.objectContaining({ status: 'VALIDATED', checksum: expectedChecksum }),
    }));
    expect(tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ toChecksum: expectedChecksum, details: { draftRevision: 2 } }),
    }));
  });
});

describe('PlantsService platform catalog grants', () => {
  const actor = { id: 'admin-1' } as AuthenticatedUser;

  it('revokes a catalog grant and records the audit event in the same transaction', async () => {
    const grant = { id: 'grant-1', userId: 'user-1', permission: PlatformPermission.PLANT_CATALOG_ADMIN, revokedAt: null };
    const revoked = { ...grant, revokedAt: new Date() };
    const tx = {
      platformAdminGrant: { findUnique: vi.fn().mockResolvedValue(grant), update: vi.fn().mockResolvedValue(revoked) },
      plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const service = new PlantsService(prisma as never, {} as never);

    await expect(service.revokePlatformGrant(grant.id, actor)).resolves.toEqual(revoked);
    expect(tx.platformAdminGrant.update).toHaveBeenCalledWith({
      where: { id: grant.id, permission: PlatformPermission.PLANT_CATALOG_ADMIN, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PLATFORM_GRANT_REVOKED', entityId: grant.id }) }));
  });

  it('does not mutate or audit grants with another permission', async () => {
    const grant = { id: 'grant-other', userId: 'user-1', permission: PlatformPermission.RESEARCH_SOURCE_ADMIN, revokedAt: null };
    const tx = {
      platformAdminGrant: { findUnique: vi.fn().mockResolvedValue(grant), update: vi.fn() },
      plantConfigAuditEvent: { create: vi.fn() },
    };
    const service = new PlantsService({ $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never, {} as never);

    await expect(service.revokePlatformGrant(grant.id, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.platformAdminGrant.update).not.toHaveBeenCalled();
    expect(tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
  });

  it('returns not found without mutation or audit for an unknown grant', async () => {
    const tx = {
      platformAdminGrant: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      plantConfigAuditEvent: { create: vi.fn() },
    };
    const service = new PlantsService({ $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)) } as never, {} as never);

    await expect(service.revokePlatformGrant('missing', actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.platformAdminGrant.update).not.toHaveBeenCalled();
    expect(tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
  });

  it('lists only catalog grants and returns an empty list when none exist', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new PlantsService({ platformAdminGrant: { findMany } } as never, {} as never);

    await expect(service.listPlatformGrants()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { permission: PlatformPermission.PLANT_CATALOG_ADMIN },
      select: {
        id: true,
        userId: true,
        grantedAt: true,
        revokedAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { grantedAt: 'desc' },
    });
  });

  it('derives active and revoked status from the revocation timestamp', async () => {
    const grantedAt = new Date('2026-10-01T10:00:00Z');
    const revokedAt = new Date('2026-10-02T10:00:00Z');
    const findMany = vi.fn().mockResolvedValue([
      { id: 'active-grant', userId: 'user-active', grantedAt, revokedAt: null, user: { id: 'user-active', email: 'active@example.test', name: 'Active' } },
      { id: 'revoked-grant', userId: 'user-revoked', grantedAt, revokedAt, user: { id: 'user-revoked', email: 'revoked@example.test', name: 'Revoked' } },
    ]);
    const service = new PlantsService({ platformAdminGrant: { findMany } } as never, {} as never);

    await expect(service.listPlatformGrants()).resolves.toEqual([
      expect.objectContaining({ id: 'active-grant', status: 'ACTIVE', grantedAt, revokedAt: null, user: { id: 'user-active', email: 'active@example.test', name: 'Active' } }),
      expect.objectContaining({ id: 'revoked-grant', status: 'REVOKED', grantedAt, revokedAt, user: { id: 'user-revoked', email: 'revoked@example.test', name: 'Revoked' } }),
    ]);
  });
});

describe('PlantsService organization catalog access', () => {
  const actor = {
    id: 'user-1', email: 'person@example.test', name: 'Person', isActive: true,
    organizationId: 'org-a', membershipId: 'membership-a', role: UserRole.VIEWER,
    memberships: [], organization: null, membership: null,
  } as unknown as AuthenticatedUser;
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
