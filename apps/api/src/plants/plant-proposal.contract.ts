import { assertSchema2020, buildParameterObjectSchema, validatePlantLayer } from './plant-config.js';

export type EvidenceField<T> =
  | { state: 'VALUE'; value: T }
  | { state: 'UNKNOWN' | 'NOT_REPORTED' | 'NOT_APPLICABLE' };

export type EvidenceVerificationStatus = 'UNKNOWN' | 'UNVERIFIED' | 'VERIFIED';
export type EvidenceQuality = 'HIGH' | 'MODERATE' | 'LOW' | 'NOT_ASSESSED';

export interface ScientificEvidenceRecord {
  evidenceId: string;
  sourceId?: string;
  title: EvidenceField<string>;
  authors: EvidenceField<string[]>;
  publicationYear: EvidenceField<number>;
  doi: EvidenceField<string>;
  canonicalUrl: EvidenceField<string>;
  publisherOrJournal: EvidenceField<string>;
  publicationType: EvidenceField<string>;
  retrievedAt: string;
  crop: EvidenceField<string>;
  cultivar: EvidenceField<string>;
  growthStage: EvidenceField<string>;
  growingSystem: EvidenceField<string>;
  parameterKey: EvidenceField<string>;
  reportedValue: EvidenceField<number | string | { minimum: number; maximum: number }>;
  unit: EvidenceField<string>;
  experimentalContext: EvidenceField<string>;
  limitations: EvidenceField<string>;
  findingSummary: EvidenceField<string>;
  extraction: {
    method: 'MANUAL' | 'RULE_BASED' | 'LLM' | 'SOURCE_METADATA';
    extractedAt: string;
    locator?: string;
    toolVersion?: string;
  };
  quality: EvidenceQuality;
  verificationStatus: EvidenceVerificationStatus;
}

export type ValidationSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type ValidationFindingCode =
  | 'SCHEMA_INVALID' | 'MISSING_UNIT' | 'UNSUPPORTED_CLAIM' | 'CONFLICTING_EVIDENCE'
  | 'MISSING_APPLICABILITY' | 'INVALID_RANGE' | 'INCOMPLETE_EVIDENCE'
  | 'EDGE_CAPABILITY_MISMATCH' | 'HUMAN_REVIEW_REQUIRED' | 'DUPLICATE_PARAMETER_KEY'
  | 'MISSING_EVIDENCE_REFERENCE' | 'EVIDENCE_NOT_VERIFIED';

export interface ValidationFinding {
  code: ValidationFindingCode;
  severity: ValidationSeverity;
  field: string;
  parameterKey?: string;
  explanation: string;
  evidenceReferences: string[];
  remediation?: string;
}

export interface NumericRange {
  minimum: number;
  maximum: number;
  unit: string;
}

export interface PlantProposalParameter {
  parameterKey: string;
  label: string;
  dataType: string;
  unit?: string;
  valueSchema: Record<string, unknown>;
  recommendedOperatingRange?: NumericRange;
  biologicalRecommendation?: { summary: string; range?: NumericRange };
  hardwareSafetyLimit?: { minimum?: number; maximum?: number; unit: string; basis: string };
  applicability: {
    crop: EvidenceField<string>;
    cultivar: EvidenceField<string>;
    growthStage: EvidenceField<string>;
    growingSystem: EvidenceField<string>;
  };
  evidenceReferences: string[];
  uncertainty: { level: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN'; explanation?: string };
  reviewStatus: 'SUPPORTED' | 'UNVERIFIED' | 'NEEDS_REVIEW';
}

export type ProposalWorkflowStatus =
  | 'REQUESTED' | 'RESEARCH_PENDING' | 'PROPOSED' | 'NEEDS_REVIEW' | 'INVALID' | 'APPROVED' | 'REJECTED';

export interface PlantAiProposalContract {
  proposalId: string;
  organizationId: string;
  plantCatalogId: string;
  targetCatalogVersionId?: string;
  targetIntent: 'CREATE_DRAFT' | 'UPDATE_DRAFT' | 'RESEARCH_ONLY';
  cropIdentity: { scientificName: string; commonName: string; cultivar?: string };
  growingSystem: EvidenceField<string>;
  environmentalAssumptions: Array<{ key: string; value: string | number; unit?: string; evidenceReferences: string[] }>;
  parameterDefinitions: PlantProposalParameter[];
  profileDefaults: Record<string, unknown>;
  stageTemplates: Array<{ code: string; label: string; sequence: number; config: Record<string, unknown> }>;
  edgeRequirements: Record<string, unknown>;
  evidenceReferences: string[];
  validationFindings: ValidationFinding[];
  unresolvedQuestions: string[];
  provider?: { name: string; model?: string; version?: string };
  createdAt: string;
  updatedAt: string;
  status: ProposalWorkflowStatus;
}

export interface ContractValidationResult {
  valid: boolean;
  status: 'READY_FOR_REVIEW' | 'NEEDS_REVIEW' | 'INVALID';
  findings: ValidationFinding[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const DATA_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;
const FINDING_CODES: readonly ValidationFindingCode[] = [
  'SCHEMA_INVALID', 'MISSING_UNIT', 'UNSUPPORTED_CLAIM', 'CONFLICTING_EVIDENCE', 'MISSING_APPLICABILITY',
  'INVALID_RANGE', 'INCOMPLETE_EVIDENCE', 'EDGE_CAPABILITY_MISMATCH', 'HUMAN_REVIEW_REQUIRED',
  'DUPLICATE_PARAMETER_KEY', 'MISSING_EVIDENCE_REFERENCE', 'EVIDENCE_NOT_VERIFIED',
];
const SEVERITIES: readonly ValidationSeverity[] = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validEvidenceField(field: unknown): field is EvidenceField<string> {
  return fieldIsWellFormed(field, (value): value is string => nonEmptyString(value));
}

function isJsonValue(value: unknown, depth = 0, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 64 || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, depth + 1, ancestors))
    : isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1, ancestors));
  ancestors.delete(value);
  return valid;
}

