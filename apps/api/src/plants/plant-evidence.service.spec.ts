import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PlatformPermission, PlantAiProposalStatus, ScientificEvidenceVerificationStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PlantEvidenceService, PlantProposalsService } from './plant-evidence.service.js';

const actor = { id: 'user-a', isActive: true } as AuthenticatedUser;

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'source-a',
    title: { state: 'VALUE', value: 'Greenhouse tomato study' },
    authors: { state: 'VALUE', value: ['A. Researcher'] },
    publicationYear: { state: 'VALUE', value: 2024 },
    doi: { state: 'NOT_REPORTED' },
    canonicalUrl: { state: 'VALUE', value: 'https://example.test/article' },
    publisherOrJournal: { state: 'VALUE', value: 'Test Journal' },
    publicationType: { state: 'VALUE', value: 'Research article' },
    retrievedAt: '2026-10-27T00:00:00.000Z',
    crop: { state: 'VALUE', value: 'tomato' },
    cultivar: { state: 'UNKNOWN' },
    growthStage: { state: 'VALUE', value: 'vegetative' },
    growingSystem: { state: 'VALUE', value: 'greenhouse substrate' },
    parameterKey: { state: 'VALUE', value: 'air_temperature' },
    reportedValue: { state: 'VALUE', value: { minimum: 20, maximum: 25 } },
    unit: { state: 'VALUE', value: '°C' },
    experimentalContext: { state: 'VALUE', value: 'Controlled greenhouse trial' },
    limitations: { state: 'VALUE', value: 'Single location' },
    findingSummary: { state: 'VALUE', value: 'Observed temperature range in the trial.' },
    extraction: { method: 'MANUAL', extractedAt: '2026-10-27T00:00:00.000Z', locator: 'Table 2' },
    quality: 'HIGH',
    verificationStatus: 'UNVERIFIED',
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: 'caller-proposal-id', organizationId: 'org-a', plantCatalogId: 'catalog-a',
    targetIntent: 'CREATE_DRAFT', cropIdentity: { scientificName: 'Solanum lycopersicum', commonName: 'tomato' },
    growingSystem: { state: 'VALUE', value: 'greenhouse substrate' }, environmentalAssumptions: [],
    parameterDefinitions: [{
      parameterKey: 'air_temperature', label: 'Air temperature', dataType: 'number', unit: '°C',
      valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' },
      recommendedOperatingRange: { minimum: 20, maximum: 25, unit: '°C' },
      applicability: { crop: { state: 'VALUE', value: 'tomato' }, cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' }, growingSystem: { state: 'VALUE', value: 'greenhouse substrate' } },
      evidenceReferences: ['evidence-a'], uncertainty: { level: 'MODERATE' }, reviewStatus: 'SUPPORTED',
    }],
    profileDefaults: { air_temperature: 22 }, stageTemplates: [], edgeRequirements: {}, evidenceReferences: ['evidence-a'],
    validationFindings: [], unresolvedQuestions: [], createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', status: 'PROPOSED',
    ...overrides,
  };
}

