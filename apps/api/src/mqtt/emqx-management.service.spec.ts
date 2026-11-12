import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EmqxManagementService } from './emqx-management.service.js';

describe('EmqxManagementService', () => {
  let config: { get: ReturnType<typeof vi.fn> };
  let service: EmqxManagementService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = {
      get: vi.fn((key: string) => ({
        'mqtt.managementUrl': 'http://localhost:18083/api/v5',
        'mqtt.managementKey': 'unit-test-key',
        'mqtt.managementSecret': 'unit-test-secret',
        'app.nodeEnv': 'test',
      })[key]),
    };
    service = new EmqxManagementService(config as unknown as ConfigService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('creates users and installs exact allow rules using the EMQX Management API', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    await service.provisionUser('ESP-1', 'one-time-password', [
      { permission: 'allow', action: 'publish', topic: 'greenhouse/GH-1/ESP-1/telemetry' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][0].toString()).toContain('/api/v5/authentication/password_based:built_in_database/users');
    expect(fetchMock.mock.calls[3][0].toString()).toContain('/api/v5/authorization/sources/built_in_database/rules/users');
    expect(fetchMock.mock.calls[3][1].body).toContain('greenhouse/GH-1/ESP-1/telemetry');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);
  });

  it('fails closed when broker management credentials are absent', async () => {
    config.get.mockReturnValue(undefined);

    await expect(service.provisionUser('ESP-1', 'password', [])).rejects.toThrow(
      'EMQX management API credentials are not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires HTTPS for the management API in production', async () => {
    config.get.mockImplementation((key: string) => ({
      'mqtt.managementUrl': 'http://broker.example/api/v5',
      'mqtt.managementKey': 'unit-test-key',
      'mqtt.managementSecret': 'unit-test-secret',
      'app.nodeEnv': 'production',
    })[key]);

    await expect(service.provisionUser('ESP-1', 'password', [])).rejects.toThrow(
      'EMQX management API must use HTTPS in production',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