function validateRangeAgainstSchema(range: NumericRange, schema: Record<string, unknown>, dataType: string): string | undefined {
  if (!['number', 'integer'].includes(dataType) || schema.type !== dataType) return 'Ranges are supported only for number or integer parameter schemas.';
  const supported = new Set(['$schema', 'type', 'title', 'description', 'default', 'examples', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']);
  if (Object.keys(schema).some((key) => !supported.has(key))) return 'Range cannot be safely checked against this complex valueSchema.';
  if (dataType === 'integer' && (!Number.isInteger(range.minimum) || !Number.isInteger(range.maximum))) return 'Integer parameter ranges must have integer bounds.';
  const lowerBounds = [schema.minimum, schema.exclusiveMinimum].filter((bound): bound is number => typeof bound === 'number');
  const upperBounds = [schema.maximum, schema.exclusiveMaximum].filter((bound): bound is number => typeof bound === 'number');
  const lower = lowerBounds.length ? Math.max(...lowerBounds) : undefined;
  const lowerExclusive = typeof schema.exclusiveMinimum === 'number' && schema.exclusiveMinimum === lower;
  const upper = upperBounds.length ? Math.min(...upperBounds) : undefined;
  const upperExclusive = typeof schema.exclusiveMaximum === 'number' && schema.exclusiveMaximum === upper;
  if (typeof lower === 'number' && (range.minimum < lower || (lowerExclusive && range.minimum === lower))) return 'Range minimum falls outside valueSchema bounds.';
  if (typeof upper === 'number' && (range.maximum > upper || (upperExclusive && range.maximum === upper))) return 'Range maximum falls outside valueSchema bounds.';
  if (typeof lower === 'number' && typeof upper === 'number' && (lower > upper || (lower === upper && (lowerExclusive || upperExclusive)))) return 'valueSchema defines an empty numeric range.';
  return undefined;
}

function fieldIsWellFormed<T>(field: unknown, valueCheck: (value: unknown) => value is T): field is EvidenceField<T> {
  if (!isRecord(field)) return false;
  if (field.state === 'VALUE') return Object.hasOwn(field, 'value') && valueCheck(field.value);
  return ['UNKNOWN', 'NOT_REPORTED', 'NOT_APPLICABLE'].includes(String(field.state)) && !Object.hasOwn(field, 'value');
}

function finding(
  code: ValidationFindingCode,
  severity: ValidationSeverity,
  field: string,
  explanation: string,
  options: Partial<Pick<ValidationFinding, 'parameterKey' | 'evidenceReferences' | 'remediation'>> = {},
): ValidationFinding {
  return { code, severity, field, explanation, evidenceReferences: [], ...options };
}

export function validateScientificEvidence(input: unknown): ContractValidationResult {
  const findings: ValidationFinding[] = [];
  if (!isRecord(input)) {
    return { valid: false, status: 'INVALID', findings: [finding('SCHEMA_INVALID', 'ERROR', '/', 'Evidence record must be an object.')] };
  }
  const allowedEvidenceKeys = [
    'evidenceId', 'sourceId', 'title', 'authors', 'publicationYear', 'doi', 'canonicalUrl', 'publisherOrJournal',
    'publicationType', 'retrievedAt', 'crop', 'cultivar', 'growthStage', 'growingSystem', 'parameterKey',
    'reportedValue', 'unit', 'experimentalContext', 'limitations', 'findingSummary', 'extraction', 'quality', 'verificationStatus',
  ];
  if (!hasOnlyKeys(input, allowedEvidenceKeys)) findings.push(finding('SCHEMA_INVALID', 'ERROR', '/', 'Evidence contains unknown properties.'));
  const requiredFieldKeys = [
    'title', 'authors', 'publicationYear', 'doi', 'canonicalUrl', 'publisherOrJournal', 'publicationType',
    'crop', 'cultivar', 'growthStage', 'growingSystem', 'parameterKey', 'reportedValue', 'unit',
    'experimentalContext', 'limitations', 'findingSummary',
  ];
  const goodField = (key: string): boolean => {
    const val = input[key];
    if (key === 'authors') return fieldIsWellFormed(val, (v): v is string[] => Array.isArray(v) && v.every(nonEmptyString));
    if (key === 'publicationYear') return fieldIsWellFormed(val, (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 9999);
    if (key === 'reportedValue') return fieldIsWellFormed(val, (v): v is number | string | { minimum: number; maximum: number } =>
      (typeof v === 'number' && Number.isFinite(v)) || nonEmptyString(v) ||
      (isRecord(v) && hasOnlyKeys(v, ['minimum', 'maximum']) && typeof v.minimum === 'number' && Number.isFinite(v.minimum) && typeof v.maximum === 'number' && Number.isFinite(v.maximum) && v.minimum <= v.maximum));
    return fieldIsWellFormed(val, (v): v is string => typeof v === 'string');
  };
  for (const key of requiredFieldKeys) {
    if (!goodField(key)) findings.push(finding('SCHEMA_INVALID', 'ERROR', key, `Evidence field '${key}' has an invalid status or value.`));
  }
  for (const key of ['parameterKey', 'reportedValue', 'findingSummary']) {
    const field = input[key];
    if (!fieldIsWellFormed(field, key === 'reportedValue'
      ? (value): value is number | string | { minimum: number; maximum: number } => typeof value === 'number' || nonEmptyString(value) || (isRecord(value) && hasOnlyKeys(value, ['minimum', 'maximum']) && typeof value.minimum === 'number' && Number.isFinite(value.minimum) && typeof value.maximum === 'number' && Number.isFinite(value.maximum) && value.minimum <= value.maximum)
      : (value): value is string => nonEmptyString(value)) || field.state !== 'VALUE') {
      findings.push(finding('INCOMPLETE_EVIDENCE', 'ERROR', key, `A structured scientific finding requires '${key}' to have a nonempty VALUE.`));
    }
  }
  if (typeof input.evidenceId !== 'string' || !ID_PATTERN.test(input.evidenceId)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'evidenceId', 'A stable evidence ID is required.'));
  if (input.sourceId !== undefined && (typeof input.sourceId !== 'string' || !ID_PATTERN.test(input.sourceId))) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'sourceId', 'A supplied sourceId must be a valid registered source ID.'));
  if (typeof input.retrievedAt !== 'string' || !validDate(input.retrievedAt)) findings.push(finding('MISSING_EVIDENCE_REFERENCE', 'ERROR', 'retrievedAt', 'A valid retrieval timestamp is required.'));
  const extraction = input.extraction;
  if (!isRecord(extraction) || !hasOnlyKeys(extraction, ['method', 'extractedAt', 'locator', 'toolVersion']) || !['MANUAL', 'RULE_BASED', 'LLM', 'SOURCE_METADATA'].includes(String(extraction.method)) || typeof extraction.extractedAt !== 'string' || !validDate(extraction.extractedAt) || ['locator', 'toolVersion'].some((key) => extraction && extraction[key] !== undefined && !nonEmptyString(extraction[key]))) {
    findings.push(finding('MISSING_EVIDENCE_REFERENCE', 'ERROR', 'extraction', 'Extraction method and timestamp are required to preserve provenance.'));
  } else if (extraction.method === 'SOURCE_METADATA') {
    findings.push(finding('INCOMPLETE_EVIDENCE', 'WARNING', 'extraction/method', 'Publication metadata alone is not a structured scientific finding and cannot support a verified claim.'));
  }
  const canonicalUrl = input.canonicalUrl;
  const hasUrl = fieldIsWellFormed(canonicalUrl, (v): v is string => typeof v === 'string') && canonicalUrl.state === 'VALUE' && /^https?:\/\//i.test(canonicalUrl.value);
  const hasSource = typeof input.sourceId === 'string' && ID_PATTERN.test(input.sourceId);
  if (!hasUrl && !hasSource) findings.push(finding('MISSING_EVIDENCE_REFERENCE', 'ERROR', 'sourceId', 'Provide a registered source ID or an HTTP(S) canonical source URL.'));
  const parameterKey = input.parameterKey;
  const reportedValue = input.reportedValue;
  if (fieldIsWellFormed(parameterKey, (v): v is string => typeof v === 'string') && parameterKey.state === 'VALUE'
      && fieldIsWellFormed(reportedValue, (v): v is number | string | { minimum: number; maximum: number } => typeof v === 'number' || typeof v === 'string' || isRecord(v))
      && reportedValue.state === 'VALUE') {
    const numeric = typeof reportedValue.value === 'number' || isRecord(reportedValue.value);
    const unit = input.unit;
    if (numeric && (!fieldIsWellFormed(unit, (v): v is string => typeof v === 'string') || unit.state !== 'VALUE' || !unit.value.trim())) {
      findings.push(finding('MISSING_UNIT', 'WARNING', 'unit', 'A numerical finding needs a reported unit before it can support a configuration.', { parameterKey: parameterKey.value }));
    }
  }
  if (!['UNKNOWN', 'UNVERIFIED', 'VERIFIED'].includes(String(input.verificationStatus))) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'verificationStatus', 'Verification status must be explicit.'));
  else if (input.verificationStatus !== 'VERIFIED') findings.push(finding('EVIDENCE_NOT_VERIFIED', 'WARNING', 'verificationStatus', 'This record is not verified and cannot be presented as scientifically verified.'));
  if (!['HIGH', 'MODERATE', 'LOW', 'NOT_ASSESSED'].includes(String(input.quality))) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'quality', 'Evidence quality must use a supported assessment value.'));
  else if (input.quality === 'NOT_ASSESSED') findings.push(finding('INCOMPLETE_EVIDENCE', 'WARNING', 'quality', 'Evidence quality has not been assessed.'));
  const invalid = findings.some(({ severity }) => severity === 'ERROR' || severity === 'CRITICAL');
  const review = findings.some(({ severity }) => severity === 'WARNING');
  return { valid: !invalid, status: invalid ? 'INVALID' : review ? 'NEEDS_REVIEW' : 'READY_FOR_REVIEW', findings };
}

