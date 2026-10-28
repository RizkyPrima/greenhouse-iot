import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PlatformPermission, PlantAiProposalStatus, PlantVersionStatus, ScientificEvidenceVerificationStatus, UserRole, Prisma } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { validatePlantAiProposal, validateScientificEvidence, type ScientificEvidenceRecord } from './plant-proposal.contract.js';
import { PLANT_CONFIG_SCHEMA_VERSION } from './plant-config.js';

const MANAGEMENT_ROLES: UserRole[] = [UserRole.OWNER, UserRole.ADMIN];
const EVIDENCE_CURATOR = PlatformPermission.SCIENTIFIC_EVIDENCE_CURATOR;

function snapshotHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function evidenceIds(contract: Record<string, unknown>): string[] {
  const ids = contract.evidenceReferences;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    throw new UnprocessableEntityException('Proposal evidence references are invalid');
  }
  if (new Set(ids).size !== ids.length) throw new UnprocessableEntityException('Duplicate evidence references are not allowed');
  return ids as string[];
}

@Injectable()
export class PlantEvidenceService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  async createOrganizationEvidence(organizationId: string, input: Record<string, unknown>, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, MANAGEMENT_ROLES);
    return this.createEvidence(organizationId, input, actor);
  }

  async listOrganizationEvidence(organizationId: string, actor: AuthenticatedUser) {
    await this.authorization.getMembership(actor.id, organizationId);
    return this.prisma.plantScientificEvidence.findMany({
      where: {
        OR: [
          { organizationId },
          { organizationId: null, verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createGlobalEvidence(input: Record<string, unknown>, actor: AuthenticatedUser) {
    await this.requireCurator(actor);
    return this.createEvidence(null, input, actor);
  }

  private async createEvidence(organizationId: string | null, input: Record<string, unknown>, actor: AuthenticatedUser) {
    const evidenceId = randomUUID();
    const contract: Record<string, unknown> = { ...input, evidenceId, verificationStatus: ScientificEvidenceVerificationStatus.UNVERIFIED };
    const validation = validateScientificEvidence(contract);
    // Incomplete scientific fields may be retained for research follow-up, but malformed
    // structure or absent provenance is never persisted as evidence.
    const blocking = validation.findings.some(({ code }) => ['SCHEMA_INVALID', 'MISSING_EVIDENCE_REFERENCE'].includes(code));
    if (blocking) throw new UnprocessableEntityException({ message: 'Evidence contract or provenance is invalid', findings: validation.findings });
    const sourceId = typeof contract.sourceId === 'string' ? contract.sourceId : null;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      await this.assertActorActive(tx, actor.id);
      if (organizationId) await this.lockOrganizationMembership(tx, actor.id, organizationId, true);
      else await this.lockCuratorGrant(tx, actor.id);
      if (sourceId && !await tx.researchSource.findUnique({ where: { id: sourceId }, select: { id: true } })) {
        throw new UnprocessableEntityException('Evidence source record was not found');
      }
      const evidence = await tx.plantScientificEvidence.create({
        data: {
          id: evidenceId,
          organizationId,
          sourceId,
          verificationStatus: ScientificEvidenceVerificationStatus.UNVERIFIED,
          contract: asJson(contract),
          createdByUserId: actor.id,
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id,
          organizationId,
          action: organizationId ? 'SCIENTIFIC_EVIDENCE_CREATED' : 'GLOBAL_SCIENTIFIC_EVIDENCE_CREATED',
          entityType: 'PlantScientificEvidence',
          entityId: evidence.id,
          toChecksum: snapshotHash(contract),
          details: { verificationStatus: evidence.verificationStatus, sourceId, findingCount: validation.findings.length },
          createdAt: now,
        },
      });
      return evidence;
    });
  }

  async getEvidence(evidenceId: string, actor: AuthenticatedUser) {
    const evidence = await this.prisma.plantScientificEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence) throw new NotFoundException('Scientific evidence not found');
    if (evidence.organizationId !== null) {
      try {
        await this.authorization.getMembership(actor.id, evidence.organizationId);
      } catch (error) {
        if (error instanceof ForbiddenException || error instanceof NotFoundException) throw new NotFoundException('Scientific evidence not found');
        throw error;
      }
    }
    return evidence;
  }

  async verifyEvidence(evidenceId: string, reason: string, actor: AuthenticatedUser) {
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.trim().length > 2000) {
      throw new UnprocessableEntityException('A review reason of 1–2000 characters is required');
    }
    const existing = await this.prisma.plantScientificEvidence.findUnique({ where: { id: evidenceId } });
    if (!existing) throw new NotFoundException('Scientific evidence not found');
    if (existing.organizationId) await this.authorization.requireRole(actor.id, existing.organizationId, MANAGEMENT_ROLES);
    else await this.requireCurator(actor);

    if (existing.verificationStatus !== ScientificEvidenceVerificationStatus.UNVERIFIED) {
      throw new ConflictException('Only UNVERIFIED evidence can be verified');
    }
    const candidate = existing.contract as unknown as ScientificEvidenceRecord;
    if (candidate.verificationStatus !== existing.verificationStatus) {
      throw new ConflictException('Evidence status does not match its contract snapshot');
    }
    const validation = validateScientificEvidence(candidate);
    const reviewBlocking = validation.findings.some(({ severity, code }) => severity === 'ERROR' || (severity === 'WARNING' && code !== 'EVIDENCE_NOT_VERIFIED'));
    if (reviewBlocking || candidate.quality === 'LOW' || candidate.quality === 'NOT_ASSESSED' || candidate.extraction.method === 'SOURCE_METADATA') {
      throw new UnprocessableEntityException({ message: 'Evidence is incomplete or requires further scientific review', findings: validation.findings });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertActorActive(tx, actor.id);
      if (existing.organizationId) await this.lockOrganizationMembership(tx, actor.id, existing.organizationId, true);
      else await this.lockCuratorGrant(tx, actor.id);
      const current = await tx.plantScientificEvidence.findUnique({ where: { id: evidenceId } });
      if (!current || current.organizationId !== existing.organizationId) throw new NotFoundException('Scientific evidence not found');
      if (current.verificationStatus !== ScientificEvidenceVerificationStatus.UNVERIFIED) throw new ConflictException('Evidence has already changed');
      const currentContract = current.contract as unknown as ScientificEvidenceRecord;
      if (snapshotHash(currentContract) !== snapshotHash(candidate)) throw new ConflictException('Evidence changed during review');
      const verifiedAt = new Date();
      const verifiedContract = { ...currentContract, verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED };
      const result = await tx.plantScientificEvidence.updateMany({
        where: { id: evidenceId, verificationStatus: ScientificEvidenceVerificationStatus.UNVERIFIED },
        data: {
          verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
          verifiedByUserId: actor.id,
          verifiedAt,
          contract: asJson(verifiedContract),
        },
      });
      if (result.count !== 1) throw new ConflictException('Evidence has already changed');
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id,
          organizationId: current.organizationId,
          action: current.organizationId ? 'SCIENTIFIC_EVIDENCE_VERIFIED' : 'GLOBAL_SCIENTIFIC_EVIDENCE_VERIFIED',
          entityType: 'PlantScientificEvidence',
          entityId: evidenceId,
          fromChecksum: snapshotHash(currentContract),
          toChecksum: snapshotHash(verifiedContract),
          details: { fromStatus: current.verificationStatus, toStatus: ScientificEvidenceVerificationStatus.VERIFIED, reason: reason.trim(), verifiedAt: verifiedAt.toISOString() },
          createdAt: verifiedAt,
        },
      });
      return tx.plantScientificEvidence.findUniqueOrThrow({ where: { id: evidenceId } });
    });
  }

  private async requireCurator(actor: AuthenticatedUser) {
    if (!actor.isActive) throw new ForbiddenException('Active evidence curator permission required');
    const grant = await this.prisma.platformAdminGrant.findFirst({ where: { userId: actor.id, permission: EVIDENCE_CURATOR, revokedAt: null }, select: { id: true } });
    if (!grant) throw new ForbiddenException('Scientific evidence curator permission required');
  }

  private async lockCuratorGrant(tx: Prisma.TransactionClient, userId: string) {
    const grant = await tx.platformAdminGrant.findFirst({ where: { userId, permission: EVIDENCE_CURATOR, revokedAt: null }, select: { id: true } });
    if (!grant) throw new ForbiddenException('Scientific evidence curator permission required');
    await tx.$queryRaw`SELECT "id" FROM "platform_admin_grants" WHERE "id" = ${grant.id} AND "revokedAt" IS NULL FOR SHARE`;
  }

  private async lockOrganizationMembership(tx: Prisma.TransactionClient, userId: string, organizationId: string, manage: boolean) {
    const rows = await tx.$queryRaw<Array<{ role: string }>>`
      SELECT "role" FROM "organization_memberships"
      WHERE "userId" = ${userId} AND "organizationId" = ${organizationId}
      FOR SHARE
    `;
    const role = rows[0]?.role;
    if (!role) throw new ForbiddenException('You do not have access to this organization');
    if (manage && !MANAGEMENT_ROLES.includes(role as UserRole)) throw new ForbiddenException('Insufficient permissions for this resource');
  }

  private async assertActorActive(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${userId} AND "isActive" = TRUE FOR SHARE`;
    if (!rows[0]) throw new ForbiddenException('Active user account required');
  }
}

@Injectable()
export class PlantProposalsService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  async create(organizationId: string, input: Record<string, unknown>, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, MANAGEMENT_ROLES);
    const validation = validatePlantAiProposal(input);
    if (!validation.valid) throw new UnprocessableEntityException({ message: 'Proposal contract is invalid', findings: validation.findings });
    if (input.organizationId !== organizationId) throw new UnprocessableEntityException('Proposal organization must match the request organization');
    const ids = evidenceIds(input);
    const status = validation.status === 'NEEDS_REVIEW' ? PlantAiProposalStatus.NEEDS_REVIEW : PlantAiProposalStatus.PROPOSED;
    const now = new Date();
    const proposalId = randomUUID();
    const contract: Record<string, unknown> = {
      ...input,
      proposalId,
      organizationId,
      status,
      validationFindings: validation.findings,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const catalogId = contract.plantCatalogId as string;
    const targetIntent = contract.targetIntent as string;
    const targetVersionId = typeof contract.targetCatalogVersionId === 'string' ? contract.targetCatalogVersionId : null;

    return this.prisma.$transaction(async (tx) => {
      await this.assertActorActive(tx, actor.id);
      await this.lockOrganizationMembership(tx, actor.id, organizationId);
      await tx.$queryRaw`SELECT "id" FROM "plant_catalogs" WHERE "id" = ${catalogId} AND "organizationId" = ${organizationId} FOR SHARE`;
      const catalog = await tx.plantCatalog.findFirst({ where: { id: catalogId, organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!catalog) throw new NotFoundException('Plant catalog not found');
      if (targetIntent === 'UPDATE_DRAFT' && !targetVersionId) throw new UnprocessableEntityException('UPDATE_DRAFT requires a target draft version');
      if (targetIntent !== 'UPDATE_DRAFT' && targetVersionId) throw new UnprocessableEntityException('Only UPDATE_DRAFT may reference a target version');
      if (targetVersionId) {
        await tx.$queryRaw`SELECT "id" FROM "plant_catalog_versions" WHERE "id" = ${targetVersionId} AND "plantCatalogId" = ${catalogId} FOR SHARE`;
        const version = await tx.plantCatalogVersion.findFirst({ where: { id: targetVersionId, plantCatalogId: catalogId, status: 'DRAFT' }, select: { id: true } });
        if (!version) throw new ConflictException('Target version must be a draft belonging to the proposal catalog');
      }

      let evidence = [] as Array<{ id: string; organizationId: string | null; verificationStatus: ScientificEvidenceVerificationStatus; contract: Prisma.JsonValue }>;
      if (ids.length) {
        evidence = await tx.plantScientificEvidence.findMany({
          where: { id: { in: ids }, OR: [{ organizationId }, { organizationId: null, verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED }] },
          select: { id: true, organizationId: true, verificationStatus: true, contract: true },
        });
        if (evidence.length !== ids.length) throw new NotFoundException('One or more scientific evidence records are unavailable');
      }
      const evidenceById = new Map(evidence.map((item) => [item.id, item]));
      const unsupported = Array.isArray(contract.parameterDefinitions) && contract.parameterDefinitions.some((definition) => {
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return false;
        const value = definition as Record<string, unknown>;
        if (value.reviewStatus !== 'SUPPORTED' || !Array.isArray(value.evidenceReferences)) return false;
        return value.evidenceReferences.some((ref) => typeof ref !== 'string' || evidenceById.get(ref)?.verificationStatus !== ScientificEvidenceVerificationStatus.VERIFIED);
      });
      if (unsupported) throw new UnprocessableEntityException('SUPPORTED parameters must reference verified evidence');
      if (evidence.some((item) => item.verificationStatus !== ScientificEvidenceVerificationStatus.VERIFIED) && status === PlantAiProposalStatus.PROPOSED) {
        contract.status = PlantAiProposalStatus.NEEDS_REVIEW;
      }
      const created = await tx.plantAiProposal.create({
        data: {
          id: proposalId,
          organizationId,
          plantCatalogId: catalogId,
          targetCatalogVersionId: targetVersionId,
          status: contract.status as PlantAiProposalStatus,
          contract: asJson(contract),
          createdByUserId: actor.id,
          evidenceLinks: { create: ids.map((evidenceId) => ({ evidence: { connect: { id: evidenceId } } })) },
        },
      });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id,
          organizationId,
          action: 'PLANT_AI_PROPOSAL_CREATED',
          entityType: 'PlantAiProposal',
          entityId: created.id,
          toChecksum: snapshotHash(contract),
          details: { status: created.status, catalogId, targetCatalogVersionId: targetVersionId, evidenceIds: ids },
          createdAt: now,
        },
      });
      return created;
    });
  }

  async get(organizationId: string, proposalId: string, actor: AuthenticatedUser) {
    await this.authorization.getMembership(actor.id, organizationId);
    const proposal = await this.prisma.plantAiProposal.findFirst({ where: { id: proposalId, organizationId }, include: { evidenceLinks: { include: { evidence: true } } } });
    if (!proposal) throw new NotFoundException('Plant AI proposal not found');
    return proposal;
  }

  async list(organizationId: string, actor: AuthenticatedUser) {
    await this.authorization.getMembership(actor.id, organizationId);
    return this.prisma.plantAiProposal.findMany({
      where: { organizationId },
      include: { evidenceLinks: { include: { evidence: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decide(organizationId: string, proposalId: string, approved: boolean, reason: string, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, MANAGEMENT_ROLES);
    const reviewReason = reason.trim();
    if (!reviewReason) throw new UnprocessableEntityException('A review reason is required');
    return this.prisma.$transaction(async (tx) => {
      await this.assertActorActive(tx, actor.id);
      await this.lockOrganizationMembership(tx, actor.id, organizationId);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "plant_ai_proposals" WHERE "id" = ${proposalId} AND "organizationId" = ${organizationId} FOR UPDATE
      `;
      if (!rows[0]) throw new NotFoundException('Plant AI proposal not found');
      const proposal = await tx.plantAiProposal.findFirst({
        where: { id: proposalId, organizationId },
        include: { evidenceLinks: { include: { evidence: true } } },
      });
      if (!proposal) throw new NotFoundException('Plant AI proposal not found');
      if (proposal.status !== PlantAiProposalStatus.PROPOSED && proposal.status !== PlantAiProposalStatus.NEEDS_REVIEW) {
        throw new ConflictException('Only proposals awaiting review can be decided');
      }
      if (approved) {
        if (proposal.createdByUserId === actor.id) throw new ForbiddenException('A proposal author cannot approve their own proposal');
        const evidence = proposal.evidenceLinks.map(({ evidence: item }) => item);
        if (evidence.some((item) => item.verificationStatus !== ScientificEvidenceVerificationStatus.VERIFIED)) {
          throw new ConflictException('All linked evidence must be verified before proposal approval');
        }
        const contract = proposal.contract as unknown as Record<string, unknown>;
        const validation = validatePlantAiProposal(contract);
        if (!validation.valid) throw new ConflictException('Invalid proposals cannot be approved');
      }
      const status = approved ? PlantAiProposalStatus.APPROVED : PlantAiProposalStatus.REJECTED;
      const now = new Date();
      const contract = {
        ...(proposal.contract as Record<string, unknown>),
        status,
        review: { decision: status, reason: reviewReason, reviewerUserId: actor.id, reviewedAt: now.toISOString() },
        updatedAt: now.toISOString(),
      };
      const updated = await tx.plantAiProposal.update({ where: { id: proposalId }, data: { status, contract: asJson(contract) } });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id, organizationId, action: approved ? 'PLANT_AI_PROPOSAL_APPROVED' : 'PLANT_AI_PROPOSAL_REJECTED',
          entityType: 'PlantAiProposal', entityId: proposalId, fromChecksum: snapshotHash(proposal.contract), toChecksum: snapshotHash(contract),
          details: { reason: reviewReason }, createdAt: now,
        },
      });
      return updated;
    });
  }

  async applyToDraft(organizationId: string, proposalId: string, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, MANAGEMENT_ROLES);
    return this.prisma.$transaction(async (tx) => {
      await this.assertActorActive(tx, actor.id);
      await this.lockOrganizationMembership(tx, actor.id, organizationId);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "plant_ai_proposals" WHERE "id" = ${proposalId} AND "organizationId" = ${organizationId} FOR UPDATE
      `;
      if (!rows[0]) throw new NotFoundException('Plant AI proposal not found');
      const proposal = await tx.plantAiProposal.findFirst({ where: { id: proposalId, organizationId } });
      if (!proposal) throw new NotFoundException('Plant AI proposal not found');
      if (proposal.status !== PlantAiProposalStatus.APPROVED) throw new ConflictException('Only an approved proposal can be applied');
      const contract = proposal.contract as unknown as Record<string, unknown>;
      const previouslyApplied = contract.appliedCatalogVersionId;
      if (typeof previouslyApplied === 'string') {
        return tx.plantCatalogVersion.findUniqueOrThrow({ where: { id: previouslyApplied }, include: { parameterDefinitions: true } });
      }
      if (contract.targetIntent === 'RESEARCH_ONLY') throw new ConflictException('Research-only proposals cannot be applied to a catalog');

      const catalogId = proposal.plantCatalogId;
      const catalogs = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "plant_catalogs" WHERE "id" = ${catalogId} AND "organizationId" = ${organizationId} AND "status" = 'ACTIVE' FOR UPDATE
      `;
      if (!catalogs[0]) throw new NotFoundException('Plant catalog not found');

      let versionId = proposal.targetCatalogVersionId;
      if (contract.targetIntent === 'CREATE_DRAFT') {
        const previous = await tx.plantCatalogVersion.aggregate({ where: { plantCatalogId: catalogId }, _max: { version: true } });
        const created = await tx.plantCatalogVersion.create({
          data: {
            plantCatalogId: catalogId, version: (previous._max.version ?? 0) + 1,
            configSchemaVersion: PLANT_CONFIG_SCHEMA_VERSION,
            profileDefaults: contract.profileDefaults as Prisma.InputJsonValue,
            stageTemplates: contract.stageTemplates as Prisma.InputJsonValue,
            edgeCompatibility: contract.edgeRequirements as Prisma.InputJsonValue,
            createdByUserId: actor.id,
          },
        });
        versionId = created.id;
        await tx.plantConfigAuditEvent.create({
          data: { actorUserId: actor.id, organizationId, action: 'CATALOG_VERSION_DRAFTED', entityType: 'PlantCatalogVersion', entityId: created.id, details: { sourceProposalId: proposalId } },
        });
      } else if (contract.targetIntent !== 'UPDATE_DRAFT' || !versionId) {
        throw new ConflictException('Proposal target intent is not applicable to a catalog draft');
      }

      await tx.$queryRaw`SELECT "id" FROM "plant_catalog_versions" WHERE "id" = ${versionId} AND "plantCatalogId" = ${catalogId} AND "status" = 'DRAFT' FOR UPDATE`;
      const target = await tx.plantCatalogVersion.findFirst({ where: { id: versionId, plantCatalogId: catalogId, status: PlantVersionStatus.DRAFT } });
      if (!target) throw new ConflictException('Target catalog version must still be a draft');
      if (contract.targetIntent === 'UPDATE_DRAFT') {
        await tx.plantCatalogVersion.update({
          where: { id: target.id },
          data: {
            profileDefaults: contract.profileDefaults as Prisma.InputJsonValue,
            stageTemplates: contract.stageTemplates as Prisma.InputJsonValue,
            edgeCompatibility: contract.edgeRequirements as Prisma.InputJsonValue,
          },
        });
        await tx.plantParameterDefinition.deleteMany({ where: { plantCatalogVersionId: target.id } });
        await tx.plantConfigAuditEvent.create({
          data: { actorUserId: actor.id, organizationId, action: 'CATALOG_VERSION_EDITED', entityType: 'PlantCatalogVersion', entityId: target.id, details: { sourceProposalId: proposalId } },
        });
      }
      const definitions = contract.parameterDefinitions as Array<Record<string, unknown>>;
      for (const definition of definitions) {
        await tx.plantParameterDefinition.create({
          data: {
            plantCatalogVersionId: target.id,
            parameterKey: definition.parameterKey as string,
            label: definition.label as string,
            dataType: definition.dataType as string,
            unit: definition.unit as string | undefined,
            valueSchema: definition.valueSchema as Prisma.InputJsonValue,
            metadataSchema: {} as Prisma.InputJsonValue,
          },
        });
      }
      const appliedContract = { ...contract, appliedCatalogVersionId: target.id, updatedAt: new Date().toISOString() };
      await tx.plantAiProposal.update({ where: { id: proposalId }, data: { targetCatalogVersionId: target.id, contract: asJson(appliedContract) } });
      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id, organizationId, action: 'PLANT_AI_PROPOSAL_APPLIED', entityType: 'PlantAiProposal', entityId: proposalId,
          details: { catalogVersionId: target.id },
        },
      });
      return tx.plantCatalogVersion.findUniqueOrThrow({ where: { id: target.id }, include: { parameterDefinitions: true } });
    });
  }

  private async lockOrganizationMembership(tx: Prisma.TransactionClient, userId: string, organizationId: string) {
    const rows = await tx.$queryRaw<Array<{ role: string }>>`
      SELECT "role" FROM "organization_memberships"
      WHERE "userId" = ${userId} AND "organizationId" = ${organizationId}
      FOR SHARE
    `;
    if (!rows[0]) throw new ForbiddenException('You do not have access to this organization');
    if (!MANAGEMENT_ROLES.includes(rows[0].role as UserRole)) throw new ForbiddenException('Insufficient permissions for this resource');
  }

  private async assertActorActive(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${userId} AND "isActive" = TRUE FOR SHARE`;
    if (!rows[0]) throw new ForbiddenException('Active user account required');
  }
}
