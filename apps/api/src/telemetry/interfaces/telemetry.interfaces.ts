// ─────────────────────────────────────────────────────────────────────────────
// Telemetry payload interfaces — matches ESP32-S3 MQTT message format
// Topic: greenhouse/{greenhouseId}/{deviceId}/telemetry
// ─────────────────────────────────────────────────────────────────────────────

export interface SensorReading {
  /** Sensor code, e.g. "temp_air", "humidity", "co2" */
  code: string;
  /** Numeric sensor value */
  value: number;
  /** Optional unit override from device */
  unit?: string;
}

export interface TelemetryPayload {
  /** Monotonic sequence number from ESP32 (optional) */
  seq?: number;
  /** Unix timestamp (ms) from device, optional */
  ts?: number;
  /** Array of sensor readings */
  sensors: SensorReading[];
}

// Topic: greenhouse/{greenhouseId}/{deviceId}/status
export interface StatusPayload {
  status: 'online' | 'offline' | 'idle';
  ip?: string;
  rssi?: number;
  free_heap?: number;
  uptime?: number;
  firmware?: string;
  ts?: number;
}

// Processed telemetry result (realtime cache value stored in Redis)
export interface RealtimeSensorState {
  sensorCode: string;
  sensorId: string | null;
  numericValue: number | null;
  stringValue: string | null;
  unit: string | null;
  timestamp: string;
  deviceMqttId: string;
  greenhouseId: string;
}

export interface RealtimeDeviceState {
  deviceMqttId: string;
  greenhouseId: string;
  status: string;
  lastSeenAt: string;
  lastTelemetryAt: string | null;
  sequence?: number | null;
  sensors: Record<string, RealtimeSensorState>;
}