function harness() {
  let commits = 0;
  let rollbacks = 0;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ role: 'ADMIN' }]),
    platformAdminGrant: { findFirst: vi.fn().mockResolvedValue({ id: 'grant-a' }) },
    researchSource: { findUnique: vi.fn().mockResolvedValue({ id: 'source-a' }) },
    plantScientificEvidence: {
      create: vi.fn(async ({ data }) => data),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'evidence-a', verificationStatus: 'VERIFIED' }),
    },
    plantCatalog: { findFirst: vi.fn().mockResolvedValue({ id: 'catalog-a' }) },
    plantCatalogVersion: {
      findFirst: vi.fn().mockResolvedValue({ id: 'version-a', status: 'DRAFT' }),
      aggregate: vi.fn().mockResolvedValue({ _max: { version: 2 } }),
      create: vi.fn().mockResolvedValue({ id: 'version-new' }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'version-new', parameterDefinitions: [] }),
    },
    plantParameterDefinition: { create: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    plantAiProposal: { create: vi.fn(async ({ data }) => data), findFirst: vi.fn(), update: vi.fn(async ({ data }) => data) },
    plantConfigAuditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      try {
        const result = await callback(tx);
        commits += 1;
        return result;
      } catch (error) {
        rollbacks += 1;
        throw error;
      }
    }),
    platformAdminGrant: { findFirst: vi.fn().mockResolvedValue({ id: 'grant-a' }) },
    plantScientificEvidence: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    plantAiProposal: { findFirst: vi.fn() },
  };
  const authorization = {
    requireRole: vi.fn().mockResolvedValue({ role: 'ADMIN' }),
    getMembership: vi.fn().mockResolvedValue({ role: 'VIEWER' }),
  };
  return {
    tx, prisma, authorization,
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
    evidenceService: new PlantEvidenceService(prisma as never, authorization as never),
    proposalService: new PlantProposalsService(prisma as never, authorization as never),
  };
}

