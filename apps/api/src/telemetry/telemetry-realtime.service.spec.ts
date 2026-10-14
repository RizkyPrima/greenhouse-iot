import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryRealtimeService } from './telemetry-realtime.service.js';
import { RedisService } from '../redis/redis.service.js';
import { RealtimeDeviceState } from './interfaces/telemetry.interfaces.js';

// ─── Mock Redis ───────────────────────────────────────────────────────────────

const store = new Map<string, string>();
const setsStore = new Map<string, Set<string>>();

const mockRedisClient = {
  sadd: vi.fn(async (key: string, value: string) => {
    if (!setsStore.has(key)) setsStore.set(key, new Set());
    setsStore.get(key)!.add(value);
    return 1;
  }),
  smembers: vi.fn(async (key: string) => {
    return Array.from(setsStore.get(key) ?? []);
  }),
};

const mockRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => {
    store.delete(key);
    return 1;
  }),
  getClient: vi.fn(() => mockRedisClient),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TelemetryRealtimeService', () => {
  let service: TelemetryRealtimeService;

  beforeEach(() => {
    store.clear();
    setsStore.clear();
    vi.clearAllMocks();

    service = new TelemetryRealtimeService(mockRedis as unknown as RedisService);
  });

  it('should return null for unknown device', async () => {
    const result = await service.getDeviceState('UNKNOWN');
    expect(result).toBeNull();
  });

  it('should update and retrieve device state', async () => {
    const state: RealtimeDeviceState = {
      deviceMqttId: 'CTRL001',
      greenhouseId: 'GH001',
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      lastTelemetryAt: null,
      sensors: {},
    };

    await service.updateDeviceState(state);

    const retrieved = await service.getDeviceState('CTRL001');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.deviceMqttId).toBe('CTRL001');
    expect(retrieved?.status).toBe('online');
  });

  it('should update device status and create state if not existing', async () => {
    await service.updateDeviceStatus('CTRL002', 'GH002', 'online', new Date().toISOString());

    const state = await service.getDeviceState('CTRL002');
    expect(state).not.toBeNull();
    expect(state?.status).toBe('online');
    expect(state?.greenhouseId).toBe('GH002');
    expect(state?.sensors).toEqual({});
  });

  it('should update device status and preserve existing sensor readings', async () => {
    // First, set a state with sensor readings
    const now = new Date().toISOString();
    await service.updateSensorReading('CTRL001', 'GH001', {
      sensorCode: 'temp_air',
      sensorId: 'sensor-1',
      numericValue: 28.5,
      stringValue: null,
      unit: '°C',
      timestamp: now,
      deviceMqttId: 'CTRL001',
      greenhouseId: 'GH001',
    });

    // Then update just the status
    await service.updateDeviceStatus('CTRL001', 'GH001', 'offline', now);

    const state = await service.getDeviceState('CTRL001');
    expect(state?.status).toBe('offline');
    expect(state?.sensors['temp_air']).toBeDefined();
    expect(state?.sensors['temp_air'].numericValue).toBe(28.5);
  });

  it('should update sensor reading and merge into existing state', async () => {
    const now = new Date().toISOString();

    await service.updateSensorReading('CTRL001', 'GH001', {
      sensorCode: 'temp_air',
      sensorId: 'sensor-1',
      numericValue: 30.0,
      stringValue: null,
      unit: '°C',
      timestamp: now,
      deviceMqttId: 'CTRL001',
      greenhouseId: 'GH001',
    });

    await service.updateSensorReading('CTRL001', 'GH001', {
      sensorCode: 'humidity',
      sensorId: 'sensor-2',
      numericValue: 75.0,
      stringValue: null,
      unit: '%',
      timestamp: now,
      deviceMqttId: 'CTRL001',
      greenhouseId: 'GH001',
    });

    const state = await service.getDeviceState('CTRL001');
    expect(Object.keys(state?.sensors ?? {})).toHaveLength(2);
    expect(state?.sensors['temp_air']?.numericValue).toBe(30.0);
    expect(state?.sensors['humidity']?.numericValue).toBe(75.0);
    expect(state?.lastTelemetryAt).toBeTruthy();
  });

  it('should track device IDs per greenhouse', async () => {
    await service.updateDeviceState({
      deviceMqttId: 'CTRL001',
      greenhouseId: 'GH001',
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      lastTelemetryAt: null,
      sensors: {},
    });

    await service.updateDeviceState({
      deviceMqttId: 'CTRL002',
      greenhouseId: 'GH001',
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      lastTelemetryAt: null,
      sensors: {},
    });

    const ids = await service.getGreenhouseDeviceIds('GH001');
    expect(ids).toContain('CTRL001');
    expect(ids).toContain('CTRL002');
  });

  it('should return all device states for a greenhouse', async () => {
    await service.updateDeviceState({
      deviceMqttId: 'CTRL001',
      greenhouseId: 'GH001',
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      lastTelemetryAt: null,
      sensors: {},
    });

    const states = await service.getAllGreenhouseDeviceStates('GH001');
    expect(states.length).toBeGreaterThanOrEqual(1);
    expect(states[0].deviceMqttId).toBe('CTRL001');
  });

  it('should return empty array for greenhouse with no devices', async () => {
    const states = await service.getAllGreenhouseDeviceStates('GH_EMPTY');
    expect(states).toEqual([]);
  });

  it('should handle malformed JSON in Redis gracefully', async () => {
    // Simulate corrupted Redis data
    mockRedis.get.mockResolvedValueOnce('NOT_VALID_JSON{{{');

    const result = await service.getDeviceState('CTRL001');
    expect(result).toBeNull();
  });
});
