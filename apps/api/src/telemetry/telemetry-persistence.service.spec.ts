import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryPersistenceService } from './telemetry-persistence.service.js';

describe('TelemetryPersistenceService.resolveDevice', () => {
  const greenhouse = { id: 'greenhouse-db-1', code: 'GH-1' };
  let prisma: {
    device: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    greenhouse: { findFirst: ReturnType<typeof vi.fn> };
  };
  let service: TelemetryPersistenceService;

  beforeEach(() => {
    prisma = {
      device: { findFirst: vi.fn() },
      greenhouse: { findFirst: vi.fn() },
    };
    service = new TelemetryPersistenceService(prisma as never);
  });

  it('resolves a registered device only when its greenhouse matches the topic', async () => {
    prisma.greenhouse.findFirst.mockResolvedValue(greenhouse);
    prisma.device.findFirst.mockResolvedValue({ id: 'device-db-1', greenhouseId: greenhouse.id });

    await expect(service.resolveDevice('ESP-1', 'GH-1')).resolves.toEqual({
      id: 'device-db-1',
      greenhouseId: greenhouse.id,
    });
    expect(prisma.greenhouse.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'GH-1' }, { code: 'GH-1' }], deletedAt: null },
      select: { id: true, code: true },
    });
  });

  it('rejects a registered device whose greenhouse does not match the topic', async () => {
    prisma.greenhouse.findFirst.mockResolvedValue(greenhouse);
    prisma.device.findFirst.mockResolvedValue({ id: 'device-db-1', greenhouseId: 'other-greenhouse' });

    await expect(service.resolveDevice('ESP-1', 'GH-1')).resolves.toBeNull();
  });

  it('does not auto-provision a device for an unknown greenhouse topic', async () => {
    prisma.greenhouse.findFirst.mockResolvedValue(null);

    await expect(service.resolveDevice('ESP-1', 'UNKNOWN-GH')).resolves.toBeNull();
    expect(prisma.device.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unknown device instead of auto-provisioning it', async () => {
    prisma.greenhouse.findFirst.mockResolvedValue(greenhouse);
    prisma.device.findFirst.mockResolvedValue(null);

    await expect(service.resolveDevice('ESP-1', 'GH-1')).resolves.toBeNull();
    expect(prisma.device.findFirst).toHaveBeenCalledWith({
      where: { deviceId: 'ESP-1', deletedAt: null },
      select: { id: true, greenhouseId: true },
    });
  });
});
