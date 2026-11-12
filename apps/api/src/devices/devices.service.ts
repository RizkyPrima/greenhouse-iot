import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { MqttDeviceProvisioningService } from './mqtt-device-provisioning.service.js';

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqttProvisioning: MqttDeviceProvisioningService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(createDeviceDto: CreateDeviceDto) {
    const gh = await this.prisma.greenhouse.findUnique({ where: { id: createDeviceDto.greenhouseId } });
    if (!gh) throw new NotFoundException('Greenhouse not found');

    if (createDeviceDto.zoneId) {
      const zone = await this.prisma.zone.findFirst({
        where: { id: createDeviceDto.zoneId, greenhouseId: createDeviceDto.greenhouseId }
      });
      if (!zone) throw new ConflictException('Zone does not belong to the greenhouse or does not exist');
    }

    const existing = await this.prisma.device.findUnique({
      where: { deviceId: createDeviceDto.deviceId },
    });
    if (existing) throw new ConflictException('Device ID already exists');

    return this.prisma.device.create({ data: createDeviceDto });
  }

  findAll(userId: string, organizationId?: string) {
    return this.prisma.device.findMany({
      where: {
        deletedAt: null,
        greenhouse: {
          deletedAt: null,
          ...(organizationId ? { organizationId } : {}),
          organization: { memberships: { some: { userId } } },
        },
      },
    });
  }

  async findOne(id: string) {
    const device = await this.prisma.device.findFirst({ where: { id, deletedAt: null } });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async update(id: string, updateDeviceDto: UpdateDeviceDto, userId: string) {
    const device = await this.findOne(id);
    const targetGreenhouseId = updateDeviceDto.greenhouseId ?? device.greenhouseId;
    if (updateDeviceDto.greenhouseId !== undefined) {
      const targetGreenhouse = await this.prisma.greenhouse.findFirst({
        where: { id: targetGreenhouseId, deletedAt: null },
        select: { id: true, organizationId: true },
      });
      if (!targetGreenhouse) throw new NotFoundException('Greenhouse not found');
      await this.authorization.requireRole(userId, targetGreenhouse.organizationId, [
        UserRole.OWNER,
        UserRole.ADMIN,
      ]);
    }

    if (updateDeviceDto.zoneId !== undefined) {
      const zone = await this.prisma.zone.findFirst({
        where: { id: updateDeviceDto.zoneId, greenhouseId: targetGreenhouseId, deletedAt: null },
        select: { id: true },
      });
      if (!zone) throw new ConflictException('Zone does not belong to the greenhouse or does not exist');
    } else if (updateDeviceDto.greenhouseId !== undefined && device.zoneId) {
      const existingZone = await this.prisma.zone.findFirst({
        where: { id: device.zoneId, greenhouseId: targetGreenhouseId, deletedAt: null },
        select: { id: true },
      });
      if (!existingZone) {
        throw new ConflictException('Clear or replace the device zone before moving it to another greenhouse');
      }
    }

    if (updateDeviceDto.deviceId) {
      const existing = await this.prisma.device.findFirst({
        where: { deviceId: updateDeviceDto.deviceId, id: { not: id } },
      });
      if (existing) throw new ConflictException('Device ID already exists');
    }
    if (
      (updateDeviceDto.deviceId && updateDeviceDto.deviceId !== device.deviceId) ||
      (updateDeviceDto.greenhouseId && updateDeviceDto.greenhouseId !== device.greenhouseId)
    ) {
      await this.mqttProvisioning.revoke(device.deviceId);
    }
    return this.prisma.device.update({
      where: { id },
      data: updateDeviceDto,
    });
  }

  async remove(id: string) {
    const device = await this.findOne(id);
    await this.mqttProvisioning.revoke(device.deviceId);
    return this.prisma.device.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findSensors(id: string) {
    await this.findOne(id);
    return this.prisma.sensor.findMany({ where: { deviceId: id, deletedAt: null } });
  }

  async findActuators(id: string) {
    await this.findOne(id);
    return this.prisma.actuator.findMany({ where: { deviceId: id, deletedAt: null } });
  }
}
