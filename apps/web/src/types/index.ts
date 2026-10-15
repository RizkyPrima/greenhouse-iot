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
}

export interface UpdatePlantCatalogVersionDto {
  profileDefaults?: PlantJsonObject;
  stageTemplates?: PlantJsonValue[];
  edgeCompatibility?: PlantJsonObject;
}

export interface CreatePlantParameterDefinitionDto {
  parameterKey: string;
  label: string;
  dataType: string;
  unit?: string;
  valueSchema: PlantJsonObject;
  metadataSchema?: PlantJsonObject;
}

export interface UpdatePlantParameterDefinitionDto {
  parameterKey?: string;
  label?: string;
  dataType?: string;
  unit?: string | null;
  valueSchema?: PlantJsonObject;
  metadataSchema?: PlantJsonObject;
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

export interface UpdateGrowthStageDto {
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
