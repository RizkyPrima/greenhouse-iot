import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateActuatorDto } from './dto/create-actuator.dto.js';
import { UpdateActuatorDto } from './dto/update-actuator.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class ActuatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createActuatorDto: CreateActuatorDto) {
    const device = await this.prisma.device.findUnique({ where: { id: createActuatorDto.deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const existing = await this.prisma.actuator.findUnique({
      where: { deviceId_code: { deviceId: createActuatorDto.deviceId, code: createActuatorDto.code } },
    });
    if (existing) throw new ConflictException('Actuator code already exists for this device');

    const data: Prisma.ActuatorCreateInput = {
      name: createActuatorDto.name,
      code: createActuatorDto.code,
      actuatorType: createActuatorDto.actuatorType,
      enabled: createActuatorDto.enabled,
      metadata: createActuatorDto.metadata ? (createActuatorDto.metadata as any) : Prisma.JsonNull,
      device: { connect: { id: createActuatorDto.deviceId } },
      zone: createActuatorDto.zoneId ? { connect: { id: createActuatorDto.zoneId } } : undefined,
    };

    return this.prisma.actuator.create({ data });
  }

  findAll(userId: string) {
    return this.prisma.actuator.findMany({
      where: { deletedAt: null, device: { greenhouse: { organization: { memberships: { some: { userId } } } } } },
    });
  }

  async findOne(id: string) {
    const actuator = await this.prisma.actuator.findFirst({ where: { id, deletedAt: null } });
    if (!actuator) throw new NotFoundException('Actuator not found');
    return actuator;
  }

  async update(id: string, updateActuatorDto: UpdateActuatorDto) {
    const actuator = await this.findOne(id);
    if (updateActuatorDto.code) {
      const existing = await this.prisma.actuator.findFirst({
        where: { deviceId: actuator.deviceId, code: updateActuatorDto.code, id: { not: id } },
      });
      if (existing) throw new ConflictException('Actuator code already exists for this device');
    }

    const data: Prisma.ActuatorUpdateInput = {
      name: updateActuatorDto.name,
      code: updateActuatorDto.code,
      actuatorType: updateActuatorDto.actuatorType,
      enabled: updateActuatorDto.enabled,
      metadata: updateActuatorDto.metadata !== undefined ? (updateActuatorDto.metadata as any) : undefined,
    };
    if (updateActuatorDto.zoneId) {
      data.zone = { connect: { id: updateActuatorDto.zoneId } };
    }

    return this.prisma.actuator.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.actuator.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
