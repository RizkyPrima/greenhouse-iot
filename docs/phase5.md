# Phase 5 — Telemetry Pipeline

## Overview

Phase 5 implements a **production-oriented, dual-path telemetry pipeline** for the Greenhouse IoT Platform.

```
ESP32-S3
    |
MQTT (EMQX broker)
    |
NestJS MQTT Consumer (TelemetryProcessorService)
    |
    +--- [1] REALTIME PATH (fast, always first)
    |         --> Redis (RealtimeSensorState per sensor code)
    |
    +--- [2] PERSISTENCE PATH (async, fire-and-forget)
              --> PostgreSQL (TelemetryRecord + TelemetryValue rows)
```

**Critical Design Principle:**
- The realtime path (Redis) is ALWAYS updated FIRST and independently of PostgreSQL
- Persistence failures never block the realtime path
- Unregistered devices still get realtime state; persistence is silently skipped

---

## MQTT Topic Convention

```
greenhouse/{greenhouseId}/{deviceId}/{messageType}

messageType:
  telemetry  — sensor readings batch
  status     — device connection/health status
  event      — custom device events
  alarm      — alert conditions
  response   — command acknowledgment
```

---

## Telemetry Payload (ESP32 → EMQX → NestJS)

### `telemetry` message

```json
{
  "seq": 42,
  "ts": 1727769600000,
  "sensors": [
    { "code": "temp_air", "value": 28.5, "unit": "C" },
    { "code": "humidity",  "value": 72.0 },
    { "code": "co2",       "value": 850.0, "unit": "ppm" }
  ]
}
```

Fields:
- `seq` (optional): monotonic sequence number from device
- `ts` (optional): Unix timestamp in ms from device clock
- `sensors[]`: array of sensor readings — REQUIRED
  - `code`: matches `Sensor.code` in the database
  - `value`: numeric reading
  - `unit` (optional): unit override

### `status` message

```json
{
  "status": "online",
  "ip": "192.168.1.100",
  "rssi": -65,
  "free_heap": 200000,
  "uptime": 3600,
  "firmware": "1.2.3"
}
```

Fields:
- `status`: `"online"` | `"offline"` | `"idle"` — REQUIRED
- All other fields optional

---

## Redis Data Structures

### Device Realtime State

Key: `realtime:device:{deviceMqttId}`  
TTL: 3600 seconds (1 hour)

```json
{
  "deviceMqttId": "CTRL001",
  "greenhouseId": "GH001",
  "status": "online",
  "lastSeenAt": "2026-10-01T08:00:00.000Z",
  "lastTelemetryAt": "2026-10-01T08:00:00.000Z",
  "sensors": {
    "temp_air": {
      "sensorCode": "temp_air",
      "sensorId": "clxxxxx",
      "numericValue": 28.5,
      "stringValue": null,
      "unit": "C",
      "timestamp": "2026-10-01T08:00:00.000Z",
      "deviceMqttId": "CTRL001",
      "greenhouseId": "GH001"
    }
  }
}
```

### Greenhouse Device Set

Key: `realtime:greenhouse:{greenhouseId}:devices`  
Type: Redis Set — stores `deviceMqttId` strings

---

## PostgreSQL Tables (Phase 5)

### `telemetry_records`

One row per MQTT telemetry message received.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (cuid) | Primary key |
| deviceId | TEXT | FK → devices.id |
| deviceMqttId | TEXT | MQTT device ID (from topic) |
| greenhouseId | TEXT | Greenhouse from topic |
| sequenceNumber | INT? | From payload.seq |
| receivedAt | TIMESTAMP | Server receive time |
| processedAt | TIMESTAMP? | Pipeline completion time |
| rawPayload | JSONB | Full raw payload for audit |

### `telemetry_values`

One row per sensor reading within a batch.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (cuid) | Primary key |
| telemetryRecordId | TEXT | FK → telemetry_records.id |
| sensorId | TEXT? | FK → sensors.id (nullable if unregistered) |
| sensorCode | TEXT | e.g. "temp_air" |
| numericValue | FLOAT? | Numeric sensor value |
| stringValue | TEXT? | String value (for future use) |
| unit | TEXT? | Unit string |
| timestamp | TIMESTAMP | Device timestamp or receivedAt |

### `device_status_logs`

One row per `status` MQTT message received.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (cuid) | Primary key |
| deviceMqttId | TEXT | MQTT device ID |
| greenhouseId | TEXT | From topic |
| status | ENUM | ONLINE / OFFLINE |
| ipAddress | TEXT? | |
| rssi | INT? | WiFi signal strength |
| freeHeap | INT? | ESP32 free heap bytes |
| uptime | INT? | Device uptime seconds |
| firmwareVersion | TEXT? | |
| rawPayload | JSONB? | Full status payload |
| receivedAt | TIMESTAMP | Server receive time |

