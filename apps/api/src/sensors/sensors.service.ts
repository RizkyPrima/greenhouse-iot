import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSensorDto } from './dto/create-sensor.dto.js';
import { UpdateSensorDto } from './dto/update-sensor.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class SensorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSensorDto: CreateSensorDto) {
    const device = await this.prisma.device.findUnique({ where: { id: createSensorDto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const existing = await this.prisma.sensor.findUnique({
      where: { deviceId_code: { deviceId: createSensorDto.deviceId, code: createSensorDto.code } },
    });
    if (existing) throw new ConflictException('Sensor code already exists for this device');

    const data: Prisma.SensorCreateInput = {
      name: createSensorDto.name,
      code: createSensorDto.code,
      sensorType: createSensorDto.sensorType,
      unit: createSensorDto.unit,
      enabled: createSensorDto.enabled,
      metadata: createSensorDto.metadata ? (createSensorDto.metadata as any) : Prisma.JsonNull,
      device: { connect: { id: createSensorDto.deviceId } },
      zone: createSensorDto.zoneId ? { connect: { id: createSensorDto.zoneId } } : undefined,
    };

    return this.prisma.sensor.create({ data });
  }

  findAll(userId: string) {
    return this.prisma.sensor.findMany({
      where: { deletedAt: null, device: { greenhouse: { organization: { memberships: { some: { userId } } } } } },
    });
  }

  async findOne(id: string) {
    const sensor = await this.prisma.sensor.findFirst({ where: { id, deletedAt: null } });
    if (!sensor) throw new NotFoundException('Sensor not found');
    return sensor;
  }

  async update(id: string, updateSensorDto: UpdateSensorDto) {
    const sensor = await this.findOne(id);
    if (updateSensorDto.code) {
      const existing = await this.prisma.sensor.findFirst({
        where: { deviceId: sensor.deviceId, code: updateSensorDto.code, id: { not: id } },
      });
      if (existing) throw new ConflictException('Sensor code already exists for this device');
    }

    const data: Prisma.SensorUpdateInput = {
      name: updateSensorDto.name,
      code: updateSensorDto.code,
      sensorType: updateSensorDto.sensorType,
      unit: updateSensorDto.unit,
      enabled: updateSensorDto.enabled,
      metadata: updateSensorDto.metadata !== undefined ? (updateSensorDto.metadata as any) : undefined,
    };
    if (updateSensorDto.zoneId) {
      data.zone = { connect: { id: updateSensorDto.zoneId } };
    }

    return this.prisma.sensor.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.sensor.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
