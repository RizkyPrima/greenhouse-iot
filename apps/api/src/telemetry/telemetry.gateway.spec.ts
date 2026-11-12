import { describe, expect, it, vi } from 'vitest';
import { TelemetryGateway } from './telemetry.gateway.js';

describe('TelemetryGateway', () => {
  function gateway() {
    const roomEmit = vi.fn();
    const server = {
      to: vi.fn(() => ({ emit: roomEmit })),
      emit: vi.fn(),
    };
    const instance = new TelemetryGateway({} as never, {} as never, {} as never);
    instance.server = server as never;
    return { instance, roomEmit, server };
  }

  it('sends telemetry only to authorized greenhouse and device rooms', () => {
    const { instance, roomEmit, server } = gateway();

    instance.broadcastTelemetry('GH-1', 'ESP-1', { sensors: [] });

    expect(server.to).toHaveBeenNthCalledWith(1, 'greenhouse:GH-1');
    expect(server.to).toHaveBeenNthCalledWith(2, 'device:ESP-1');
    expect(roomEmit).toHaveBeenCalledTimes(2);
    expect(roomEmit).toHaveBeenCalledWith('telemetry:update', expect.objectContaining({
      greenhouseId: 'GH-1',
      deviceMqttId: 'ESP-1',
    }));
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('sends status only to authorized greenhouse and device rooms', () => {
    const { instance, roomEmit, server } = gateway();

    instance.broadcastStatus('GH-1', 'ESP-1', 'online', '2026-11-12T00:00:00.000Z');

    expect(server.to).toHaveBeenNthCalledWith(1, 'greenhouse:GH-1');
    expect(server.to).toHaveBeenNthCalledWith(2, 'device:ESP-1');
    expect(roomEmit).toHaveBeenCalledTimes(2);
    expect(roomEmit).toHaveBeenCalledWith('status:update', expect.objectContaining({
      greenhouseId: 'GH-1',
      deviceMqttId: 'ESP-1',
      status: 'online',
    }));
    expect(server.emit).not.toHaveBeenCalled();
  });

  it('rejects WebSocket authentication when JWT_SECRET is not configured', async () => {
    const jwt = { verifyAsync: vi.fn() };
    const config = { getOrThrow: vi.fn(() => { throw new Error('JWT_SECRET is not configured'); }) };
    const instance = new TelemetryGateway(jwt as never, config as never, {} as never);
    const client = {
      id: 'socket-1',
      handshake: { auth: { token: 'test-token' }, headers: {} },
      emit: vi.fn(),
      disconnect: vi.fn(),
      data: {},
    };

    await instance.handleConnection(client as never);

    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
