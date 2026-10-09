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

export type ConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';
