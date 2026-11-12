import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeviceStatus, Prisma } from '@prisma/client';
import {
  TelemetryPayload,
  StatusPayload,
  SensorReading,
} from './interfaces/telemetry.interfaces.js';

@Injectable()
export class TelemetryPersistenceService {
  private readonly logger = new Logger(TelemetryPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve only an explicitly registered device whose greenhouse matches the topic. */
  async resolveDevice(
    deviceMqttId: string,
    topicGreenhouseId?: string,
  ): Promise<{ id: string; greenhouseId: string } | null> {
    const topicGreenhouse = topicGreenhouseId
      ? await this.prisma.greenhouse.findFirst({
          where: {
            OR: [{ id: topicGreenhouseId }, { code: topicGreenhouseId }],
            deletedAt: null,
          },
          select: { id: true, code: true },
        })
      : null;
    if (topicGreenhouseId && !topicGreenhouse) {
      this.logger.warn(`[DEVICE_GREENHOUSE_UNKNOWN] device=${deviceMqttId} greenhouse=${topicGreenhouseId}`);
      return null;
    }

    const existing = await this.prisma.device.findFirst({
      where: { deviceId: deviceMqttId, deletedAt: null },
      select: { id: true, greenhouseId: true },
    });
    if (existing) {
      if (topicGreenhouse && existing.greenhouseId !== topicGreenhouse.id) {
        this.logger.warn(`[DEVICE_GREENHOUSE_MISMATCH] device=${deviceMqttId} greenhouse=${topicGreenhouseId}`);
        return null;
      }
      return existing;
    }

    this.logger.warn(`[DEVICE_NOT_REGISTERED] device=${deviceMqttId} greenhouse=${topicGreenhouseId ?? 'unspecified'}`);
    return null;
  }

  /**
   * Resolve sensor IDs by code for a given device.
   * Auto-provisions missing sensors if they don't exist yet.
   */
  async resolveSensors(
    deviceDbId: string,
    codes: string[],
    rawReadings?: SensorReading[],
  ): Promise<Map<string, { id: string; unit: string | null }>> {
    const sensors = await this.prisma.sensor.findMany({
      where: {
        deviceId: deviceDbId,
        code: { in: codes },
        deletedAt: null,
        enabled: true,
      },
      select: { id: true, code: true, unit: true },
    });

    const existingCodes = new Set(sensors.map((s) => s.code));
    for (const code of codes) {
      if (!existingCodes.has(code)) {
        try {
          const raw = rawReadings?.find((r) => r.code === code);
          const name = code.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
          const created = await this.prisma.sensor.create({
            data: {
              deviceId: deviceDbId,
              code,
              name,
              sensorType: 'ANALOG_DIGITAL',
              unit: raw?.unit ?? null,
              enabled: true,
            },
            select: { id: true, code: true, unit: true },
          });
          sensors.push(created);
          this.logger.log(`[AUTO_PROVISION_SENSOR] Created sensor "${code}" for device "${deviceDbId}"`);
        } catch {
          // Ignore unique race condition
        }
      }
    }

    const map = new Map<string, { id: string; unit: string | null }>();
    for (const s of sensors) {
      map.set(s.code, { id: s.id, unit: s.unit });
    }
    return map;
  }

  /**
   * Persist one telemetry batch to PostgreSQL.
   * This is called asynchronously after Redis has been updated.
   */
  async persistTelemetry(
    deviceDbId: string,
    deviceMqttId: string,
    greenhouseId: string,
    payload: TelemetryPayload,
    rawPayload: unknown,
    sensorMap: Map<string, { id: string; unit: string | null }>,
  ): Promise<string> {
    const deviceTs =
      payload.ts ? new Date(payload.ts) : new Date();

    const values: Prisma.TelemetryValueCreateManyRecordInput[] =
      payload.sensors.map((reading: SensorReading) => {
        const sensor = sensorMap.get(reading.code);
        return {
          sensorId: sensor?.id ?? null,
          sensorCode: reading.code,
          numericValue: typeof reading.value === 'number' ? reading.value : null,
          stringValue: null,
          unit: reading.unit ?? sensor?.unit ?? null,
          timestamp: deviceTs,
        };
      });

    try {
      const record = await this.prisma.telemetryRecord.create({
        data: {
          deviceId: deviceDbId,
          deviceMqttId,
          greenhouseId,
          sequenceNumber: payload.seq ?? null,
          processedAt: new Date(),
          rawPayload: rawPayload as Prisma.InputJsonValue,
          values: {
            createMany: { data: values },
          },
        },
        select: { id: true },
      });

      this.logger.debug(
        `[PERSIST_TELEMETRY] record=${record.id} device=${deviceMqttId} values=${values.length}`,
      );

      return record.id;
    } catch (err: any) {
      if (err.code === 'P2002') {
        this.logger.warn(`[PERSIST_TELEMETRY_DUPLICATE] Ignored duplicate sequence=${payload.seq} for device=${deviceMqttId}`);
        return '';
      }
      throw err;
    }
  }

  /**
   * Update device status in devices table and persist a DeviceStatusLog.
   */
  async persistDeviceStatus(
    deviceDbId: string | null,
    deviceMqttId: string,
    greenhouseId: string,
    payload: StatusPayload,
    rawPayload: unknown,
  ): Promise<void> {
    const dbStatus =
      payload.status === 'online' ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE;

    // Update device row if registered
    if (deviceDbId) {
      await this.prisma.device.update({
        where: { id: deviceDbId },
        data: {
          status: dbStatus,
          lastSeenAt: new Date(),
        },
      });
    }

    // Always log status
    await this.prisma.deviceStatusLog.create({
      data: {
        deviceMqttId,
        greenhouseId,
        status: dbStatus,
        ipAddress: payload.ip ?? null,
        rssi: payload.rssi ?? null,
        freeHeap: payload.free_heap ?? null,
        uptime: payload.uptime ?? null,
        firmwareVersion: payload.firmware ?? null,
        rawPayload: rawPayload as Prisma.InputJsonValue,
      },
    });

    this.logger.debug(
      `[PERSIST_STATUS] device=${deviceMqttId} status=${payload.status}`,
    );
  }

  /**
   * Get historical telemetry records for a device.
   */
  async getDeviceHistory(deviceMqttId: string, limit = 100, from?: string, to?: string) {
    const where: any = { deviceMqttId };
    
    if (from || to) {
      where.receivedAt = {};
      if (from) where.receivedAt.gte = new Date(from);
      if (to) where.receivedAt.lte = new Date(to);
    }

    return this.prisma.telemetryRecord.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
      include: {
        values: {
          orderBy: { sensorCode: 'asc' },
        },
      },
    });
  }

  /**
   * Get status logs for a device.
   */
  async getDeviceStatusLogs(deviceMqttId: string, limit = 50) {
    return this.prisma.deviceStatusLog.findMany({
      where: { deviceMqttId },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get telemetry statistics for a greenhouse.
   */
  async getGreenhouseStats(greenhouseId: string) {
    const [totalRecords, lastRecord] = await Promise.all([
      this.prisma.telemetryRecord.count({ where: { greenhouseId } }),
      this.prisma.telemetryRecord.findFirst({
        where: { greenhouseId },
        orderBy: { receivedAt: 'desc' },
        select: { receivedAt: true, deviceMqttId: true },
      }),
    ]);

    return { totalRecords, lastRecord };
  }
}