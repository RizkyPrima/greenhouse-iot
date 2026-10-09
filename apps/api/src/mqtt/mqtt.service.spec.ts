import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { MqttService } from './mqtt.service.js';
import {
  buildGreenhouseTopic,
  parseGreenhouseTopic,
} from './mqtt.constants.js';
import { MqttMessage } from './mqtt.types.js';

class MockMqttClient extends EventEmitter {
  connected = false;
  publish = vi.fn();
  subscribe = vi.fn();
  unsubscribe = vi.fn();
  end = vi.fn((_force, _opts, cb) => {
    this.connected = false;
    if (cb) cb();
  });
}

describe('MQTT Topic Helpers', () => {
  it('should build greenhouse topic correctly', () => {
    const topic = buildGreenhouseTopic('GH001', 'CTRL001', 'telemetry');
    expect(topic).toBe('greenhouse/GH001/CTRL001/telemetry');
  });

  it('should parse valid greenhouse topic correctly', () => {
    const parsed = parseGreenhouseTopic('greenhouse/GH001/CTRL001/telemetry');
    expect(parsed).toEqual({
      greenhouseId: 'GH001',
      deviceId: 'CTRL001',
      messageType: 'telemetry',
      raw: 'greenhouse/GH001/CTRL001/telemetry',
    });
  });

  it('should return null for invalid greenhouse topic structure', () => {
    expect(parseGreenhouseTopic('other/GH001/CTRL001/telemetry')).toBeNull();
    expect(parseGreenhouseTopic('greenhouse/GH001')).toBeNull();
    expect(parseGreenhouseTopic('greenhouse/GH001/CTRL001/unknown_type')).toBeNull();
  });
});

describe('MqttService (Unit)', () => {
  let service: MqttService;
  let mockConfigService: Partial<ConfigService>;
  let mockClient: MockMqttClient;

  beforeEach(() => {
    mockClient = new MockMqttClient();

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        const configMap: Record<string, unknown> = {
          'mqtt.host': 'localhost',
          'mqtt.port': 1883,
          'mqtt.protocol': 'mqtt',
          'mqtt.clientId': 'test-greenhouse-api',
          'mqtt.keepalive': 30,
          'mqtt.connectTimeout': 10000,
          'mqtt.reconnectPeriod': 3000,
          'mqtt.clean': true,
        };
        return configMap[key];
      }),
    };

    service = new MqttService(mockConfigService as ConfigService);
  });

  it('should have disconnected status initially', () => {
    expect(service.isConnected()).toBe(false);
    expect(service.getConnectionStatus()).toBe('disconnected');
  });

  it('should throw an error when publishing while disconnected', async () => {
    await expect(
      service.publish('greenhouse/GH001/CTRL001/telemetry', { temp: 25 }),
    ).rejects.toThrowError(/Cannot publish to topic/);
  });

  it('should publish successfully when connected', async () => {
    // Inject mock client
    (service as unknown as { client: MockMqttClient }).client = mockClient;
    mockClient.connected = true;

    mockClient.publish.mockImplementation(
      (_topic: string, _message: Buffer, _options: unknown, cb: (err?: Error | null) => void) => {
        cb(null);
      },
    );

    const payload = { device_id: 'CTRL001', temperature: 28.5 };
    await expect(
      service.publish('greenhouse/GH001/CTRL001/telemetry', payload, { qos: 0 }),
    ).resolves.toBeUndefined();

    expect(mockClient.publish).toHaveBeenCalledWith(
      'greenhouse/GH001/CTRL001/telemetry',
      Buffer.from(JSON.stringify(payload)),
      { qos: 0, retain: false },
      expect.any(Function),
    );
  });

  it('should dispatch received messages to registered message handlers', async () => {
    (service as unknown as { client: MockMqttClient }).client = mockClient;
    (service as unknown as { setupEventHandlers: (id: string) => void }).setupEventHandlers('test-client');

    const receivedMessages: MqttMessage[] = [];
    service.onMessage((msg) => {
      receivedMessages.push(msg);
    });

    const topic = 'greenhouse/GH001/CTRL001/telemetry';
    const rawPayload = Buffer.from(JSON.stringify({ temperature: 27.2 }));

    mockClient.emit('message', topic, rawPayload);

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].topic).toBe(topic);
    expect(receivedMessages[0].parsedTopic).toEqual({
      greenhouseId: 'GH001',
      deviceId: 'CTRL001',
      messageType: 'telemetry',
      raw: topic,
    });
    expect(receivedMessages[0].payload).toEqual({ temperature: 27.2 });
  });

  it('should handle disconnect gracefully', async () => {
    (service as unknown as { client: MockMqttClient }).client = mockClient;
    mockClient.connected = true;

    await service.disconnect();

    expect(mockClient.end).toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });
});
