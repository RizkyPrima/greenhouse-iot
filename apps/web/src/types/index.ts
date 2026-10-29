export type UserRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'AI_AGENT';

export interface UserMembership {
  id: string;
  organizationId: string;
  role: UserRole;
  createdAt?: string;
  organization?: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  organizationId?: string | null;
  membershipId?: string | null;
  role?: UserRole | null;
  memberships: UserMembership[];
  organization?: Organization | null;
  membership?: UserMembership | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  organizationId: string;
  role: UserRole;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    isActive: boolean;
  };
}

export type GreenhouseStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

export interface Greenhouse {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description?: string | null;
  location?: string | null;
  timezone: string;
  status: GreenhouseStatus;
  createdAt: string;
  updatedAt: string;
  zones?: Zone[];
  devices?: Device[];
}

export type ZoneStatus = 'ACTIVE' | 'INACTIVE';

export interface Zone {
  id: string;
  greenhouseId: string;
  name: string;
  code: string;
  description?: string | null;
  status: ZoneStatus;
  createdAt: string;
  updatedAt: string;
}

export type DeviceStatus = 'ONLINE' | 'STALE' | 'OFFLINE';

export interface Device {
  id: string;
  greenhouseId: string;
  zoneId?: string | null;
  deviceId: string; // MQTT deviceId
  name: string;
  deviceType: string;
  firmwareVersion?: string | null;
  hardwareVersion?: string | null;
  status: DeviceStatus;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
  zone?: Zone | null;
  sensors?: Sensor[];
  actuators?: Actuator[];
}

export interface PlantConfigurationDevice {
  id: string;
  deviceId: string;
  name: string;
  greenhouse: { code: string; name: string };
  status: DeviceStatus;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  sensors: Array<{ code: string; name: string; unit: string | null }>;
  lastConfiguration: {
    configurationId: string;
    version: number;
    status: DevicePlantConfigurationStatus;
    createdAt: string;
    error: string | null;
  } | null;
  capability: {
    schema: string | null;
    sensorCodes: string[];
    supportedParameterKeys: string[];
    sensorDataMode: 'PHYSICAL' | 'SIMULATED' | null;
    reportedAt: string | null;
  };
}

export type DevicePlantConfigurationStatus =
  | 'PENDING'
  | 'PUBLISHING'
  | 'SENT'
  | 'RECEIVED'
  | 'APPLIED'
  | 'REJECTED'
  | 'TIMEOUT'
  | 'FAILED';

export interface DevicePlantConfigurationDelivery {
  id: string;
  configurationId: string;
  organizationId: string;
  deviceId: string;
  deviceMqttId: string;
  catalogVersionId: string;
  version: number;
  status: DevicePlantConfigurationStatus;
  payload: PlantJsonObject;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  appliedAt: string | null;
  completedAt: string | null;
}

