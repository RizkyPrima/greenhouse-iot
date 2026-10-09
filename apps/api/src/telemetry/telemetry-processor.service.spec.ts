import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryProcessorService } from './telemetry-processor.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { TelemetryRealtimeService } from './telemetry-realtime.service.js';
import { TelemetryPersistenceService } from './telemetry-persistence.service.js';
import { MqttMessage, MqttMessageHandler } from '../mqtt/mqtt.types.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMqtt = {
  onMessage: vi.fn(() => vi.fn()),
};

const mockRealtime = {
  getDeviceState: vi.fn().mockResolvedValue(null),
  updateDeviceSequence: vi.fn().mockResolvedValue(undefined),
  updateSensorReading: vi.fn().mockResolvedValue(undefined),
  updateDeviceStatus: vi.fn().mockResolvedValue(undefined),
};

const mockPersistence = {
  resolveDevice: vi.fn().mockResolvedValue({ id: 'db-device-1', greenhouseId: 'gh-1' }),
  resolveSensors: vi.fn().mockResolvedValue(new Map([
    ['temp_air', { id: 'sensor-1', unit: 'C' }],
  ])),
  persistTelemetry: vi.fn().mockResolvedValue('record-1'),
  persistDeviceStatus: vi.fn().mockResolvedValue(undefined),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMessage(
  greenhouseId: string,
  deviceId: string,
  messageType: string,
  payload: unknown,
): MqttMessage {
  return {
    topic: `greenhouse/${greenhouseId}/${deviceId}/${messageType}`,
    parsedTopic: { greenhouseId, deviceId, messageType: messageType as 'telemetry' | 'status' | 'event' | 'alarm' | 'command' | 'response' | 'config', raw: '' },
    payload,
    rawPayload: Buffer.from(JSON.stringify(payload)),
    receivedAt: new Date().toISOString(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TelemetryProcessorService', () => {
  let service: TelemetryProcessorService;
  let capturedHandler: MqttMessageHandler | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockMqtt.onMessage.mockImplementation(((handler: MqttMessageHandler) => {
      capturedHandler = handler;
      return vi.fn();
    }) as any);

    service = new TelemetryProcessorService(
      mockMqtt as unknown as MqttService,
      mockRealtime as unknown as TelemetryRealtimeService,
      mockPersistence as unknown as TelemetryPersistenceService,
    );

    service.onModuleInit();
  });

  it('should register an MQTT message handler on init', () => {
    expect(mockMqtt.onMessage).toHaveBeenCalledTimes(1);
    expect(capturedHandler).toBeDefined();
  });

  it('should update realtime state on valid telemetry message', async () => {
    const msg = buildMessage('GH001', 'CTRL001', 'telemetry', {
      seq: 1,
      ts: Date.now(),
      sensors: [
        { code: 'temp_air', value: 28.5 },
        { code: 'humidity', value: 72.0 },
      ],
    });

    void capturedHandler!(msg);

    // Wait for async persistence
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRealtime.updateSensorReading).toHaveBeenCalledTimes(2);
    expect(mockRealtime.updateDeviceStatus).toHaveBeenCalledWith(
      'CTRL001', 'GH001', 'online', expect.any(String),
    );
  });

  it('should persist telemetry to DB after realtime update', async () => {
    const msg = buildMessage('GH001', 'CTRL001', 'telemetry', {
      sensors: [{ code: 'temp_air', value: 25.0 }],
    });

    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockPersistence.resolveDevice).toHaveBeenCalledWith('CTRL001');
    expect(mockPersistence.persistTelemetry).toHaveBeenCalledTimes(1);
  });

  it('should skip persistence if device not registered in DB', async () => {
    mockPersistence.resolveDevice.mockResolvedValueOnce(null);

    const msg = buildMessage('GH001', 'UNKNOWN_DEV', 'telemetry', {
      sensors: [{ code: 'temp_air', value: 20.0 }],
    });

    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockPersistence.persistTelemetry).not.toHaveBeenCalled();
  });

  it('should reject invalid telemetry payload (no sensors)', async () => {
    const msg = buildMessage('GH001', 'CTRL001', 'telemetry', {
      sensors: [],
    });

    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRealtime.updateSensorReading).not.toHaveBeenCalled();
    expect(mockPersistence.persistTelemetry).not.toHaveBeenCalled();
  });

  it('should reject non-object telemetry payload', async () => {
    const msg = buildMessage('GH001', 'CTRL001', 'telemetry', 'invalid-string');

    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRealtime.updateSensorReading).not.toHaveBeenCalled();
  });

  it('should handle valid status message (online)', async () => {
    const msg = buildMessage('GH001', 'CTRL001', 'status', {
      status: 'online',
      ip: '192.168.1.100',
      rssi: -65,
      free_heap: 200000,
      uptime: 3600,
      firmware: '1.2.3',
    });

    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockRealtime.updateDeviceStatus).toHaveBeenCalledWith(
      'CTRL001', 'GH001', 'online', expect.any(String),
    );
    expect(mockPersistence.persistDeviceStatus).toHaveBeenCalledTimes(1);
  });

  it('should handle valid status message (offline)', async () => {
    const msg = buildMessage('GH001', 'CTRL001', 'status', {
      status: 'offline',
    });

    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockRealtime.updateDeviceStatus).toHaveBeenCalledWith(
      'CTRL001', 'GH001', 'offline', expect.any(String),
    );
  });

  it('should reject invalid status payload (bad status value)', async () => {
    const msg = buildMessage('GH001', 'CTRL001', 'status', {
      status: 'unknown-status',
    });

    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRealtime.updateDeviceStatus).not.toHaveBeenCalled();
    expect(mockPersistence.persistDeviceStatus).not.toHaveBeenCalled();
  });

  it('should ignore messages without parsedTopic', async () => {
    const msg: MqttMessage = {
      topic: 'some/other/topic',
      parsedTopic: null,
      payload: {},
      rawPayload: Buffer.from('{}'),
      receivedAt: new Date().toISOString(),
    };

    void capturedHandler!(msg);

    expect(mockRealtime.updateSensorReading).not.toHaveBeenCalled();
    expect(mockRealtime.updateDeviceStatus).not.toHaveBeenCalled();
  });

  it('should unregister handler on destroy', () => {
    const unsubscribe = vi.fn();
    mockMqtt.onMessage.mockReturnValueOnce(unsubscribe);

    service.onModuleInit();
    service.onModuleDestroy();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should continue if realtime service throws', async () => {
    mockRealtime.updateSensorReading.mockRejectedValueOnce(new Error('Redis down'));

    const msg = buildMessage('GH001', 'CTRL001', 'telemetry', {
      sensors: [{ code: 'temp_air', value: 25.0 }],
    });

    // Should not throw
    void capturedHandler!(msg);
    await new Promise((r) => setTimeout(r, 100));
    // No assertion needed — if the test doesn't throw/hang, it passes
  });
});