---

## REST API Endpoints

### Realtime (Redis)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices/:deviceMqttId/realtime` | Get current device state |
| GET | `/api/greenhouses/:greenhouseId/realtime` | Get all device states for greenhouse |

### Historical (PostgreSQL)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices/:deviceMqttId/telemetry?limit=100` | Historical telemetry records |
| GET | `/api/devices/:deviceMqttId/status-logs?limit=50` | Device status log history |
| GET | `/api/greenhouses/:greenhouseId/telemetry/stats` | Greenhouse telemetry statistics |

---

## Services Architecture

```
TelemetryModule
  |
  +-- TelemetryProcessorService   (OnModuleInit/Destroy — MQTT handler lifecycle)
  |     Receives all MQTT messages via MqttService.onMessage()
  |     Validates payloads
  |     Routes to realtime & persistence
  |
  +-- TelemetryRealtimeService    (Redis operations)
  |     updateDeviceState()
  |     updateDeviceStatus()
  |     updateSensorReading()
  |     getDeviceState()
  |     getAllGreenhouseDeviceStates()
  |
  +-- TelemetryPersistenceService (PostgreSQL operations)
  |     resolveDevice()     — maps MQTT deviceId → DB Device.id
  |     resolveSensors()    — maps sensor codes → DB Sensor records
  |     persistTelemetry()  — creates TelemetryRecord + TelemetryValue rows
  |     persistDeviceStatus() — updates Device.status + creates DeviceStatusLog
  |     getDeviceHistory()
  |     getDeviceStatusLogs()
  |     getGreenhouseStats()
  |
  +-- TelemetryController
        GET /api/devices/:id/realtime
        GET /api/greenhouses/:id/realtime
        GET /api/devices/:id/telemetry
        GET /api/devices/:id/status-logs
        GET /api/greenhouses/:id/telemetry/stats
```

---

## Unregistered Device Behavior

Devices sending telemetry WITHOUT being registered in the `devices` table:

1. **Realtime state IS updated** — Redis stores the sensor readings regardless
2. **DB persistence IS skipped** — `TelemetryRecord` is NOT created
3. A WARN log is emitted: `[PERSIST_SKIP] Device "X" not registered in DB`

This means:
- Unregistered devices can still be monitored in real time
- Historical data only exists for registered devices
- No foreign key violations

---

## Tests

### Unit Tests

```
src/telemetry/telemetry-processor.service.spec.ts  (12 tests)
src/telemetry/telemetry-realtime.service.spec.ts   (9 tests)
```

Coverage:
- Valid/invalid telemetry payload validation
- Valid/invalid status payload validation
- Realtime Redis update and merge behavior
- Persistence fire-and-forget with device registration check
- Handler lifecycle (register on init, unregister on destroy)
- Resilience to Redis failures (pipeline continues)

### E2E Tests

```
test/app.e2e-spec.ts → "Telemetry Pipeline (Phase 5)" (6 tests)
```

Coverage:
- Realtime state is null for unknown device (returns 200, data: null)
- Empty greenhouse realtime for unknown greenhouse
- Full end-to-end: MQTT publish → Redis update → REST API retrieval
- Device appears in greenhouse realtime view after first telemetry
- Historical endpoints return empty for unregistered devices

---

## Phase 5 Validation Checklist

- [x] MQTT telemetry messages processed by TelemetryProcessorService
- [x] Valid payloads update Redis realtime state
- [x] Invalid payloads rejected with WARN log
- [x] Realtime path does NOT depend on PostgreSQL
- [x] Persistence path is fire-and-forget (async, never blocks realtime)
- [x] Unregistered device: realtime updated, persistence skipped
- [x] Device status messages update Redis and persist DeviceStatusLog
- [x] REST: GET /api/devices/:id/realtime works
- [x] REST: GET /api/greenhouses/:id/realtime works
- [x] REST: GET /api/devices/:id/telemetry works
- [x] REST: GET /api/devices/:id/status-logs works
- [x] REST: GET /api/greenhouses/:id/telemetry/stats works
- [x] Build PASS (0 errors)
- [x] Lint PASS (0 warnings, 0 errors)
- [x] Unit tests PASS (38/38)
- [x] E2E tests PASS (14/14)

---

## Next Phase

**Phase 6 — Authentication & Authorization**

- JWT-based auth
- User → Organization ownership
- API key support for devices
- Per-greenhouse access control