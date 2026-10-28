import { BadGatewayException, ConflictException, Inject, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PlantProfileVersionStatus, PlantVersionStatus, ScientificEvidenceVerificationStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlantProposalsService } from './plant-evidence.service.js';
import { validatePlantAiProposal } from './plant-proposal.contract.js';
import { PLANT_RECOMMENDATION_PROVIDER } from './plant-recommendation-provider.js';
import type { PlantRecommendationProvider } from './plant-recommendation-provider.js';

type EvidenceSnapshot = {
  id: string;
  contract: Record<string, unknown>;
};

const RECOMMENDATION_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          parameterKey: { type: 'string' },
          reportedRecommendation: {
            anyOf: [
              { type: 'number' }, { type: 'integer' }, { type: 'string' }, { type: 'boolean' },
              { type: 'object', additionalProperties: { anyOf: [{ type: 'number' }, { type: 'integer' }, { type: 'string' }, { type: 'boolean' }] } },
            ],
          },
          unit: { type: 'string' },
          evidenceReferences: { type: 'array', items: { type: 'string' } },
          uncertainty: { type: 'string', enum: ['LOW', 'MODERATE', 'HIGH', 'UNKNOWN'] },
          rationale: { type: 'string' },
        },
        required: ['parameterKey', 'reportedRecommendation', 'unit', 'evidenceReferences', 'uncertainty', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['recommendations'],
  additionalProperties: false,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function valueField(source: Record<string, unknown>, key: string): unknown {
  const field = record(source[key]);
  return field.state === 'VALUE' ? field.value : undefined;
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase().replace(/[.\s]+$/g, '') : '';
}

@Injectable()
export class PlantAiRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly proposals: PlantProposalsService,
    @Inject(PLANT_RECOMMENDATION_PROVIDER) private readonly provider: PlantRecommendationProvider,
  ) {}

  async recommend(organizationId: string, profileId: string, profileVersionId: string, growthStageId: string, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, [UserRole.OWNER, UserRole.ADMIN]);
    const version = await this.prisma.plantProfileVersion.findFirst({
      where: { id: profileVersionId, organizationId, plantProfileId: profileId, status: PlantProfileVersionStatus.VALIDATED },
      include: {
        plantProfile: { include: { plantCatalog: true } },
        sourceCatalogVersion: { include: { parameterDefinitions: true } },
        growthStages: { where: { id: growthStageId }, include: { parameterConfig: true } },
      },
    });
    if (!version || version.growthStages.length !== 1) throw new UnprocessableEntityException('Choose a validated profile version and one of its growth stages');
    if (version.sourceCatalogVersion.status !== PlantVersionStatus.PUBLISHED) throw new ConflictException('A published source Plant Standard is required');

    const stage = version.growthStages[0];
    const catalog = version.plantProfile.plantCatalog;
    const parameterDefinitions = version.sourceCatalogVersion.parameterDefinitions;
    const parameterKeys = new Set(parameterDefinitions.map((definition) => definition.parameterKey));
    if (parameterDefinitions.length === 0) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        proposal: null,
        evidence: [],
        completeness: { verifiedEvidenceCount: 0, parametersWithEvidence: 0, totalParameters: 0, missingParameters: [] },
        findings: [{
          code: 'NO_PUBLISHED_PARAMETERS',
          field: 'sourceCatalogVersion.parameterDefinitions',
          explanation: `The validated profile is pinned to published Plant Standard v${version.sourceCatalogVersion.version}, which defines no parameters. Add parameter definitions to a catalog draft, publish it, then create and validate a profile version from that published version.`,
        }],
      };
    }

    const evidenceRows = await this.prisma.plantScientificEvidence.findMany({
      where: {
        OR: [
          { organizationId },
          { organizationId: null, verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED },
        ],
      },
      select: { id: true, contract: true, verificationStatus: true },
    });
    const cropNames = new Set([normalize(catalog.scientificName), normalize(catalog.commonName)].filter(Boolean));
    const definitionsByKey = new Map(parameterDefinitions.map((definition) => [definition.parameterKey, definition]));
    const rejectionCounts = new Map<string, number>();
    const reject = (code: string) => rejectionCounts.set(code, (rejectionCounts.get(code) ?? 0) + 1);
    const relevantEvidence: EvidenceSnapshot[] = evidenceRows.flatMap((row) => {
      const contract = record(row.contract);
      const crop = normalize(valueField(contract, 'crop'));
      const stageName = normalize(valueField(contract, 'growthStage'));
      const evidenceCultivar = normalize(valueField(contract, 'cultivar'));
      const key = valueField(contract, 'parameterKey');
      if (row.verificationStatus !== ScientificEvidenceVerificationStatus.VERIFIED) {
        reject('EVIDENCE_UNVERIFIED');
        return [];
      }
      if (!cropNames.has(crop)) {
        reject('EVIDENCE_CROP_MISMATCH');
        return [];
      }
      const cultivarMatches = catalog.cultivar
        ? evidenceCultivar === normalize(catalog.cultivar)
        : !evidenceCultivar;
      if (!cultivarMatches) {
        reject('EVIDENCE_CULTIVAR_MISMATCH');
        return [];
      }
      if (stageName !== normalize(stage.code) && stageName !== normalize(stage.label)) {
        reject('EVIDENCE_STAGE_MISMATCH');
        return [];
      }
      if (typeof key !== 'string' || !parameterKeys.has(key)) {
        reject('EVIDENCE_PARAMETER_MISMATCH');
        return [];
      }
      const definition = definitionsByKey.get(key);
      if (!definition || valueField(contract, 'unit') !== definition.unit) {
        reject('EVIDENCE_UNIT_MISMATCH');
        return [];
      }
      return [{ id: row.id, contract }];
    });
    const coveredParameterKeys = new Set(relevantEvidence.map((item) => valueField(item.contract, 'parameterKey')));
    const missingParameters = [...parameterKeys].filter((key) => !coveredParameterKeys.has(key));
    const rejectionDescriptions: Record<string, string> = {
      EVIDENCE_UNVERIFIED: 'not explicitly verified',
      EVIDENCE_CROP_MISMATCH: 'crop does not match the catalog',
      EVIDENCE_CULTIVAR_MISMATCH: 'cultivar does not match the catalog',
      EVIDENCE_STAGE_MISMATCH: 'growth stage does not match the selected stage',
      EVIDENCE_PARAMETER_MISMATCH: 'parameter is not defined by the pinned Plant Standard',
      EVIDENCE_UNIT_MISMATCH: 'unit does not exactly match the published parameter unit',
    };
    const retrievalFindings = [...rejectionCounts].map(([code, count]) => ({
      code,
      field: 'evidence',
      explanation: `${count} evidence record(s) were excluded: ${rejectionDescriptions[code] ?? 'not applicable'}.`,
    }));

    const evidenceSummary = relevantEvidence.map(({ id, contract }) => ({
      evidenceId: id,
      parameterKey: valueField(contract, 'parameterKey'),
      reportedValue: valueField(contract, 'reportedValue'),
      unit: valueField(contract, 'unit'),
      findingSummary: valueField(contract, 'findingSummary'),
      source: {
        title: valueField(contract, 'title'),
        doi: valueField(contract, 'doi'),
        canonicalUrl: valueField(contract, 'canonicalUrl'),
        publicationYear: valueField(contract, 'publicationYear'),
      },
    }));
    if (relevantEvidence.length === 0) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        proposal: null,
        evidence: evidenceSummary,
        completeness: { verifiedEvidenceCount: relevantEvidence.length, parametersWithEvidence: coveredParameterKeys.size, totalParameters: parameterKeys.size, missingParameters },
        findings: [
          { code: 'INCOMPLETE_EVIDENCE', field: 'evidence', explanation: missingParameters.length ? `No verified, stage-specific evidence matches this crop, stage, parameter, and unit. Missing parameters: ${missingParameters.join(', ')}.` : 'No verified, stage-specific evidence matches this crop, stage, parameter, and unit.' },
          ...retrievalFindings,
        ],
      };
    }
    if (!this.provider.isConfigured()) {
      throw new ServiceUnavailableException({ code: 'LLM_PROVIDER_NOT_CONFIGURED', message: 'Gemini recommendation provider is not configured' });
    }

    const prompt = {
      task: 'Return JSON only: {"recommendations":[{"parameterKey":"...","reportedRecommendation":number|string|object,"unit":"...","evidenceReferences":["evidenceId"],"uncertainty":"LOW|MODERATE|HIGH|UNKNOWN","rationale":"..."}]}. Use only supplied evidence and IDs. Do not infer missing setpoints. Omit parameters with insufficient evidence. Do not return markdown.',
      crop: { scientificName: catalog.scientificName, commonName: catalog.commonName },
      growthStage: { code: stage.code, label: stage.label },
      parameters: parameterDefinitions.map(({ parameterKey, label, dataType, unit, valueSchema }) => ({ parameterKey, label, dataType, unit, valueSchema })),
      verifiedEvidence: evidenceSummary,
    };
    const generated = await this.provider.generateJson(prompt, RECOMMENDATION_OUTPUT_SCHEMA);
    const parsed = this.parseRecommendation(generated);
    const evidenceById = new Map(relevantEvidence.map((item) => [item.id, item]));
    const allowedKeys = new Set(parameterDefinitions.map((item) => item.parameterKey));
    if (parsed.some((item) => !allowedKeys.has(item.parameterKey))) {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned a parameter outside the published Plant Standard' });
    }
    const findings: Array<Record<string, unknown>> = [];
    findings.push({ code: 'MISSING_APPLICABILITY', severity: 'WARNING', field: 'growingSystem', explanation: 'Plant Profile does not define a growing system; confirm this applicability during human review.', evidenceReferences: [] });
    const defaults = record(version.sourceCatalogVersion.profileDefaults);
    const stageTemplates = Array.isArray(version.sourceCatalogVersion.stageTemplates) ? version.sourceCatalogVersion.stageTemplates.map((item) => record(item)) : [];
    const stageTemplate = stageTemplates.find((item) => normalize(item.code) === normalize(stage.code));
    const stageConfig = { ...record(stageTemplate?.config) };
    const proposedDefinitions = parameterDefinitions.map((definition) => {
      const recommendation = parsed.find((item) => item.parameterKey === definition.parameterKey);
      const refs = recommendation?.evidenceReferences ?? [];
      const citedEvidence = refs.map((id) => evidenceById.get(id)).filter((item): item is EvidenceSnapshot => Boolean(item));
      const validRefs = refs.filter((id) => {
        const evidenceItem = evidenceById.get(id);
        return evidenceItem
          && valueField(evidenceItem.contract, 'parameterKey') === definition.parameterKey
          && (!definition.unit || valueField(evidenceItem.contract, 'unit') === definition.unit)
          && recommendation?.unit === valueField(evidenceItem.contract, 'unit');
      });
      const directlyReported = Boolean(recommendation && validRefs.some((id) => {
        const evidenceItem = evidenceById.get(id);
        return evidenceItem
          && valueField(evidenceItem.contract, 'parameterKey') === definition.parameterKey
          && valueField(evidenceItem.contract, 'unit') === recommendation.unit
          && JSON.stringify(valueField(evidenceItem.contract, 'reportedValue')) === JSON.stringify(recommendation.reportedRecommendation);
      }));
      if (recommendation && citedEvidence.some((item) => valueField(item.contract, 'unit') !== recommendation.unit || definition.unit && valueField(item.contract, 'unit') !== definition.unit)) {
        findings.push({ code: 'MISSING_UNIT', severity: 'WARNING', field: `parameterDefinitions/${definition.parameterKey}/unit`, parameterKey: definition.parameterKey, explanation: 'Recommendation/evidence units do not exactly match the published parameter unit; conversion is not inferred.', evidenceReferences: citedEvidence.map((item) => item.id) });
      }
      if (recommendation && validRefs.length !== refs.length) {
        findings.push({ code: 'EVIDENCE_NOT_VERIFIED', severity: 'ERROR', field: `parameterDefinitions/${definition.parameterKey}`, parameterKey: definition.parameterKey, explanation: 'Provider returned an unknown parameter or evidence reference outside the verified retrieval set.', evidenceReferences: [] });
      }
      if (recommendation && validRefs.length === 0) findings.push({ code: 'INCOMPLETE_EVIDENCE', severity: 'WARNING', field: `parameterDefinitions/${definition.parameterKey}`, parameterKey: definition.parameterKey, explanation: 'Recommendation has no usable verified evidence citation.', evidenceReferences: [] });
      if (recommendation && validRefs.length > 0 && !directlyReported) findings.push({ code: 'UNSUPPORTED_CLAIM', severity: 'WARNING', field: `parameterDefinitions/${definition.parameterKey}`, parameterKey: definition.parameterKey, explanation: 'The AI candidate is not an exact value reported by its cited sources; it is retained for human consideration and is not written into the catalog configuration.', evidenceReferences: validRefs });
      if (!recommendation) findings.push({ code: 'INCOMPLETE_EVIDENCE', severity: 'WARNING', field: `parameterDefinitions/${definition.parameterKey}`, parameterKey: definition.parameterKey, explanation: 'No recommendation was returned for this parameter; existing standard values are preserved.', evidenceReferences: [] });
      const evidenceForParameter = relevantEvidence.filter((item) => valueField(item.contract, 'parameterKey') === definition.parameterKey);
      const numeric = evidenceForParameter.filter((item) => typeof valueField(item.contract, 'reportedValue') === 'number' || isNumericRange(valueField(item.contract, 'reportedValue')));
      const conflict = numeric.some((a, index) => numeric.slice(index + 1).some((b) => rangesConflict(valueField(a.contract, 'reportedValue'), valueField(b.contract, 'reportedValue'), valueField(a.contract, 'unit'), valueField(b.contract, 'unit'))));
      if (conflict) findings.push({ code: 'CONFLICTING_EVIDENCE', severity: 'WARNING', field: `parameterDefinitions/${definition.parameterKey}`, parameterKey: definition.parameterKey, explanation: 'Verified sources report incompatible numeric ranges; human review is required.', evidenceReferences: evidenceForParameter.map((item) => item.id).slice(0, 20) });
      if (recommendation && validRefs.length && directlyReported) {
        stageConfig[definition.parameterKey] = recommendation.reportedRecommendation;
      }
      const recommendationSummary = recommendation
        ? directlyReported
          ? recommendation.rationale ?? `Exact reported source value: ${JSON.stringify(recommendation.reportedRecommendation)} ${recommendation.unit}.`
          : `AI candidate ${JSON.stringify(recommendation.reportedRecommendation)} ${recommendation.unit} was not reported exactly by the cited source and is not applied to the standard configuration.${recommendation.rationale ? ` Rationale: ${recommendation.rationale}` : ''}`
        : undefined;
      return {
        parameterKey: definition.parameterKey, label: definition.label, dataType: definition.dataType,
        ...(definition.unit ? { unit: definition.unit } : {}), valueSchema: record(definition.valueSchema),
        ...(recommendationSummary ? { biologicalRecommendation: { summary: recommendationSummary } } : {}),
        applicability: { crop: { state: 'VALUE', value: catalog.scientificName }, cultivar: catalog.cultivar ? { state: 'VALUE', value: catalog.cultivar } : { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: stage.code }, growingSystem: { state: 'UNKNOWN' } },
        evidenceReferences: validRefs,
        uncertainty: { level: recommendation?.uncertainty ?? 'UNKNOWN', ...(recommendation?.rationale ? { explanation: recommendation.rationale } : {}) },
        reviewStatus: conflict || !recommendation || validRefs.length === 0 || !directlyReported || recommendation.uncertainty === 'HIGH' || recommendation.uncertainty === 'UNKNOWN' ? 'NEEDS_REVIEW' : 'SUPPORTED',
      };
    });
    if (findings.some((item) => item.severity === 'ERROR')) throw new BadGatewayException({ code: 'LLM_RECOMMENDATION_REJECTED', message: 'Gemini output failed evidence and applicability checks', findings });

    const timestamp = new Date().toISOString();
    const refs = [...new Set([
      ...proposedDefinitions.flatMap((definition) => definition.evidenceReferences),
      ...findings.flatMap((finding) => Array.isArray(finding.evidenceReferences) ? finding.evidenceReferences as string[] : []),
    ])];
    const proposalContract = {
      proposalId: randomUUID(), organizationId, plantCatalogId: catalog.id, targetIntent: 'CREATE_DRAFT' as const,
      cropIdentity: { scientificName: catalog.scientificName, commonName: catalog.commonName, ...(catalog.cultivar ? { cultivar: catalog.cultivar } : {}) }, growingSystem: { state: 'UNKNOWN' as const },
      environmentalAssumptions: [], parameterDefinitions: proposedDefinitions,
      profileDefaults: defaults,
      stageTemplates: stageTemplates.map((template) => template.code === stage.code ? { ...template, config: stageConfig } : template),
      edgeRequirements: record(version.sourceCatalogVersion.edgeCompatibility), evidenceReferences: refs,
      validationFindings: findings, unresolvedQuestions: findings.length ? ['Review missing, conflicting, or unit-mismatched parameter evidence before applying this proposal.'] : [],
      provider: { name: this.provider.getName(), ...(this.provider.getModel() ? { model: this.provider.getModel() } : {}) }, createdAt: timestamp, updatedAt: timestamp, status: 'PROPOSED' as const,
    };
    const contractValidation = validatePlantAiProposal(proposalContract);
    if (!contractValidation.valid) throw new BadGatewayException({ code: 'LLM_RECOMMENDATION_REJECTED', message: 'Gemini output failed Plant Standard validation', findings: contractValidation.findings });
    const proposal = await this.proposals.create(organizationId, proposalContract, actor);
    return { status: 'PROPOSAL_CREATED', proposal, evidence: evidenceSummary, completeness: { verifiedEvidenceCount: relevantEvidence.length, parametersWithEvidence: coveredParameterKeys.size, totalParameters: parameterKeys.size, missingParameters }, findings: [...contractValidation.findings, ...retrievalFindings] };
  }

  private parseRecommendation(value: unknown): Array<{ parameterKey: string; reportedRecommendation: unknown; evidenceReferences: string[]; unit: string; uncertainty: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN'; rationale?: string }> {
    const items = record(value).recommendations;
    if (!Array.isArray(items)) throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini response does not match the recommendation schema' });
    return items.map((raw) => {
      const item = record(raw);
      if (typeof item.parameterKey !== 'string' || typeof item.unit !== 'string' || !Array.isArray(item.evidenceReferences) || !item.evidenceReferences.every((id) => typeof id === 'string') || !['LOW', 'MODERATE', 'HIGH', 'UNKNOWN'].includes(String(item.uncertainty)) || typeof item.rationale !== 'string' || !isJsonScalarOrObject(item.reportedRecommendation)) throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini response failed recommendation structural validation' });
      return { parameterKey: item.parameterKey, reportedRecommendation: item.reportedRecommendation, evidenceReferences: item.evidenceReferences as string[], unit: item.unit, uncertainty: item.uncertainty as 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN', ...(typeof item.rationale === 'string' ? { rationale: item.rationale } : {}) };
    });
  }
}

function isJsonScalarOrObject(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean');
}

function isNumericRange(value: unknown): value is { minimum: number; maximum: number } {
  const item = record(value);
  return typeof item.minimum === 'number' && typeof item.maximum === 'number';
}

function numericBounds(value: unknown): [number, number] | null {
  if (typeof value === 'number' && Number.isFinite(value)) return [value, value];
  if (isNumericRange(value)) return [value.minimum, value.maximum];
  return null;
}

function rangesConflict(a: unknown, b: unknown, unitA: unknown, unitB: unknown): boolean {
  if (!unitA || unitA !== unitB) return false;
  const boundsA = numericBounds(a); const boundsB = numericBounds(b);
  return Boolean(boundsA && boundsB && (boundsA[1] < boundsB[0] || boundsB[1] < boundsA[0]));
}
