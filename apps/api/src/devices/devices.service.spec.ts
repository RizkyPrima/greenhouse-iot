import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DevicesService } from './devices.service.js';

describe('DevicesService.update tenant and greenhouse boundaries', () => {
  let prisma: {
    device: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    greenhouse: { findFirst: ReturnType<typeof vi.fn> };
    zone: { findFirst: ReturnType<typeof vi.fn> };
  };
  let mqttProvisioning: { revoke: ReturnType<typeof vi.fn> };
  let authorization: { requireRole: ReturnType<typeof vi.fn> };
  let service: DevicesService;

  beforeEach(() => {
    prisma = {
      device: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'device-db-id',
          deviceId: 'ESP-1',
          greenhouseId: 'old-greenhouse',
          zoneId: null,
        }),
        update: vi.fn().mockResolvedValue({ id: 'device-db-id' }),
      },
      greenhouse: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'new-greenhouse',
          organizationId: 'new-organization',
        }),
      },
      zone: { findFirst: vi.fn() },
    };
    mqttProvisioning = { revoke: vi.fn().mockResolvedValue(undefined) };
    authorization = { requireRole: vi.fn().mockResolvedValue(undefined) };
    service = new DevicesService(
      prisma as never,
      mqttProvisioning as never,
      authorization as never,
    );
  });

  it('requires OWNER or ADMIN membership in the target greenhouse organization and revokes old topic ACLs', async () => {
    await service.update(
      'device-db-id',
      { greenhouseId: 'new-greenhouse' },
      'user-1',
    );

    expect(authorization.requireRole).toHaveBeenCalledWith(
      'user-1',
      'new-organization',
      ['OWNER', 'ADMIN'],
    );
    expect(mqttProvisioning.revoke).toHaveBeenCalledWith('ESP-1');
    expect(prisma.device.update).toHaveBeenCalled();
  });

  it('does not move the device when the user has no target-tenant membership', async () => {
    authorization.requireRole.mockRejectedValue(new ForbiddenException());

    await expect(service.update(
      'device-db-id',
      { greenhouseId: 'new-greenhouse' },
      'user-1',
    )).rejects.toThrow(ForbiddenException);

    expect(mqttProvisioning.revoke).not.toHaveBeenCalled();
    expect(prisma.device.update).not.toHaveBeenCalled();
  });

  it('rejects a zone that is not in the destination greenhouse', async () => {
    prisma.zone.findFirst.mockResolvedValue(null);

    await expect(service.update(
      'device-db-id',
      { greenhouseId: 'new-greenhouse', zoneId: 'foreign-zone' },
      'user-1',
    )).rejects.toThrow(ConflictException);

    expect(mqttProvisioning.revoke).not.toHaveBeenCalled();
    expect(prisma.device.update).not.toHaveBeenCalled();
  });
});
