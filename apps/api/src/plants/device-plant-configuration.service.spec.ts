import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { DevicePlantConfigurationStatus, PlantVersionStatus, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DevicePlantConfigurationService } from './device-plant-configuration.service.js';

const actor = { id: 'owner-a' } as AuthenticatedUser;
const configId = 'c5748e28-4c7a-48ef-a742-24bdf37d48e3';

function harness() {
  const device = {
    id: 'device-db-1',
    deviceId: 'esp-1',
    status: 'ONLINE',
    lastSeenAt: new Date(),
    greenhouse: { id: 'greenhouse-db-1', code: 'GH-1' },
    sensors: [{ code: 'temperature' }, { code: 'humidity' }],
  };
  const prisma = {
    device: { findFirst: vi.fn().mockResolvedValue(device) },
    deviceStatusLog: {
      findFirst: vi.fn().mockResolvedValue({
        rawPayload: {
          capabilities: {
            plantConfiguration: 'plant-monitoring/v1',
            sensorDataMode: 'SIMULATED',
            sensorCodes: ['temperature', 'humidity'],
          },
        },
        receivedAt: new Date(),
      }),
    },
    plantCatalogVersion: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'catalog-version-1',
        status: PlantVersionStatus.PUBLISHED,
        parameterDefinitions: [
          { parameterKey: 'air_temperature' },
          { parameterKey: 'relative_humidity' },
        ],
      }),
    },
    devicePlantConfiguration: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'delivery-1', ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'delivery-1',
        configurationId: configId,
        version: 1,
        status: DevicePlantConfigurationStatus.SENT,
      }),
    },
  };
  const authorization = {
    requireRole: vi.fn().mockResolvedValue({ role: UserRole.OWNER }),
  };
  const mqtt = { isConnected: vi.fn().mockReturnValue(true), publish: vi.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    mqtt,
    authorization,
    service: new DevicePlantConfigurationService(prisma as never, authorization as never, mqtt as never),
  };
}

describe('DevicePlantConfigurationService', () => {
  it('publishes only a published catalog sensor selection on the separate config topic with QoS 1', async () => {
    const h = harness();
    const result = await h.service.apply('org-a', 'device-db-1', {
      configurationId: configId,
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['air_temperature', 'relative_humidity'],
    }, actor);

    expect(result.status).toBe(DevicePlantConfigurationStatus.SENT);
    expect(h.authorization.requireRole).toHaveBeenCalledWith('owner-a', 'org-a', [UserRole.OWNER, UserRole.ADMIN]);
    expect(h.prisma.plantCatalogVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: PlantVersionStatus.PUBLISHED }),
    }));
    expect(h.mqtt.publish).toHaveBeenCalledWith(
      'greenhouse/GH-1/esp-1/config',
      expect.any(String),
      { qos: 1, retain: false },
    );
    expect(JSON.parse(h.mqtt.publish.mock.calls[0][1] as string)).toMatchObject({
      type: 'plant_config',
      mode: 'monitoring_only',
      parameterKeys: ['air_temperature', 'relative_humidity'],
      sensorCodes: ['temperature', 'humidity'],
    });
    expect(h.mqtt.publish.mock.calls[0][0]).not.toContain('/command');
  });

  it('rejects catalog parameters without a supported sensor mapping and sends nothing', async () => {
    const h = harness();
    h.prisma.plantCatalogVersion.findFirst.mockResolvedValue({
      id: 'catalog-version-1',
      status: PlantVersionStatus.PUBLISHED,
      parameterDefinitions: [{ parameterKey: 'nutrient_solution_ph' }],
    });

    await expect(h.service.apply('org-a', 'device-db-1', {
      configurationId: configId,
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['nutrient_solution_ph'],
    }, actor)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(h.prisma.devicePlantConfiguration.create).not.toHaveBeenCalled();
    expect(h.mqtt.publish).not.toHaveBeenCalled();
  });

  it('requires a current online device with the matching firmware capability', async () => {
    const h = harness();
    h.prisma.deviceStatusLog.findFirst.mockResolvedValue({
      rawPayload: { capabilities: { plantConfiguration: 'unsupported/v0' } },
      receivedAt: new Date(),
    });

    await expect(h.service.apply('org-a', 'device-db-1', {
      configurationId: configId,
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['air_temperature'],
    }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(h.mqtt.publish).not.toHaveBeenCalled();
  });

  it('does not access or publish device configuration for a user without the required organization role', async () => {
    const h = harness();
    h.authorization.requireRole.mockRejectedValue(new ForbiddenException());

    await expect(h.service.apply('org-a', 'device-db-1', {
      configurationId: configId,
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['air_temperature'],
    }, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.device.findFirst).not.toHaveBeenCalled();
    expect(h.mqtt.publish).not.toHaveBeenCalled();
  });

  it('does not republish a configuration idempotency key already applied', async () => {
    const h = harness();
    const existing = {
      configurationId: configId,
      organizationId: 'org-a',
      deviceId: 'device-db-1',
      catalogVersionId: 'catalog-version-1',
      payload: { parameterKeys: ['air_temperature'] },
      status: DevicePlantConfigurationStatus.APPLIED,
    };
    h.prisma.devicePlantConfiguration.findUnique.mockResolvedValue(existing);

    await expect(h.service.apply('org-a', 'device-db-1', {
      configurationId: configId,
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['air_temperature'],
    }, actor)).resolves.toBe(existing);
    expect(h.mqtt.publish).not.toHaveBeenCalled();
  });

  it('rejects reusing a configuration id with different parameters', async () => {
    const h = harness();
    h.prisma.devicePlantConfiguration.findUnique.mockResolvedValue({
      configurationId: configId,
      organizationId: 'org-a',
      deviceId: 'device-db-1',
      catalogVersionId: 'catalog-version-1',
      payload: { parameterKeys: ['relative_humidity'] },
      status: DevicePlantConfigurationStatus.APPLIED,
    });

    await expect(h.service.apply('org-a', 'device-db-1', {
      configurationId: configId,
      catalogVersionId: 'catalog-version-1',
      parameterKeys: ['air_temperature'],
    }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(h.mqtt.publish).not.toHaveBeenCalled();
  });

  it('correlates an applied ACK by device, greenhouse, configuration id and version', async () => {
    const h = harness();
    h.prisma.devicePlantConfiguration.findFirst.mockResolvedValue({
      id: 'delivery-1',
      version: 3,
      status: DevicePlantConfigurationStatus.SENT,
      receivedAt: null,
    });

    await h.service.handleAcknowledgement('GH-1', 'esp-1', {
      type: 'plant_config',
      configurationId: configId,
      version: 3,
      status: 'APPLIED',
    });
    expect(h.prisma.devicePlantConfiguration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'delivery-1' }),
      data: expect.objectContaining({ status: DevicePlantConfigurationStatus.APPLIED, appliedAt: expect.any(Date) }),
    }));
  });

  it('ignores ACKs with a mismatched version', async () => {
    const h = harness();
    h.prisma.devicePlantConfiguration.findFirst.mockResolvedValue({
      id: 'delivery-1',
      version: 3,
      status: DevicePlantConfigurationStatus.SENT,
    });

    await h.service.handleAcknowledgement('GH-1', 'esp-1', {
      type: 'plant_config',
      configurationId: configId,
      version: 2,
      status: 'APPLIED',
    });
    expect(h.prisma.devicePlantConfiguration.updateMany).not.toHaveBeenCalled();
  });
});
