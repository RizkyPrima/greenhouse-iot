import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PlantProfileVersionStatus, PlantVersionStatus, UserRole, ZoneDecisionStatus, ZonePlantAssignmentStatus, ZoneRuleSetStatus, Prisma } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { configChecksum } from '../plants/plant-config.js';
import { mergePlantConfig } from '../plants/plant-config.js';
import type { RealtimeDeviceState } from '../telemetry/interfaces/telemetry.interfaces.js';
import { evaluateRules, RULE_DOMAINS, type RuleSetDefinition, type RuleTelemetry } from './rule-engine.js';
import { resolveDecision, type SafetyContext } from './decision-manager.js';

const MANAGERS = [UserRole.OWNER, UserRole.ADMIN];
const MANUAL_REVIEW_FEEDBACK = ['ACCEPTED', 'REJECTED', 'OBSERVED'] as const;

function validateDefinition(value: unknown): asserts value is RuleSetDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnprocessableEntityException('Rule set must be an object');
  const definition = value as Record<string, unknown>;
  if (!Number.isInteger(definition.maxTelemetryAgeMs) || (definition.maxTelemetryAgeMs as number) <= 0 || (definition.maxTelemetryAgeMs as number) > 3_600_000 || !Array.isArray(definition.rules)) {
    throw new UnprocessableEntityException('maxTelemetryAgeMs must be 1..3600000 and rules are required');
  }
  const ids = new Set<string>();
  for (const raw of definition.rules) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UnprocessableEntityException('Rule must be an object');
    const rule = raw as Record<string, unknown>;
    if (typeof rule.id !== 'string' || !rule.id.trim() || ids.has(rule.id) || !RULE_DOMAINS.includes(rule.domain as typeof RULE_DOMAINS[number])
      || typeof rule.enabled !== 'boolean' || !Number.isInteger(rule.priority) || (rule.priority as number) < 0 || (rule.priority as number) > 99
      || !Array.isArray(rule.conditions) || !rule.conditions.length || !rule.action || typeof rule.action !== 'object') {
      throw new UnprocessableEntityException('Rule ID, domain, priority, conditions, and action must be valid');
    }
    ids.add(rule.id);
    const action = rule.action as Record<string, unknown>;
    if (typeof action.actuatorCode !== 'string' || !action.actuatorCode.trim() || !['ON', 'OFF'].includes(String(action.command))) throw new UnprocessableEntityException('Rule action is invalid');
    for (const condition of rule.conditions as unknown[]) {
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new UnprocessableEntityException('Rule condition is invalid');
      const item = condition as Record<string, unknown>;
      if (typeof item.sensorCode !== 'string' || !item.sensorCode.trim() || typeof item.parameterKey !== 'string' || !item.parameterKey.trim() || !['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NE'].includes(String(item.operator))) {
        throw new UnprocessableEntityException('Rule condition is invalid');
      }
    }
  }
}

function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

