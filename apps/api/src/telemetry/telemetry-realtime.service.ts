import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import {
  RealtimeDeviceState,
  RealtimeSensorState,
} from './interfaces/telemetry.interfaces.js';

// Redis key patterns:
//   realtime:device:{deviceMqttId}          -> RealtimeDeviceState JSON
//   realtime:greenhouse:{greenhouseId}:devices -> Set of deviceMqttId's

const DEVICE_STATE_TTL = 3600; // 1 hour

@Injectable()
export class TelemetryRealtimeService {
  private readonly logger = new Logger(TelemetryRealtimeService.name);

  constructor(private readonly redis: RedisService) {}

  // ─── Key helpers ────────────────────────────────────────────────────────────

  private deviceKey(deviceMqttId: string): string {
    return `realtime:device:${deviceMqttId}`;
  }

  private greenhouseDevicesKey(greenhouseId: string): string {
    return `realtime:greenhouse:${greenhouseId}:devices`;
  }

  // ─── Write ──────────────────────────────────────────────────────────────────

  async updateDeviceState(state: RealtimeDeviceState): Promise<void> {
    const key = this.deviceKey(state.deviceMqttId);
    await this.redis.set(key, JSON.stringify(state), DEVICE_STATE_TTL);

    // Track which devices belong to this greenhouse
    await this.redis
      .getClient()
      .sadd(this.greenhouseDevicesKey(state.greenhouseId), state.deviceMqttId);

    this.logger.debug(
      `[REALTIME_UPDATE] device="${state.deviceMqttId}" sensors=${Object.keys(state.sensors).length}`,
    );
  }

  async updateDeviceStatus(
    deviceMqttId: string,
    greenhouseId: string,
    status: string,
    lastSeenAt: string,
  ): Promise<void> {
    const key = this.deviceKey(deviceMqttId);
    const existing = await this.getDeviceState(deviceMqttId);

    const state: RealtimeDeviceState = existing ?? {
      deviceMqttId,
      greenhouseId,
      status,
      lastSeenAt,
      lastTelemetryAt: null,
      sensors: {},
    };

    state.status = status;
    state.lastSeenAt = lastSeenAt;

    await this.redis.set(key, JSON.stringify(state), DEVICE_STATE_TTL);
    await this.redis
      .getClient()
      .sadd(this.greenhouseDevicesKey(greenhouseId), deviceMqttId);
  }

  async updateDeviceSequence(deviceMqttId: string, sequence: number): Promise<void> {
    const key = this.deviceKey(deviceMqttId);
    const existing = await this.getDeviceState(deviceMqttId);
    if (existing) {
      existing.sequence = sequence;
      await this.redis.set(key, JSON.stringify(existing), DEVICE_STATE_TTL);
    }
  }

  async updateSensorReading(
    deviceMqttId: string,
    greenhouseId: string,
    sensorState: RealtimeSensorState,
  ): Promise<void> {
    const key = this.deviceKey(deviceMqttId);
    const existing = await this.getDeviceState(deviceMqttId);

    const state: RealtimeDeviceState = existing ?? {
      deviceMqttId,
      greenhouseId,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      lastTelemetryAt: new Date().toISOString(),
      sensors: {},
    };

    state.sensors[sensorState.sensorCode] = sensorState;
    state.lastTelemetryAt = new Date().toISOString();

    await this.redis.set(key, JSON.stringify(state), DEVICE_STATE_TTL);
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  async getDeviceState(
    deviceMqttId: string,
  ): Promise<RealtimeDeviceState | null> {
    const raw = await this.redis.get(this.deviceKey(deviceMqttId));
    if (!raw) return null;
    try {
      const state = JSON.parse(raw) as RealtimeDeviceState;
      if (state.lastSeenAt && state.status !== 'offline') {
        const lastSeen = new Date(state.lastSeenAt).getTime();
        const diffSecs = (Date.now() - lastSeen) / 1000;
        
        if (diffSecs <= 15) {
          state.status = 'online';
        } else if (diffSecs <= 30) {
          state.status = 'stale';
        } else {
          state.status = 'offline';
        }
      }
      return state;
    } catch {
      return null;
    }
  }

  async getGreenhouseDeviceIds(greenhouseId: string): Promise<string[]> {
    return this.redis
      .getClient()
      .smembers(this.greenhouseDevicesKey(greenhouseId));
  }

  async getAllGreenhouseDeviceStates(
    greenhouseId: string,
  ): Promise<RealtimeDeviceState[]> {
    const ids = await this.getGreenhouseDeviceIds(greenhouseId);
    if (ids.length === 0) return [];

    const states = await Promise.all(
      ids.map((id) => this.getDeviceState(id)),
    );
    return states.filter((s): s is RealtimeDeviceState => s !== null);
  }
}