export function validatePlantAiProposal(input: unknown): ContractValidationResult {
  const findings: ValidationFinding[] = [];
  if (!isRecord(input)) return { valid: false, status: 'INVALID', findings: [finding('SCHEMA_INVALID', 'ERROR', '/', 'Proposal must be an object.')] };
  const requiredTopLevel = [
    'proposalId', 'organizationId', 'plantCatalogId', 'targetIntent', 'cropIdentity', 'growingSystem',
    'environmentalAssumptions', 'parameterDefinitions', 'profileDefaults', 'stageTemplates', 'edgeRequirements',
    'evidenceReferences', 'validationFindings', 'unresolvedQuestions', 'createdAt', 'updatedAt', 'status',
  ];
  const allowedTopLevel = [...requiredTopLevel, 'targetCatalogVersionId', 'provider'];
  if (!hasOnlyKeys(input, allowedTopLevel)) findings.push(finding('SCHEMA_INVALID', 'ERROR', '/', 'Proposal contains unknown properties.'));
  for (const key of requiredTopLevel) if (!Object.hasOwn(input, key)) findings.push(finding('SCHEMA_INVALID', 'ERROR', key, `Required proposal field '${key}' is missing.`));
  for (const key of ['proposalId', 'organizationId', 'plantCatalogId']) {
    if (typeof input[key] !== 'string' || !ID_PATTERN.test(input[key] as string)) findings.push(finding('SCHEMA_INVALID', 'ERROR', key, `A valid ${key} is required.`));
  }
  if (input.targetCatalogVersionId !== undefined && (typeof input.targetCatalogVersionId !== 'string' || !ID_PATTERN.test(input.targetCatalogVersionId))) {
    findings.push(finding('SCHEMA_INVALID', 'ERROR', 'targetCatalogVersionId', 'Target catalog version ID is malformed.'));
  }
  if (!['CREATE_DRAFT', 'UPDATE_DRAFT', 'RESEARCH_ONLY'].includes(String(input.targetIntent))) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'targetIntent', 'Unsupported proposal target intent.'));
  const researchOnly = input.targetIntent === 'RESEARCH_ONLY';
  if (!researchOnly && !input.targetCatalogVersionId && input.targetIntent === 'UPDATE_DRAFT') findings.push(finding('SCHEMA_INVALID', 'ERROR', 'targetCatalogVersionId', 'UPDATE_DRAFT requires a target catalog version.'));
  if (!isRecord(input.cropIdentity) || !hasOnlyKeys(input.cropIdentity, ['scientificName', 'commonName', 'cultivar']) || !nonEmptyString(input.cropIdentity.scientificName) || !nonEmptyString(input.cropIdentity.commonName) || (input.cropIdentity.cultivar !== undefined && !nonEmptyString(input.cropIdentity.cultivar))) {
    findings.push(finding('SCHEMA_INVALID', 'ERROR', 'cropIdentity', 'Crop identity requires nonempty scientificName and commonName, with an optional nonempty cultivar.'));
  }
  if (!validEvidenceField(input.growingSystem)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'growingSystem', 'Growing system must be a valid EvidenceField<string>.'));
  if (typeof input.createdAt !== 'string' || !validDate(input.createdAt) || typeof input.updatedAt !== 'string' || !validDate(input.updatedAt)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'timestamps', 'Created and updated timestamps must be valid dates.'));
  const statuses: ProposalWorkflowStatus[] = ['REQUESTED', 'RESEARCH_PENDING', 'PROPOSED', 'NEEDS_REVIEW', 'INVALID', 'APPROVED', 'REJECTED'];
  if (!statuses.includes(input.status as ProposalWorkflowStatus)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'status', 'Proposal workflow status is invalid.'));

  const referencesAreValid = (value: unknown): value is string[] => Array.isArray(value) && value.every((ref) => typeof ref === 'string' && ID_PATTERN.test(ref));
  if (!Array.isArray(input.environmentalAssumptions)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'environmentalAssumptions', 'Environmental assumptions must be an array.'));
  else for (const [index, assumption] of input.environmentalAssumptions.entries()) {
    const field = `environmentalAssumptions/${index}`;
    if (!isRecord(assumption) || !hasOnlyKeys(assumption, ['key', 'value', 'unit', 'evidenceReferences']) || typeof assumption.key !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(assumption.key) || !(nonEmptyString(assumption.value) || (typeof assumption.value === 'number' && Number.isFinite(assumption.value))) || (assumption.unit !== undefined && !nonEmptyString(assumption.unit)) || !referencesAreValid(assumption.evidenceReferences)) {
      findings.push(finding('SCHEMA_INVALID', 'ERROR', field, 'Environmental assumption requires a stable key, finite string/number value, optional nonempty unit, and valid evidence-reference IDs.'));
    }
  }
  if (!Array.isArray(input.unresolvedQuestions) || !input.unresolvedQuestions.every(nonEmptyString)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'unresolvedQuestions', 'Unresolved questions must be an array of nonempty strings.'));
  if (!isRecord(input.edgeRequirements) || !isJsonValue(input.edgeRequirements)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'edgeRequirements', 'Edge requirements must be a JSON-compatible object with finite numbers and no cyclic values.'));
  if (!referencesAreValid(input.evidenceReferences)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'evidenceReferences', 'Proposal evidence references must be an array of valid evidence IDs.'));
  const proposalEvidenceIds = new Set(referencesAreValid(input.evidenceReferences) ? input.evidenceReferences : []);
  if (Array.isArray(input.environmentalAssumptions)) for (const [index, assumption] of input.environmentalAssumptions.entries()) {
    if (isRecord(assumption) && referencesAreValid(assumption.evidenceReferences)) {
      for (const ref of assumption.evidenceReferences) if (!proposalEvidenceIds.has(ref)) findings.push(finding('MISSING_EVIDENCE_REFERENCE', 'ERROR', `environmentalAssumptions/${index}/evidenceReferences`, `Evidence '${ref}' is absent from the proposal evidence list.`));
    }
  }
  if (!Array.isArray(input.parameterDefinitions)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'parameterDefinitions', 'Parameter definitions must be an array.'));
  if (!isRecord(input.profileDefaults) || !isJsonValue(input.profileDefaults)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'profileDefaults', 'Profile defaults must be a JSON-compatible object.'));
  if (!Array.isArray(input.stageTemplates)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'stageTemplates', 'Stage templates must be an array.'));
  if (!Array.isArray(input.validationFindings)) findings.push(finding('SCHEMA_INVALID', 'ERROR', 'validationFindings', 'Validation findings must be an array.'));
  if (input.provider !== undefined && (!isRecord(input.provider) || !hasOnlyKeys(input.provider, ['name', 'model', 'version']) || !nonEmptyString(input.provider.name) || ['model', 'version'].some((key) => input.provider && (input.provider as Record<string, unknown>)[key] !== undefined && !nonEmptyString((input.provider as Record<string, unknown>)[key])))) {
    findings.push(finding('SCHEMA_INVALID', 'ERROR', 'provider', 'Provider metadata must contain a nonempty name and optional nonempty model/version strings.'));
  }

  const parameters = Array.isArray(input.parameterDefinitions) ? input.parameterDefinitions : [];
  const parameterKeys = new Set<string>();
  const evidenceReferences = proposalEvidenceIds;
  const validatedDefinitions: Array<{ parameterKey: string; valueSchema: unknown }> = [];
  const definitionByKey = new Map<string, { dataType: string; unit?: string; schema: Record<string, unknown> }>();
  for (const [index, raw] of parameters.entries()) {
    const field = `parameterDefinitions/${index}`;
    if (!isRecord(raw) || !hasOnlyKeys(raw, ['parameterKey', 'label', 'dataType', 'unit', 'valueSchema', 'recommendedOperatingRange', 'biologicalRecommendation', 'hardwareSafetyLimit', 'applicability', 'evidenceReferences', 'uncertainty', 'reviewStatus'])) {
      findings.push(finding('SCHEMA_INVALID', 'ERROR', field, 'Parameter proposal is malformed or contains unknown properties.')); continue;
    }
    const key = raw.parameterKey;
    if (typeof key !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key)) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/parameterKey`, 'Parameter key must follow the catalog stable-key convention.'));
    else if (parameterKeys.has(key)) findings.push(finding('DUPLICATE_PARAMETER_KEY', 'ERROR', `${field}/parameterKey`, `Parameter key '${key}' appears more than once.`, { parameterKey: key }));
    else parameterKeys.add(key);
    const hasValidKey = typeof key === 'string' && /^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) && !definitionByKey.has(key);
    if (!nonEmptyString(raw.label) || typeof raw.dataType !== 'string' || !DATA_TYPES.includes(raw.dataType as typeof DATA_TYPES[number]) || !isRecord(raw.valueSchema)) {
      findings.push(finding('SCHEMA_INVALID', 'ERROR', field, 'Parameter label, supported dataType, and value schema are required.', { parameterKey: typeof key === 'string' ? key : undefined }));
    } else {
      try {
        assertSchema2020(raw.valueSchema);
        if (raw.valueSchema.type !== raw.dataType) throw new Error('type mismatch');
        if (hasValidKey) {
          validatedDefinitions.push({ parameterKey: key as string, valueSchema: raw.valueSchema });
          definitionByKey.set(key as string, { dataType: raw.dataType, unit: typeof raw.unit === 'string' ? raw.unit : undefined, schema: raw.valueSchema });
        }
      } catch {
        findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/valueSchema`, 'Value schema must be valid JSON Schema Draft 2020-12, use a supported dataType, and match dataType.', { parameterKey: typeof key === 'string' ? key : undefined }));
      }
    }
    const applicable = isRecord(raw.applicability) ? raw.applicability : {};
    if (!isRecord(raw.applicability) || !hasOnlyKeys(applicable, ['crop', 'cultivar', 'growthStage', 'growingSystem']) || !validEvidenceField(applicable.crop) || !validEvidenceField(applicable.cultivar) || !validEvidenceField(applicable.growthStage) || !validEvidenceField(applicable.growingSystem)) {
      findings.push(finding('MISSING_APPLICABILITY', 'WARNING', `${field}/applicability`, 'Applicability must provide valid crop, cultivar, growthStage, and growingSystem EvidenceFields.', { parameterKey: typeof key === 'string' ? key : undefined }));
    } else if (['crop', 'growthStage', 'growingSystem'].some((part) => !validEvidenceField(applicable[part]) || applicable[part].state !== 'VALUE')) {
      findings.push(finding('MISSING_APPLICABILITY', 'WARNING', `${field}/applicability`, 'Crop, growth stage, and growing system should be known before approval.', { parameterKey: typeof key === 'string' ? key : undefined }));
    }
    if (raw.unit !== undefined && !nonEmptyString(raw.unit)) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/unit`, 'Parameter unit must be a nonempty string when supplied.', { parameterKey: typeof key === 'string' ? key : undefined }));
    if (raw.unit === undefined || typeof raw.unit !== 'string') findings.push(finding('MISSING_UNIT', 'WARNING', `${field}/unit`, 'Parameter unit is missing.', { parameterKey: typeof key === 'string' ? key : undefined }));
    const refs = referencesAreValid(raw.evidenceReferences) ? raw.evidenceReferences : [];
    if (!referencesAreValid(raw.evidenceReferences)) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/evidenceReferences`, 'Parameter evidenceReferences must contain valid evidence IDs.', { parameterKey: typeof key === 'string' ? key : undefined }));
    if (!refs.length) findings.push(finding('UNSUPPORTED_CLAIM', 'WARNING', field, 'No scientific evidence reference supports this proposed parameter.', { parameterKey: typeof key === 'string' ? key : undefined }));
    for (const ref of refs) if (!evidenceReferences.has(ref)) findings.push(finding('MISSING_EVIDENCE_REFERENCE', 'ERROR', `${field}/evidenceReferences`, `Evidence '${ref}' is absent from the proposal evidence list.`, { parameterKey: typeof key === 'string' ? key : undefined }));
    if (!isRecord(raw.uncertainty) || !hasOnlyKeys(raw.uncertainty, ['level', 'explanation']) || !['LOW', 'MODERATE', 'HIGH', 'UNKNOWN'].includes(String(raw.uncertainty.level)) || (raw.uncertainty.explanation !== undefined && !nonEmptyString(raw.uncertainty.explanation))) {
      findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/uncertainty`, 'Uncertainty requires a recognized level and optional nonempty explanation.', { parameterKey: typeof key === 'string' ? key : undefined }));
    }
    if (!['SUPPORTED', 'UNVERIFIED', 'NEEDS_REVIEW'].includes(String(raw.reviewStatus))) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/reviewStatus`, 'Parameter reviewStatus is invalid.', { parameterKey: typeof key === 'string' ? key : undefined }));
    else if (raw.reviewStatus !== 'SUPPORTED') findings.push(finding('HUMAN_REVIEW_REQUIRED', 'WARNING', `${field}/reviewStatus`, 'This parameter is not marked as supported and requires human review.', { parameterKey: typeof key === 'string' ? key : undefined, evidenceReferences: refs }));

    const parameterUnit = typeof raw.unit === 'string' ? raw.unit.trim() : '';
    const checkNumericRange = (range: unknown, rangeField: string, rangeType: 'BIOLOGICAL' | 'OPERATING' | 'HARDWARE'): NumericRange | undefined => {
      if (!isRecord(range) || !hasOnlyKeys(range, ['minimum', 'maximum', 'unit', ...(rangeType === 'HARDWARE' ? ['basis'] : [])])) {
        findings.push(finding('INVALID_RANGE', 'ERROR', rangeField, 'Range must use only the supported range fields.', { parameterKey: typeof key === 'string' ? key : undefined })); return undefined;
      }
      const min = range.minimum; const max = range.maximum;
      const hardwareShape = rangeType === 'HARDWARE';
      const validMin = typeof min === 'number' && Number.isFinite(min);
      const validMax = typeof max === 'number' && Number.isFinite(max);
      if ((hardwareShape ? (!validMin && !validMax) : (!validMin || !validMax)) || (validMin && validMax && min > max)) {
        findings.push(finding('INVALID_RANGE', 'ERROR', rangeField, hardwareShape ? 'Hardware safety limit needs at least one finite bound and minimum must not exceed maximum.' : 'Range bounds must be finite and minimum must not exceed maximum.', { parameterKey: typeof key === 'string' ? key : undefined }));
        return undefined;
      }
      if (!nonEmptyString(range.unit)) {
        findings.push(finding('MISSING_UNIT', 'ERROR', `${rangeField}/unit`, 'Range unit is required.', { parameterKey: typeof key === 'string' ? key : undefined })); return undefined;
      }
      if (hardwareShape && !nonEmptyString(range.basis)) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${rangeField}/basis`, 'Hardware safety limit requires a basis.', { parameterKey: typeof key === 'string' ? key : undefined }));
      if (range.unit.trim() !== parameterUnit) findings.push(finding('MISSING_UNIT', 'ERROR', `${rangeField}/unit`, 'Range unit must exactly match the parameter unit; no conversion is performed.', { parameterKey: typeof key === 'string' ? key : undefined }));
      if (rangeType !== 'HARDWARE' && isRecord(raw.valueSchema) && typeof raw.dataType === 'string') {
        const rangeValue: NumericRange = { minimum: validMin ? min : Number.NaN, maximum: validMax ? max : Number.NaN, unit: range.unit.trim() };
        const schemaProblem = validateRangeAgainstSchema(rangeValue, raw.valueSchema, raw.dataType);
        if (schemaProblem) findings.push(finding('INVALID_RANGE', 'ERROR', rangeField, schemaProblem, { parameterKey: typeof key === 'string' ? key : undefined }));
      } else if (rangeType === 'HARDWARE' && raw.dataType !== 'number' && raw.dataType !== 'integer') {
        findings.push(finding('INVALID_RANGE', 'ERROR', rangeField, 'Hardware safety limits are supported only for numeric parameters.', { parameterKey: typeof key === 'string' ? key : undefined }));
      }
      return validMin && validMax ? { minimum: min, maximum: max, unit: range.unit.trim() } : undefined;
    };

    let biologicalRanges: NumericRange[] = [];
    if (raw.recommendedOperatingRange !== undefined) {
      const range = checkNumericRange(raw.recommendedOperatingRange, `${field}/recommendedOperatingRange`, 'OPERATING');
      if (range) biologicalRanges.push(range);
    }
    if (raw.biologicalRecommendation !== undefined) {
      if (!isRecord(raw.biologicalRecommendation) || !hasOnlyKeys(raw.biologicalRecommendation, ['summary', 'range']) || !nonEmptyString(raw.biologicalRecommendation.summary)) {
        findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/biologicalRecommendation`, 'Biological recommendation requires a nonempty summary and optional range.', { parameterKey: typeof key === 'string' ? key : undefined }));
      } else if (raw.biologicalRecommendation.range !== undefined) {
        const range = checkNumericRange(raw.biologicalRecommendation.range, `${field}/biologicalRecommendation/range`, 'BIOLOGICAL');
        if (range) biologicalRanges.push(range);
      }
    }
    let hardwareLimit: Record<string, unknown> | undefined;
    if (raw.hardwareSafetyLimit !== undefined) {
      if (!isRecord(raw.hardwareSafetyLimit)) findings.push(finding('INVALID_RANGE', 'ERROR', `${field}/hardwareSafetyLimit`, 'Hardware safety limit must be an object.', { parameterKey: typeof key === 'string' ? key : undefined }));
      else {
        hardwareLimit = raw.hardwareSafetyLimit;
        checkNumericRange(raw.hardwareSafetyLimit, `${field}/hardwareSafetyLimit`, 'HARDWARE');
      }
    }
    if (hardwareLimit) for (const bioRange of biologicalRanges) {
      if (typeof hardwareLimit.unit === 'string' && hardwareLimit.unit.trim() !== bioRange.unit) {
        findings.push(finding('HUMAN_REVIEW_REQUIRED', 'WARNING', `${field}/hardwareSafetyLimit`, 'Biological recommendation and hardware safety limit use different units and cannot be compared safely.', { parameterKey: typeof key === 'string' ? key : undefined, evidenceReferences: refs }));
      } else if ((typeof hardwareLimit.minimum === 'number' && bioRange.minimum < hardwareLimit.minimum) || (typeof hardwareLimit.maximum === 'number' && bioRange.maximum > hardwareLimit.maximum)) {
        findings.push(finding('HUMAN_REVIEW_REQUIRED', 'WARNING', `${field}/hardwareSafetyLimit`, 'Biological recommendation extends beyond the hardware safety limit; human review is required.', { parameterKey: typeof key === 'string' ? key : undefined, evidenceReferences: refs, remediation: 'Reconcile the biological recommendation with the controller safety specification before approval.' }));
      }
    }
  }

  const stageTemplates = Array.isArray(input.stageTemplates) ? input.stageTemplates : [];
  const stageCodes = new Set<string>(); const stageSequences = new Set<number>();
  for (const [index, stage] of stageTemplates.entries()) {
    const field = `stageTemplates/${index}`;
    if (!isRecord(stage) || !hasOnlyKeys(stage, ['code', 'label', 'sequence', 'config']) || typeof stage.code !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(stage.code) || !nonEmptyString(stage.label) || typeof stage.sequence !== 'number' || !Number.isInteger(stage.sequence) || stage.sequence < 1 || !isRecord(stage.config) || !isJsonValue(stage.config)) {
      findings.push(finding('SCHEMA_INVALID', 'ERROR', field, 'Stage template requires a stable code, nonempty label, positive integer sequence, and JSON-compatible config object.'));
      continue;
    }
    if (stageCodes.has(stage.code)) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/code`, `Duplicate stage code '${stage.code}'.`));
    if (stageSequences.has(stage.sequence)) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/sequence`, `Duplicate stage sequence '${stage.sequence}'.`));
    stageCodes.add(stage.code); stageSequences.add(stage.sequence);
  }

  for (const [index, raw] of (Array.isArray(input.validationFindings) ? input.validationFindings : []).entries()) {
    const field = `validationFindings/${index}`;
    if (!isRecord(raw) || !hasOnlyKeys(raw, ['code', 'severity', 'field', 'parameterKey', 'explanation', 'evidenceReferences', 'remediation']) || !FINDING_CODES.includes(raw.code as ValidationFindingCode) || !SEVERITIES.includes(raw.severity as ValidationSeverity) || !nonEmptyString(raw.field) || !nonEmptyString(raw.explanation) || !referencesAreValid(raw.evidenceReferences) || (raw.parameterKey !== undefined && (typeof raw.parameterKey !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(raw.parameterKey))) || (raw.remediation !== undefined && !nonEmptyString(raw.remediation))) {
      findings.push(finding('SCHEMA_INVALID', 'ERROR', field, 'Validation finding has an unknown code/severity, missing affected field/explanation, or malformed optional references/remediation.'));
      continue;
    }
    if (typeof raw.parameterKey === 'string' && !parameterKeys.has(raw.parameterKey)) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/parameterKey`, `Finding references undefined parameter '${raw.parameterKey}'.`));
    for (const ref of raw.evidenceReferences) if (!evidenceReferences.has(ref)) findings.push(finding('MISSING_EVIDENCE_REFERENCE', 'ERROR', `${field}/evidenceReferences`, `Evidence '${ref}' is absent from the proposal evidence list.`));
    findings.push(raw as unknown as ValidationFinding);
    if (raw.code === 'CONFLICTING_EVIDENCE') {
      if (raw.evidenceReferences.length < 2) findings.push(finding('SCHEMA_INVALID', 'ERROR', `${field}/evidenceReferences`, 'Conflicting evidence finding must cite at least two evidence records.'));
    }
  }

  if (isRecord(input.profileDefaults) && isJsonValue(input.profileDefaults)) {
    try {
      const configSchema = buildParameterObjectSchema(validatedDefinitions, { partial: true });
      validatePlantLayer(input.profileDefaults, configSchema);
      for (const stage of stageTemplates) {
        if (!isRecord(stage) || !isRecord(stage.config)) continue;
        validatePlantLayer(stage.config, configSchema);
        validatePlantLayer({ ...input.profileDefaults, ...stage.config }, configSchema);
      }
    } catch (error) {
      findings.push(finding('SCHEMA_INVALID', 'ERROR', 'profileDefaults/stageTemplates', error instanceof Error ? error.message : 'Configuration is incompatible with parameter definitions.'));
    }
  }
  const invalid = findings.some(({ severity }) => severity === 'ERROR' || severity === 'CRITICAL');
  const review = findings.some(({ severity, code }) => severity === 'WARNING' || code === 'CONFLICTING_EVIDENCE') || (Array.isArray(input.unresolvedQuestions) && input.unresolvedQuestions.length > 0);
  return { valid: !invalid, status: invalid ? 'INVALID' : review ? 'NEEDS_REVIEW' : 'READY_FOR_REVIEW', findings };
}