describe('PlantEvidenceService', () => {
  it('lists only evidence in the authorized organization and verified global evidence', async () => {
    const h = harness();
    await h.evidenceService.listOrganizationEvidence('org-a', actor);
    expect(h.authorization.getMembership).toHaveBeenCalledWith(actor.id, 'org-a');
    expect(h.prisma.plantScientificEvidence.findMany).toHaveBeenCalledWith({
      where: { OR: [{ organizationId: 'org-a' }, { organizationId: null, verificationStatus: 'VERIFIED' }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  it('creates organization evidence only after OWNER/ADMIN authorization and forces UNVERIFIED', async () => {
    const h = harness();
    await h.evidenceService.createOrganizationEvidence('org-a', evidence(), actor);
    expect(h.authorization.requireRole).toHaveBeenCalledWith('user-a', 'org-a', ['OWNER', 'ADMIN']);
    expect(h.tx.plantScientificEvidence.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', verificationStatus: 'UNVERIFIED', contract: expect.objectContaining({ verificationStatus: 'UNVERIFIED' }) }) }));
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalled();
  });

  it('denies organization evidence creation for a member without management role', async () => {
    const h = harness();
    h.authorization.requireRole.mockRejectedValue(new ForbiddenException());
    await expect(h.evidenceService.createOrganizationEvidence('org-a', evidence(), actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires the dedicated platform curator permission for global evidence', async () => {
    const h = harness();
    h.prisma.platformAdminGrant.findFirst.mockResolvedValue(null);
    await expect(h.evidenceService.createGlobalEvidence(evidence(), actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.platformAdminGrant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-a', permission: PlatformPermission.SCIENTIFIC_EVIDENCE_CURATOR, revokedAt: null } }));
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires the dedicated curator permission to verify global evidence', async () => {
    const h = harness();
    h.prisma.plantScientificEvidence.findUnique.mockResolvedValue({ id: 'global-evidence', organizationId: null, verificationStatus: 'UNVERIFIED', contract: evidence() });
    h.prisma.platformAdminGrant.findFirst.mockResolvedValue(null);
    await expect(h.evidenceService.verifyEvidence('global-evidence', 'reviewed', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates global evidence with null organization only for an active curator', async () => {
    const h = harness();
    await h.evidenceService.createGlobalEvidence(evidence(), actor);
    expect(h.tx.plantScientificEvidence.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: null, verificationStatus: 'UNVERIFIED' }) }));
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'GLOBAL_SCIENTIFIC_EVIDENCE_CREATED', organizationId: null }) }));
  });

  it('allows explicitly incomplete evidence to remain UNVERIFIED but rejects metadata with malformed provenance', async () => {
    const h = harness();
    await h.evidenceService.createOrganizationEvidence('org-a', evidence({ reportedValue: { state: 'UNKNOWN' }, parameterKey: { state: 'UNKNOWN' } }), actor);
    expect(h.tx.plantScientificEvidence.create).toHaveBeenCalled();
    await expect(h.evidenceService.createOrganizationEvidence('org-a', evidence({ sourceId: undefined, canonicalUrl: { state: 'UNKNOWN' } }), actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a sourceId that does not resolve to a registered ResearchSource', async () => {
    const h = harness();
    h.tx.researchSource.findUnique.mockResolvedValue(null);
    await expect(h.evidenceService.createOrganizationEvidence('org-a', evidence(), actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.tx.plantScientificEvidence.create).not.toHaveBeenCalled();
  });

  it('does not verify metadata-only source records', async () => {
    const h = harness();
    h.prisma.plantScientificEvidence.findUnique.mockResolvedValue({ id: 'evidence-a', organizationId: 'org-a', verificationStatus: 'UNVERIFIED', contract: evidence({ extraction: { method: 'SOURCE_METADATA', extractedAt: '2026-10-27T00:00:00.000Z' } }) });
    await expect(h.evidenceService.verifyEvidence('evidence-a', 'reviewed', actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects verification when the JSON status disagrees with the database status', async () => {
    const h = harness();
    h.prisma.plantScientificEvidence.findUnique.mockResolvedValue({ id: 'evidence-a', organizationId: 'org-a', verificationStatus: 'UNVERIFIED', contract: evidence({ verificationStatus: 'UNKNOWN' }) });
    await expect(h.evidenceService.verifyEvidence('evidence-a', 'reviewed', actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires assessment, complete finding and review reason before verification', async () => {
    const h = harness();
    h.prisma.plantScientificEvidence.findUnique.mockResolvedValue({ id: 'evidence-a', organizationId: 'org-a', verificationStatus: 'UNVERIFIED', contract: evidence({ quality: 'NOT_ASSESSED', reportedValue: { state: 'UNKNOWN' } }) });
    await expect(h.evidenceService.verifyEvidence('evidence-a', 'reviewed', actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('records reviewer, timestamp, checksum and reason in an atomic verification audit', async () => {
    const h = harness();
    const record = { id: 'evidence-a', organizationId: 'org-a', verificationStatus: 'UNVERIFIED', contract: evidence({ evidenceId: 'evidence-a' }) };
    h.prisma.plantScientificEvidence.findUnique.mockResolvedValue(record);
    h.tx.plantScientificEvidence.findUnique.mockResolvedValue(record);
    const result = await h.evidenceService.verifyEvidence('evidence-a', 'Reviewed full text and table 2', actor);
    expect(h.tx.plantScientificEvidence.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'evidence-a', verificationStatus: 'UNVERIFIED' }, data: expect.objectContaining({ verificationStatus: 'VERIFIED', verifiedByUserId: 'user-a', contract: expect.objectContaining({ verificationStatus: 'VERIFIED' }) }) }));
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'SCIENTIFIC_EVIDENCE_VERIFIED', fromChecksum: expect.any(String), toChecksum: expect.any(String), details: expect.objectContaining({ reason: 'Reviewed full text and table 2', fromStatus: 'UNVERIFIED', toStatus: 'VERIFIED' }) }) }));
    expect(result.verificationStatus).toBe('VERIFIED');
  });

  it('scopes reads of organization evidence to membership and hides missing records', async () => {
    const h = harness();
    h.prisma.plantScientificEvidence.findUnique.mockResolvedValue({ id: 'evidence-a', organizationId: 'org-other' });
    h.authorization.getMembership.mockRejectedValue(new ForbiddenException());
    await expect(h.evidenceService.getEvidence('evidence-a', actor)).rejects.toBeInstanceOf(NotFoundException);
    h.prisma.plantScientificEvidence.findUnique.mockResolvedValue(null);
    await expect(h.evidenceService.getEvidence('missing', actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlantProposalsService', () => {
  it('requires a different organization administrator to approve a proposal with verified evidence', async () => {
    const h = harness();
    const proposalRecord = {
      id: 'proposal-a', organizationId: 'org-a', plantCatalogId: 'catalog-a', createdByUserId: 'author-a',
      status: PlantAiProposalStatus.NEEDS_REVIEW, contract: proposal(),
      evidenceLinks: [{ evidence: { id: 'evidence-a', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED, contract: evidence() } }],
    };
    h.tx.plantAiProposal.findFirst.mockResolvedValue(proposalRecord);
    await h.proposalService.decide('org-a', 'proposal-a', true, 'Evidence reviewed', actor);
    expect(h.tx.plantAiProposal.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'proposal-a' }, data: expect.objectContaining({ status: 'APPROVED' }) }));
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PLANT_AI_PROPOSAL_APPROVED', entityId: 'proposal-a' }) }));
  });

  it('does not allow a proposal author to approve their own proposal', async () => {
    const h = harness();
    h.tx.plantAiProposal.findFirst.mockResolvedValue({
      id: 'proposal-a', organizationId: 'org-a', createdByUserId: actor.id, status: PlantAiProposalStatus.PROPOSED,
      contract: proposal(), evidenceLinks: [{ evidence: { verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED, contract: evidence() } }],
    });
    await expect(h.proposalService.decide('org-a', 'proposal-a', true, 'Review', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.tx.plantAiProposal.update).not.toHaveBeenCalled();
  });

  it('requires approval before applying a proposal to a catalog draft', async () => {
    const h = harness();
    h.tx.plantAiProposal.findFirst.mockResolvedValue({ id: 'proposal-a', status: PlantAiProposalStatus.PROPOSED, contract: proposal(), plantCatalogId: 'catalog-a' });
    await expect(h.proposalService.applyToDraft('org-a', 'proposal-a', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.plantCatalogVersion.create).not.toHaveBeenCalled();
  });

  it('applies an approved CREATE_DRAFT proposal as a draft and retains catalog publication as a separate step', async () => {
    const h = harness();
    h.tx.plantCatalogVersion.findFirst.mockResolvedValue({ id: 'version-new', status: 'DRAFT' });
    h.tx.plantAiProposal.findFirst.mockResolvedValue({ id: 'proposal-a', status: PlantAiProposalStatus.APPROVED, plantCatalogId: 'catalog-a', contract: proposal({ status: 'APPROVED' }) });
    await h.proposalService.applyToDraft('org-a', 'proposal-a', actor);
    expect(h.tx.plantCatalogVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plantCatalogId: 'catalog-a', version: 3 }) }));
    expect(h.tx.plantParameterDefinition.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plantCatalogVersionId: 'version-new', parameterKey: 'air_temperature' }) }));
    expect(h.tx.plantAiProposal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ targetCatalogVersionId: 'version-new', contract: expect.objectContaining({ appliedCatalogVersionId: 'version-new' }) }) }));
  });

  it('creates a tenant snapshot and evidence links without touching catalog versions', async () => {
    const h = harness();
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([{ id: 'evidence-a', organizationId: null, verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED, contract: evidence() }]);
    const result = await h.proposalService.create('org-a', proposal(), actor);
    expect(result.status).toBe(PlantAiProposalStatus.PROPOSED);
    expect(h.tx.plantCatalog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'catalog-a', organizationId: 'org-a', status: 'ACTIVE' } }));
    expect(h.tx.plantAiProposal.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', plantCatalogId: 'catalog-a', evidenceLinks: { create: [{ evidence: { connect: { id: 'evidence-a' } } }] } }) }));
    expect(h.tx.plantConfigAuditEvent.create).toHaveBeenCalled();
    expect(h.tx.plantCatalogVersion.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a catalog from another organization and rolls back before proposal write', async () => {
    const h = harness();
    h.tx.plantCatalog.findFirst.mockResolvedValue(null);
    await expect(h.proposalService.create('org-a', proposal(), actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.tx.plantAiProposal.create).not.toHaveBeenCalled();
  });

  it('rejects a missing, foreign-organization or non-verified global evidence reference', async () => {
    const h = harness();
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([]);
    await expect(h.proposalService.create('org-a', proposal(), actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.tx.plantScientificEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['evidence-a'] }, OR: [{ organizationId: 'org-a' }, { organizationId: null, verificationStatus: 'VERIFIED' }] } }));
  });

  it('allows only organization-owned evidence or VERIFIED global evidence links', async () => {
    const h = harness();
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([{ id: 'evidence-a', organizationId: 'org-a', verificationStatus: 'UNVERIFIED', contract: evidence() }]);
    const result = await h.proposalService.create('org-a', proposal({ parameterDefinitions: [{ ...proposal().parameterDefinitions[0], reviewStatus: 'UNVERIFIED' }] }), actor);
    expect(result.status).toBe('NEEDS_REVIEW');
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([]);
    await expect(h.proposalService.create('org-a', proposal(), actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a payload organization that differs from the authorized route tenant', async () => {
    const h = harness();
    await expect(h.proposalService.create('org-a', proposal({ organizationId: 'org-b' }), actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate evidence identifiers deterministically', async () => {
    const h = harness();
    await expect(h.proposalService.create('org-a', proposal({ evidenceReferences: ['evidence-a', 'evidence-a'] }), actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a matching DRAFT version only for UPDATE_DRAFT', async () => {
    const h = harness();
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([{ id: 'evidence-a', organizationId: 'org-a', verificationStatus: 'VERIFIED', contract: evidence() }]);
    await h.proposalService.create('org-a', proposal({ targetIntent: 'UPDATE_DRAFT', targetCatalogVersionId: 'version-a' }), actor);
    expect(h.tx.plantCatalogVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'version-a', plantCatalogId: 'catalog-a', status: 'DRAFT' } }));
    h.tx.plantCatalogVersion.findFirst.mockResolvedValue(null);
    await expect(h.proposalService.create('org-a', proposal({ targetIntent: 'UPDATE_DRAFT', targetCatalogVersionId: 'version-other' }), actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not allow callers to set an approved proposal or promote unverified evidence to support', async () => {
    const h = harness();
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([{ id: 'evidence-a', organizationId: null, verificationStatus: 'VERIFIED', contract: evidence() }]);
    await expect(h.proposalService.create('org-a', proposal({ status: 'APPROVED' }), actor)).resolves.toEqual(expect.objectContaining({ status: 'PROPOSED' }));
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([{ id: 'evidence-a', organizationId: 'org-a', verificationStatus: 'UNVERIFIED', contract: evidence() }]);
    await expect(h.proposalService.create('org-a', proposal({ parameterDefinitions: [{ ...proposal().parameterDefinitions[0], reviewStatus: 'SUPPORTED' }] }), actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rolls back the proposal and links when audit insertion fails', async () => {
    const h = harness();
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([{ id: 'evidence-a', organizationId: null, verificationStatus: 'VERIFIED', contract: evidence() }]);
    h.tx.plantConfigAuditEvent.create.mockRejectedValue(new Error('audit write failed'));
    await expect(h.proposalService.create('org-a', proposal(), actor)).rejects.toThrow('audit write failed');
    expect(h.rollbacks).toBe(1);
    expect(h.commits).toBe(0);
  });

  it('propagates evidence-link insertion failure through the enclosing transaction', async () => {
    const h = harness();
    h.tx.plantScientificEvidence.findMany.mockResolvedValue([{ id: 'evidence-a', organizationId: null, verificationStatus: 'VERIFIED', contract: evidence() }]);
    h.tx.plantAiProposal.create.mockRejectedValue(new Error('evidence link write failed'));
    await expect(h.proposalService.create('org-a', proposal(), actor)).rejects.toThrow('evidence link write failed');
    expect(h.tx.plantConfigAuditEvent.create).not.toHaveBeenCalled();
    expect(h.rollbacks).toBe(1);
    expect(h.commits).toBe(0);
  });
});