@Injectable()
export class DecisionManagerService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  async createRuleSet(organizationId: string, profileVersionId: string, rawDefinition: unknown, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, MANAGERS);
    validateDefinition(rawDefinition);
    return this.prisma.$transaction(async (tx) => {
      await this.lockManager(tx, actor.id, organizationId);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "plant_profile_versions" WHERE "id" = ${profileVersionId} AND "organizationId" = ${organizationId} AND "status" = 'VALIDATED' FOR SHARE`;
      if (!rows[0]) throw new ConflictException('Rules can only be attached to a validated plant profile version');
      const version = await tx.plantProfileVersion.findFirst({ where: { id: profileVersionId, organizationId }, include: { sourceCatalogVersion: { include: { parameterDefinitions: true } } } });
      if (!version || version.status !== PlantProfileVersionStatus.VALIDATED || version.sourceCatalogVersion.status !== PlantVersionStatus.PUBLISHED) throw new ConflictException('The source Plant Standard must be published and validated');
      const numericKeys = new Set(version.sourceCatalogVersion.parameterDefinitions.filter(({ dataType }) => ['number', 'integer'].includes(dataType)).map(({ parameterKey }) => parameterKey));
      for (const rule of (rawDefinition as RuleSetDefinition).rules) {
        for (const condition of rule.conditions) {
          if (!numericKeys.has(condition.parameterKey)) throw new UnprocessableEntityException(`Rule references a non-numeric or undeclared Plant Standard parameter: ${condition.parameterKey}`);
        }
      }
      const previous = await tx.zoneRuleSet.aggregate({ where: { organizationId, plantProfileVersionId: profileVersionId }, _max: { version: true } });
      const definition = rawDefinition as RuleSetDefinition;
      const created = await tx.zoneRuleSet.create({ data: {
        organizationId, plantProfileVersionId: profileVersionId, version: (previous._max.version ?? 0) + 1,
        status: ZoneRuleSetStatus.DRAFT, definition: json(definition), checksum: configChecksum(definition), createdByUserId: actor.id,
      } });
      await tx.plantConfigAuditEvent.create({ data: { organizationId, actorUserId: actor.id, action: 'ZONE_RULE_SET_DRAFTED', entityType: 'ZoneRuleSet', entityId: created.id, toChecksum: created.checksum, details: { version: created.version, plantProfileVersionId: profileVersionId } } });
      return created;
    });
  }

  async approveRuleSet(organizationId: string, ruleSetId: string, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, MANAGERS);
    return this.prisma.$transaction(async (tx) => {
      await this.lockManager(tx, actor.id, organizationId);
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "zone_rule_sets" WHERE "id" = ${ruleSetId} AND "organizationId" = ${organizationId} FOR UPDATE`;
      if (!rows[0]) throw new NotFoundException('Rule set not found');
      const ruleSet = await tx.zoneRuleSet.findFirst({ where: { id: ruleSetId, organizationId }, include: { plantProfileVersion: { include: { sourceCatalogVersion: true } } } });
      if (!ruleSet) throw new NotFoundException('Rule set not found');
      if (ruleSet.createdByUserId === actor.id) throw new ForbiddenException('A rule author cannot approve their own rules');
      if (ruleSet.status !== ZoneRuleSetStatus.DRAFT) throw new ConflictException('Only a draft rule set can be approved');
      if (ruleSet.plantProfileVersion.status !== PlantProfileVersionStatus.VALIDATED || ruleSet.plantProfileVersion.sourceCatalogVersion.status !== PlantVersionStatus.PUBLISHED) throw new ConflictException('The source Plant Standard is no longer eligible');
      const now = new Date();
      const approved = await tx.zoneRuleSet.update({ where: { id: ruleSetId }, data: { status: ZoneRuleSetStatus.APPROVED, approvedByUserId: actor.id, approvedAt: now } });
      await tx.plantConfigAuditEvent.create({ data: { organizationId, actorUserId: actor.id, action: 'ZONE_RULE_SET_APPROVED', entityType: 'ZoneRuleSet', entityId: ruleSetId, fromChecksum: ruleSet.checksum, toChecksum: ruleSet.checksum, details: { version: ruleSet.version }, createdAt: now } });
      return approved;
    });
  }

  async listRuleSets(organizationId: string, profileVersionId: string, actor: AuthenticatedUser) {
    await this.authorization.getMembership(actor.id, organizationId);
    return this.prisma.zoneRuleSet.findMany({ where: { organizationId, plantProfileVersionId: profileVersionId }, orderBy: { version: 'desc' } });
  }

  async evaluateTelemetry(greenhouseCode: string, deviceMqttId: string, input: { seq?: number; ts?: number; sensors: Array<{ code: string; value: number; unit?: string }> }, realtimeState: RealtimeDeviceState) {
    if (realtimeState.deviceMqttId !== deviceMqttId || realtimeState.greenhouseId !== greenhouseCode || (input.seq !== undefined && realtimeState.sequence !== input.seq)) return null;
    const assignment = await this.prisma.zonePlantAssignment.findFirst({
      where: {
        status: ZonePlantAssignmentStatus.ACTIVE,
        zone: { devices: { some: { deviceId: deviceMqttId, deletedAt: null } }, greenhouse: { code: greenhouseCode } },
      },
      include: {
        zone: { include: { devices: { where: { deviceId: deviceMqttId }, include: { actuators: { where: { enabled: true, deletedAt: null } } } } } },
        growthStage: { include: { parameterConfig: true } },
        overrides: { where: { supersededAt: null }, orderBy: { revision: 'desc' }, take: 1 },
        plantProfileVersion: { include: { sourceCatalogVersion: { include: { parameterDefinitions: true } }, ruleSets: { where: { status: ZoneRuleSetStatus.APPROVED }, orderBy: { version: 'desc' }, take: 1 } } },
      },
    });
    if (!assignment || assignment.plantProfileVersion.status !== PlantProfileVersionStatus.VALIDATED || assignment.plantProfileVersion.sourceCatalogVersion.status !== PlantVersionStatus.PUBLISHED) return null;
    const ruleSet = assignment.plantProfileVersion.ruleSets[0];
    if (!ruleSet) return null;
    const receivedAt = new Date();
    const telemetryAt = input.ts === undefined ? (realtimeState.lastTelemetryAt ?? receivedAt.toISOString()) : new Date(input.ts).toISOString();
    const sensors: RuleTelemetry['sensors'] = Object.fromEntries(Object.entries(realtimeState.sensors).flatMap(([code, sensor]) => sensor.numericValue === null ? [] : [[code, { value: sensor.numericValue, unit: sensor.unit, timestamp: sensor.timestamp }]]));
    const effectiveConfig = mergePlantConfig(
      assignment.plantProfileVersion.sourceCatalogVersion.profileDefaults as Record<string, unknown>,
      assignment.plantProfileVersion.profileConfig as Record<string, unknown>,
      (assignment.growthStage.parameterConfig?.config ?? {}) as Record<string, unknown>,
      (assignment.overrides[0]?.overrideConfig ?? {}) as Record<string, unknown>,
    );
    const numericDefinitions = new Map(assignment.plantProfileVersion.sourceCatalogVersion.parameterDefinitions
      .filter((item) => ['number', 'integer'].includes(item.dataType))
      .map((item) => [item.parameterKey, item]));
    const standardParameters: RuleTelemetry['standardParameters'] = {};
    for (const rule of (ruleSet.definition as unknown as RuleSetDefinition).rules) {
      for (const condition of rule.conditions) {
        const value = effectiveConfig[condition.parameterKey];
        const parameter = numericDefinitions.get(condition.parameterKey);
        if (parameter && typeof value === 'number' && Number.isFinite(value)) {
          standardParameters[condition.parameterKey] = { value, unit: parameter.unit };
        }
      }
    }
    const telemetry: RuleTelemetry = { deviceMqttId, telemetryAt, sequence: input.seq, sensors, standardParameters };
    const evaluated = evaluateRules(ruleSet.definition as unknown as RuleSetDefinition, telemetry, receivedAt.getTime());
    const currentDevice = assignment.zone.devices[0];
    const safety: SafetyContext = {
      deviceOnline: realtimeState.status === 'online',
      manualStop: null,
      enabledActuatorCodes: assignment.zone.devices[0]?.actuators.filter(({ zoneId }) => zoneId === null || zoneId === assignment.zoneId).map(({ code }) => code) ?? [],
    };
    const decision = evaluated.status === 'BLOCKED'
      ? { status: 'BLOCKED' as const, selected: null, reasons: evaluated.reasons }
      : resolveDecision(evaluated.candidates, safety);
    const telemetryKey = input.seq !== undefined
      ? `seq:${input.seq}`
      : input.ts !== undefined
        ? `ts:${input.ts}`
        : `payload:${configChecksum(input.sensors.slice().sort((a, b) => a.code.localeCompare(b.code)))}`;
    const decisionKey = createHash('sha256').update([deviceMqttId, assignment.id, ruleSet.id, telemetryKey].join('|')).digest('hex');
    const existing = await this.prisma.zoneDecision.findUnique({ where: { decisionKey } });
    if (existing) return existing;
    try {
      return await this.prisma.zoneDecision.create({ data: {
        id: randomUUID(), decisionKey, organizationId: assignment.organizationId, zoneId: assignment.zoneId,
        assignmentId: assignment.id, plantProfileVersionId: assignment.plantProfileVersionId, ruleSetId: ruleSet.id,
        deviceMqttId, telemetryAt: new Date(telemetryAt), status: decision.status,
        candidates: json(evaluated.candidates), selected: decision.selected ? json(decision.selected) : Prisma.JsonNull,
        reasons: json([...evaluated.reasons, ...decision.reasons]),
      } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return this.prisma.zoneDecision.findUniqueOrThrow({ where: { decisionKey } });
    }
  }

  async listDecisions(organizationId: string, actor: AuthenticatedUser) {
    await this.authorization.getMembership(actor.id, organizationId);
    return this.prisma.zoneDecision.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 100, include: { feedback: true } });
  }

  async addFeedback(organizationId: string, decisionId: string, feedback: string, details: unknown, actor: AuthenticatedUser) {
    await this.authorization.getMembership(actor.id, organizationId);
    if (!MANUAL_REVIEW_FEEDBACK.includes(feedback as typeof MANUAL_REVIEW_FEEDBACK[number])) throw new UnprocessableEntityException('Unsupported decision feedback');
    return this.prisma.$transaction(async (tx) => {
      await this.lockMember(tx, actor.id, organizationId);
      const decision = await tx.zoneDecision.findFirst({ where: { id: decisionId, organizationId } });
      if (!decision) throw new NotFoundException('Decision not found');
      const saved = await tx.zoneDecisionFeedback.create({ data: { decisionId, feedback, details: details === undefined ? Prisma.JsonNull : json(details) } });
      await tx.plantConfigAuditEvent.create({ data: { organizationId, actorUserId: actor.id, action: 'ZONE_DECISION_FEEDBACK', entityType: 'ZoneDecision', entityId: decisionId, details: json({ feedback, feedbackId: saved.id }) } });
      return saved;
    });
  }

  private async lockManager(tx: Prisma.TransactionClient, userId: string, organizationId: string) {
    const role = await this.lockMember(tx, userId, organizationId);
    if (role !== UserRole.OWNER && role !== UserRole.ADMIN) throw new ForbiddenException('OWNER or ADMIN organization membership required');
  }

  private async lockMember(tx: Prisma.TransactionClient, userId: string, organizationId: string) {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${userId} AND "isActive" = TRUE FOR SHARE`;
    if (!users[0]) throw new ForbiddenException('Active user account required');
    const memberships = await tx.$queryRaw<Array<{ role: string }>>`SELECT "role" FROM "organization_memberships" WHERE "userId" = ${userId} AND "organizationId" = ${organizationId} FOR SHARE`;
    if (!memberships[0]) throw new ForbiddenException('Organization membership required');
    return memberships[0].role;
  }
}
