import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MqttService } from '../mqtt/mqtt.service.js';
import { MqttMessage } from '../mqtt/mqtt.types.js';
import { TelemetryPayload, StatusPayload, SensorReading } from './interfaces/telemetry.interfaces.js';
import { TelemetryRealtimeService } from './telemetry-realtime.service.js';
import { TelemetryPersistenceService } from './telemetry-persistence.service.js';

import { TelemetryGateway } from './telemetry.gateway.js';
import { Optional } from '@nestjs/common';

@Injectable()
export class TelemetryProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryProcessorService.name);
  private unsubscribeHandler: (() => void) | null = null;

  constructor(
    private readonly mqtt: MqttService,
    private readonly realtime: TelemetryRealtimeService,
    private readonly persistence: TelemetryPersistenceService,
    @Optional() private readonly gateway?: TelemetryGateway,
  ) {}

  onModuleInit(): void {
    this.unsubscribeHandler = this.mqtt.onMessage(
      (msg: MqttMessage) => void this.handleMessage(msg),
    );
    this.logger.log('[TELEMETRY_PROCESSOR] MQTT message handler registered');
  }

  onModuleDestroy(): void {
    if (this.unsubscribeHandler) {
      this.unsubscribeHandler();
      this.logger.log('[TELEMETRY_PROCESSOR] MQTT message handler unregistered');
    }
  }

  private async handleMessage(msg: MqttMessage): Promise<void> {
    const { parsedTopic, payload, rawPayload: _raw } = msg;
    if (!parsedTopic) return;

    const { greenhouseId, deviceId: deviceMqttId, messageType } = parsedTopic;

    switch (messageType) {
      case 'telemetry':
        await this.handleTelemetry(greenhouseId, deviceMqttId, payload, msg.payload);
        break;
      case 'status':
        await this.handleStatus(greenhouseId, deviceMqttId, payload, msg.payload);
        break;
      case 'event':
        this.logger.log(`[TELEMETRY_EVENT] greenhouse=${greenhouseId} device=${deviceMqttId}`);
        break;
      case 'alarm':
        this.logger.warn(`[TELEMETRY_ALARM] greenhouse=${greenhouseId} device=${deviceMqttId}`);
        break;
      default:
        break;
    }
  }

  // ─── Telemetry handler ───────────────────────────────────────────────────────

  private async handleTelemetry(
    greenhouseId: string,
    deviceMqttId: string,
    payload: unknown,
    rawPayload: unknown,
  ): Promise<void> {
    const validated = this.validateTelemetryPayload(payload);
    if (!validated) {
      this.logger.warn(`[TELEMETRY_INVALID] device=${deviceMqttId} payload rejected`);
      return;
    }

    const now = new Date().toISOString();

    let isDuplicate = false;
    let isOutOfOrder = false;
    try {
      const state = await this.realtime.getDeviceState(deviceMqttId);
      if (state && state.sequence !== undefined && state.sequence !== null && validated.seq !== undefined) {
        if (validated.seq === state.sequence) {
          isDuplicate = true;
        } else if (validated.seq < state.sequence) {
          isOutOfOrder = true;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[REALTIME_STATE_ERROR] ${msg}`);
    }

    if (isDuplicate) {
      this.logger.warn(`[TELEMETRY_DUPLICATE] device=${deviceMqttId} seq=${validated.seq}`);
      return; // Stop processing duplicate entirely
    }

    if (isOutOfOrder) {
      this.logger.warn(`[TELEMETRY_OUT_OF_ORDER] device=${deviceMqttId} seq=${validated.seq} - skipping realtime update`);
    }

    // ── 1. REALTIME PATH (Redis) ─────────────────────────────────────────────
    if (!isOutOfOrder) {
      try {
        for (const reading of validated.sensors) {
          await this.realtime.updateSensorReading(deviceMqttId, greenhouseId, {
            sensorCode: reading.code,
            sensorId: null, 
            numericValue: reading.value,
            stringValue: null,
            unit: reading.unit ?? null,
            timestamp: validated.ts ? new Date(validated.ts).toISOString() : now,
            deviceMqttId,
            greenhouseId,
          });
        }
        await this.realtime.updateDeviceStatus(deviceMqttId, greenhouseId, 'online', now);
        if (validated.seq !== undefined) {
          await this.realtime.updateDeviceSequence(deviceMqttId, validated.seq);
        }
        this.gateway?.broadcastTelemetry(greenhouseId, deviceMqttId, validated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[REALTIME_ERROR] device=${deviceMqttId}: ${msg}`);
      }
    }

    // ── 2. PERSISTENCE PATH (PostgreSQL) ────────────────────────────────────
    // Fire-and-forget — never blocks realtime path
    this.persistTelemetryAsync(greenhouseId, deviceMqttId, validated, rawPayload);
  }

  private persistTelemetryAsync(
    greenhouseId: string,
    deviceMqttId: string,
    payload: TelemetryPayload,
    rawPayload: unknown,
  ): void {
    void (async () => {
      try {
        const device = await this.persistence.resolveDevice(deviceMqttId);
        if (!device) {
          this.logger.warn(
            `[PERSIST_SKIP] Device "${deviceMqttId}" not registered in DB — telemetry data skipped for persistence`,
          );
          return;
        }

        const codes = payload.sensors.map((s: SensorReading) => s.code);
        const sensorMap = await this.persistence.resolveSensors(device.id, codes);

        await this.persistence.persistTelemetry(
          device.id,
          deviceMqttId,
          greenhouseId,
          payload,
          rawPayload,
          sensorMap,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[PERSIST_ERROR] device=${deviceMqttId}: ${msg}`);
      }
    })();
  }

  // ─── Status handler ──────────────────────────────────────────────────────────

  private async handleStatus(
    greenhouseId: string,
    deviceMqttId: string,
    payload: unknown,
    rawPayload: unknown,
  ): Promise<void> {
    const validated = this.validateStatusPayload(payload);
    if (!validated) {
      this.logger.warn(`[STATUS_INVALID] device=${deviceMqttId} status payload rejected`);
      return;
    }

    const now = new Date().toISOString();

    // ── 1. REALTIME PATH ───────────────────────────────────────────────────
    try {
      const status =
        validated.status === 'online' ? 'online' : 'offline';
      await this.realtime.updateDeviceStatus(deviceMqttId, greenhouseId, status, now);
      this.gateway?.broadcastStatus(greenhouseId, deviceMqttId, status, now);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[REALTIME_STATUS_ERROR] device=${deviceMqttId}: ${msg}`);
    }

    // ── 2. PERSISTENCE PATH ────────────────────────────────────────────────
    this.persistStatusAsync(greenhouseId, deviceMqttId, validated, rawPayload);
  }

  private persistStatusAsync(
    greenhouseId: string,
    deviceMqttId: string,
    payload: StatusPayload,
    rawPayload: unknown,
  ): void {
    void (async () => {
      try {
        const device = await this.persistence.resolveDevice(deviceMqttId);
        await this.persistence.persistDeviceStatus(
          device?.id ?? null,
          deviceMqttId,
          greenhouseId,
          payload,
          rawPayload,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[PERSIST_STATUS_ERROR] device=${deviceMqttId}: ${msg}`);
      }
    })();
  }

  // ─── Validators ──────────────────────────────────────────────────────────────

  private validateTelemetryPayload(payload: unknown): TelemetryPayload | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;

    if (!Array.isArray(p['sensors']) || p['sensors'].length === 0) {
      return null;
    }

    const sensors: { code: string; value: number; unit?: string }[] = [];
    for (const reading of p['sensors']) {
      if (
        typeof reading === 'object' &&
        reading !== null &&
        typeof (reading as Record<string, unknown>)['code'] === 'string' &&
        typeof (reading as Record<string, unknown>)['value'] === 'number'
      ) {
        const r = reading as Record<string, unknown>;
        sensors.push({
          code: r['code'] as string,
          value: r['value'] as number,
          unit: typeof r['unit'] === 'string' ? r['unit'] : undefined,
        });
      }
    }

    if (sensors.length === 0) return null;

    let ts = typeof p['ts'] === 'number' ? p['ts'] : undefined;
    if (ts) {
      const nowMs = Date.now();
      // Tolerance: timestamp cannot be more than 1 hour in the future
      if (ts > nowMs + 3600000) {
        return null;
      }
    }

    return {
      seq: typeof p['seq'] === 'number' ? p['seq'] : undefined,
      ts,
      sensors,
    };
  }

  private validateStatusPayload(payload: unknown): StatusPayload | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;

    if (
      p['status'] !== 'online' &&
      p['status'] !== 'offline' &&
      p['status'] !== 'idle'
    ) {
      return null;
    }

    return {
      status: p['status'] as 'online' | 'offline' | 'idle',
      ip: typeof p['ip'] === 'string' ? p['ip'] : undefined,
      rssi: typeof p['rssi'] === 'number' ? p['rssi'] : undefined,
      free_heap: typeof p['free_heap'] === 'number' ? p['free_heap'] : undefined,
      uptime: typeof p['uptime'] === 'number' ? p['uptime'] : undefined,
      firmware: typeof p['firmware'] === 'string' ? p['firmware'] : undefined,
      ts: typeof p['ts'] === 'number' ? p['ts'] : undefined,
    };
  }
}