export interface Sensor {
  id: string;
  deviceId: string;
  zoneId?: string | null;
  name: string;
  code: string;
  sensorType: string;
  unit?: string | null;
  enabled: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface Actuator {
  id: string;
  deviceId: string;
  zoneId?: string | null;
  name: string;
  code: string;
  actuatorType: string;
  enabled: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface RealtimeSensorState {
  sensorCode: string;
  sensorId?: string | null;
  numericValue?: number | null;
  stringValue?: string | null;
  unit?: string | null;
  timestamp: string;
  deviceMqttId: string;
  greenhouseId: string;
}

export interface RealtimeDeviceState {
  deviceMqttId: string;
  greenhouseId: string;
  status: string;
  lastSeenAt: string | null;
  lastTelemetryAt: string | null;
  sequence?: number;
  sensors: Record<string, RealtimeSensorState>;
}

export interface TelemetryValueRecord {
  id: string;
  telemetryRecordId: string;
  sensorId?: string | null;
  sensorCode: string;
  numericValue?: number | null;
  stringValue?: string | null;
  unit?: string | null;
  timestamp: string;
}

export interface TelemetryRecord {
  id: string;
  deviceId: string;
  deviceMqttId: string;
  greenhouseId: string;
  sequenceNumber?: number | null;
  receivedAt: string;
  values: TelemetryValueRecord[];
}

// Plant Standardization API contracts (Phase 10.1/10.2).
export type PlantJsonValue = string | number | boolean | null | PlantJsonValue[] | { [key: string]: PlantJsonValue };
export type PlantJsonObject = Record<string, PlantJsonValue>;
export type PlantCatalogStatus = 'ACTIVE' | 'INACTIVE';
export type PlantCatalogVersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type PlantAiProposalStatus = 'REQUESTED' | 'RESEARCH_PENDING' | 'PROPOSED' | 'NEEDS_REVIEW' | 'INVALID' | 'APPROVED' | 'REJECTED';
export interface PlantAiProposalRecord {
  id: string;
  organizationId: string;
  plantCatalogId: string;
  targetCatalogVersionId: string | null;
  status: PlantAiProposalStatus;
  createdByUserId: string;
  contract: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  evidenceLinks: Array<{ evidence: { id: string; verificationStatus: string; contract: Record<string, unknown> } }>;
}

export interface PlantRecommendationResult {
  status: 'PROVIDER_NOT_CONFIGURED' | 'INSUFFICIENT_EVIDENCE' | 'PROPOSAL_CREATED';
  proposal: PlantAiProposalRecord | null;
  evidence: Array<{ evidenceId: string; parameterKey?: string; reportedValue?: unknown; unit?: string; findingSummary?: string; source?: { title?: string; doi?: string; canonicalUrl?: string; publicationYear?: number } }>;
  completeness: { verifiedEvidenceCount: number; parametersWithEvidence: number; totalParameters: number; missingParameters: string[] };
  findings: Array<{ code: string; field: string; explanation: string }>;
}
export interface PlantScientificEvidenceRecord {
  id: string;
  organizationId: string | null;
  sourceId: string | null;
  verificationStatus: 'UNKNOWN' | 'UNVERIFIED' | 'VERIFIED';
  contract: Record<string, unknown>;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  createdAt: string;
}
export interface GeneratePlantSetupDto {
  commonName: string;
  scientificName?: string;
  cultivar?: string;
  cultivationMethod: 'hydroponic_tower' | 'hydroponic_nft' | 'hydroponic_dwc' | 'soil' | 'other';
  growthStageContext?: string;
}
export interface PlantSetupCandidateResult {
  status: 'CANDIDATES_FOR_REVIEW';
  scientificNameSuggestion: string | null;
  parameters: Array<{
    parameterKey: string;
    label: string;
    dataType: 'number';
    unit: string | null;
    recommendedValue: number | null;
    minimumValue: number | null;
    maximumValue: number | null;
    note: string;
    evidenceStatus: 'NOT_ASSESSED';
  }>;
  growthStages: Array<{ code: string; label: string; sequence: number }>;
  provider: { name: string; model?: string };
  findings: Array<{ code: string; explanation: string }>;
  sourceCandidates: Array<{
    provider: 'crossref' | 'openalex';
    title: string;
    authors: string[];
    doi?: string;
    publicationYear?: number;
    journal?: string;
    sourceUrl?: string;
  }>;
  sourceSearchStatus: 'NOT_SEARCHED' | 'COMPLETED' | 'PARTIAL' | 'UNAVAILABLE';
  sourceSearchWarning?: string;
}
export interface ResearchMetadataSearchResponse {
  job: { status: string };
  sources: Array<{
    title: string;
    authors: unknown;
    metadataProvider: string | null;
    doiNormalized: string | null;
    publicationYear: number | null;
    journal: string | null;
    sourceUrl: string | null;
  }>;
  errors: Array<{ provider: string; code: string }>;
}
export type PlantProfileStatus = 'ACTIVE' | 'ARCHIVED';
export type PlantProfileVersionStatus = 'DRAFT' | 'VALIDATED' | 'RETIRED';
export type ZonePlantAssignmentStatus = 'ACTIVE' | 'ENDED' | 'CANCELLED';
export type PlatformPermission = 'PLANT_CATALOG_ADMIN';

export interface CreatePlantCatalogDto {
  code: string;
  scientificName: string;
  commonName: string;
  cultivar?: string;
}

export interface CreatePlantCatalogVersionDto {
  profileDefaults: PlantJsonObject;
  stageTemplates?: PlantJsonValue[];
  edgeCompatibility?: PlantJsonObject;
  changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export interface UpdatePlantCatalogVersionDto {
  profileDefaults?: PlantJsonObject;
  stageTemplates?: PlantJsonValue[];
  edgeCompatibility?: PlantJsonObject;
  changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export interface CreatePlantParameterDefinitionDto {
  parameterKey: string;
  label: string;
  dataType: string;
  unit?: string;
  valueSchema: PlantJsonObject;
  metadataSchema?: PlantJsonObject;
  changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export interface UpdatePlantParameterDefinitionDto {
  parameterKey?: string;
  label?: string;
  dataType?: string;
  unit?: string | null;
  valueSchema?: PlantJsonObject;
  metadataSchema?: PlantJsonObject;
  changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export interface CreateGrowthStageDto {
  code: string;
  label: string;
  sequence: number;
  minDurationDays?: number;
  maxDurationDays?: number;
  transitionCriteria?: PlantJsonObject;
  config?: PlantJsonObject;
}

export interface CreateDraftGrowthStageDto extends CreateGrowthStageDto {
  expectedRevision: number;
}

export interface UpdateGrowthStageDto {
  expectedRevision: number;
  code?: string;
  label?: string;
  sequence?: number;
  minDurationDays?: number;
  maxDurationDays?: number;
  transitionCriteria?: PlantJsonObject;
  config?: PlantJsonObject;
}

export interface CreatePlantProfileDto {
  catalogVersionId: string;
  code: string;
  name: string;
  profileConfig?: PlantJsonObject;
  stages: CreateGrowthStageDto[];
}

export interface UpdatePlantProfileDraftDto {
  expectedRevision: number;
  name?: string;
  profileConfig?: PlantJsonObject;
}

export interface AdoptPlantCatalogVersionDto {
  catalogVersionId: string;
}

export interface ActivatePlantProfileDto {
  organizationId: string;
  plantProfileVersionId: string;
  growthStageId: string;
}

export interface CreateZoneOverrideDto {
  overrideConfig: PlantJsonObject;
}

export interface CreatePlatformGrantDto {
  userId: string;
}

export interface PlantParameterDefinition {
  id: string;
  plantCatalogVersionId: string;
  parameterKey: string;
  label: string;
  dataType: string;
  unit: string | null;
  valueSchema: PlantJsonObject;
  metadataSchema: PlantJsonObject;
  createdAt: string;
}

export interface PlantCatalogVersion {
  id: string;
  plantCatalogId: string;
  version: number;
  status: PlantCatalogVersionStatus;
  configSchemaVersion: string;
  profileDefaults: PlantJsonObject;
  stageTemplates: PlantJsonValue[];
  edgeCompatibility: PlantJsonObject | null;
  checksumAlgorithm: string;
  checksum: string | null;
  createdByUserId: string;
  publishedByUserId: string | null;
  createdAt: string;
  publishedAt: string | null;
  parameterDefinitions?: PlantParameterDefinition[];
}

export interface PlantCatalog {
  id: string;
  organizationId: string | null;
  code: string;
  scientificName: string;
  commonName: string;
  cultivar: string | null;
  status: PlantCatalogStatus;
  createdAt: string;
  updatedAt: string;
  versions?: PlantCatalogVersion[];
}

export interface PlantStageParameterConfig {
  id: string;
  growthStageId: string;
  config: PlantJsonObject;
  configSchemaVersion: string;
  checksumAlgorithm: string;
  checksum: string | null;
}

export interface GrowthStage {
  id: string;
  plantProfileVersionId: string;
  code: string;
  label: string;
  sequence: number;
  minDurationDays: number | null;
  maxDurationDays: number | null;
  transitionCriteria: PlantJsonObject | null;
  parameterConfig?: PlantStageParameterConfig | null;
}

export interface PlantProfileVersion {
  id: string;
  plantProfileId: string;
  organizationId: string;
  plantCatalogId: string;
  version: number;
  sourceCatalogVersionId: string;
  adoptedFromVersionId: string | null;
  status: PlantProfileVersionStatus;
  draftRevision: number;
  configSchemaVersion: string;
  profileConfig: PlantJsonObject;
  checksumAlgorithm: string;
  checksum: string | null;
  createdByUserId: string;
  validatedByUserId: string | null;
  createdAt: string;
  validatedAt: string | null;
  growthStages?: GrowthStage[];
}

export interface PlantProfile {
  id: string;
  organizationId: string;
  plantCatalogId: string;
  code: string;
  name: string;
  status: PlantProfileStatus;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  plantCatalog?: PlantCatalog;
  versions?: PlantProfileVersion[];
}

export interface PlatformAdminGrant {
  id: string;
  userId: string;
  permission: PlatformPermission;
  grantedByUserId: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export interface PlatformCapabilities {
  plantCatalogAdmin: boolean;
}

export interface PlantConfigAuditEvent {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  fromChecksum: string | null;
  toChecksum: string | null;
  details: PlantJsonObject | null;
  requestId: string | null;
  createdAt: string;
}

export interface PlantParameterValidation {
  parameterId: string;
  parameterKey: string;
  validated: boolean;
  validatedByUserId: string | null;
  validatedAt: string | null;
}

export interface ZonePlantAssignment {
  id: string;
  zoneId: string;
  greenhouseId: string;
  organizationId: string;
  plantProfileVersionId: string;
  growthStageId: string;
  status: ZonePlantAssignmentStatus;
  activatedAt: string;
  endedAt: string | null;
  assignedByUserId: string;
  createdAt: string;
}

export interface ZonePlantAssignmentDetails extends ZonePlantAssignment {
  plantProfileVersion: PlantProfileVersion & {
    plantProfile: Pick<PlantProfile, 'id' | 'code' | 'name' | 'status'>;
    sourceCatalogVersion: Pick<PlantCatalogVersion, 'id' | 'version' | 'status' | 'configSchemaVersion' | 'parameterDefinitions'>;
  };
  growthStage: GrowthStage;
  overrides: ZoneParameterOverride[];
}

export interface ZoneParameterOverride {
  id: string;
  assignmentId: string;
  revision: number;
  overrideConfig: PlantJsonObject;
  configSchemaVersion: string;
  checksumAlgorithm: string;
  checksum: string | null;
  createdByUserId: string;
  createdAt: string;
  supersededAt: string | null;
}

export interface EffectiveZonePlantConfig {
  assignmentId: string;
  plantProfileVersionId: string;
  growthStageId: string;
  schemaVersion: string;
  checksum: string;
  config: PlantJsonObject;
}

export type ConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';
