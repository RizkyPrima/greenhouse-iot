import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MqttDeviceProvisioningService } from './mqtt-device-provisioning.service.js';

describe('MqttDeviceProvisioningService', () => {
  const registeredDevice = {
    deviceId: 'ESP32-S3-01',
    greenhouse: { id: 'greenhouse-db-id', code: 'GH-MAIN-01' },
  };
  let prisma: { device: { findFirst: ReturnType<typeof vi.fn> } };
  let emqx: {
    provisionUser: ReturnType<typeof vi.fn>;
    revokeUser: ReturnType<typeof vi.fn>;
  };
  let service: MqttDeviceProvisioningService;

  beforeEach(() => {
    prisma = { device: { findFirst: vi.fn().mockResolvedValue(registeredDevice) } };
    emqx = {
      provisionUser: vi.fn().mockResolvedValue(undefined),
      revokeUser: vi.fn().mockResolvedValue(undefined),
    };
    service = new MqttDeviceProvisioningService(prisma as never, emqx as never);
  });

  it('issues one-time credentials and ACL rules limited to the registered device and greenhouse', async () => {
    const credentials = await service.provision('device-db-id');

    expect(credentials).toMatchObject({
      deviceId: 'ESP32-S3-01',
      greenhouseId: 'GH-MAIN-01',
      username: 'device:ESP32-S3-01',
    });
    expect(credentials.password).toHaveLength(43);
    expect(emqx.provisionUser).toHaveBeenCalledWith(
      'device:ESP32-S3-01',
      credentials.password,
      expect.arrayContaining([
        { permission: 'allow', action: 'publish', topic: 'greenhouse/GH-MAIN-01/ESP32-S3-01/telemetry' },
        { permission: 'allow', action: 'subscribe', topic: 'greenhouse/GH-MAIN-01/ESP32-S3-01/command' },
        { permission: 'allow', action: 'publish', topic: 'greenhouse/greenhouse-db-id/ESP32-S3-01/status' },
      ]),
    );
    const rules = emqx.provisionUser.mock.calls[0][2] as Array<{ topic: string }>;
    expect(rules.some(({ topic }) => topic.includes('OTHER-GREENHOUSE'))).toBe(false);
    expect(rules.some(({ topic }) => topic.endsWith('/#'))).toBe(false);
  });

  it('refuses to provision an unknown or deleted device', async () => {
    prisma.device.findFirst.mockResolvedValue(null);

    await expect(service.provision('unknown-db-id')).rejects.toThrow('Active registered device not found');
    expect(emqx.provisionUser).not.toHaveBeenCalled();
  });

  it('rejects identities that cannot be safely represented in the existing MQTT topic format', async () => {
    prisma.device.findFirst.mockResolvedValue({
      ...registeredDevice,
      deviceId: 'device/other',
    });

    await expect(service.provision('device-db-id')).rejects.toThrow('not valid for MQTT topics');
    expect(emqx.provisionUser).not.toHaveBeenCalled();
  });

  it('revokes broker credentials for a device', async () => {
    await service.revoke('ESP32-S3-01');
    expect(emqx.revokeUser).toHaveBeenCalledWith('device:ESP32-S3-01');
  });
});
