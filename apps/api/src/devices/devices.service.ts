import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async update(id: string, updateDeviceDto: UpdateDeviceDto) {
    await this.findOne(id);
    if (updateDeviceDto.deviceId) {
      const existing = await this.prisma.device.findFirst({
        where: { deviceId: updateDeviceDto.deviceId, id: { not: id } },
      });
      if (existing) throw new ConflictException('Device ID already exists');
    }
    return this.prisma.device.update({
      where: { id },
      data: updateDeviceDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
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
