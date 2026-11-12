import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  EmqxManagementService,
  type EmqxAuthorizationRule,
} from '../mqtt/emqx-management.service.js';

const DEVICE_TOPIC_SEGMENT = /^[A-Za-z0-9._-]{1,50}$/;
const DEVICE_PUBLISH_TOPICS = ['telemetry', 'status', 'event', 'alarm', 'response'] as const;
const DEVICE_SUBSCRIBE_TOPICS = ['command', 'config'] as const;

@Injectable()
export class MqttDeviceProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emqx: EmqxManagementService,
  ) {}

  async provision(deviceId: string): Promise<{
    deviceId: string;
    greenhouseId: string;
    username: string;
    password: string;
  }> {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        deletedAt: null,
        greenhouse: { deletedAt: null },
      },
      select: {
        deviceId: true,
        greenhouse: { select: { id: true, code: true } },
      },
    });
    if (!device) throw new NotFoundException('Active registered device not found');

    const greenhouseIds = [...new Set([device.greenhouse.code, device.greenhouse.id])];
    if (
      !DEVICE_TOPIC_SEGMENT.test(device.deviceId) ||
      greenhouseIds.some((greenhouseId) => !DEVICE_TOPIC_SEGMENT.test(greenhouseId))
    ) {
      throw new BadRequestException('Device or greenhouse identity is not valid for MQTT topics');
    }

    const rules: EmqxAuthorizationRule[] = greenhouseIds.flatMap((greenhouseId) => {
      const base = `greenhouse/${greenhouseId}/${device.deviceId}`;
      return [
        ...DEVICE_PUBLISH_TOPICS.map((type) => ({
          permission: 'allow' as const,
          action: 'publish' as const,
          topic: `${base}/${type}`,
        })),
        ...DEVICE_SUBSCRIBE_TOPICS.map((type) => ({
          permission: 'allow' as const,
          action: 'subscribe' as const,
          topic: `${base}/${type}`,
        })),
      ];
    });
    const password = randomBytes(32).toString('base64url');
    const username = `device:${device.deviceId}`;
    await this.emqx.provisionUser(username, password, rules);

    return {
      deviceId: device.deviceId,
      greenhouseId: device.greenhouse.code,
      username,
      password,
    };
  }

  async revoke(deviceId: string): Promise<void> {
    await this.emqx.revokeUser(`device:${deviceId}`);
  }
}
