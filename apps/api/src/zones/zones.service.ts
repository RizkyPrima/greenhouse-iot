import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateZoneDto } from './dto/create-zone.dto.js';
import { UpdateZoneDto } from './dto/update-zone.dto.js';

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createZoneDto: CreateZoneDto) {
    const gh = await this.prisma.greenhouse.findUnique({ where: { id: createZoneDto.greenhouseId } });
    if (!gh) throw new NotFoundException('Greenhouse not found');

    const existing = await this.prisma.zone.findUnique({
      where: { greenhouseId_code: { greenhouseId: createZoneDto.greenhouseId, code: createZoneDto.code } },
    });
    if (existing) throw new ConflictException('Zone code already exists in this greenhouse');

    return this.prisma.zone.create({ data: createZoneDto });
  }

  findAll(userId: string) {
    return this.prisma.zone.findMany({
      where: { deletedAt: null, greenhouse: { organization: { memberships: { some: { userId } } } } },
    });
  }

  async findOne(id: string) {
    const zone = await this.prisma.zone.findFirst({ where: { id, deletedAt: null } });
    if (!zone) throw new NotFoundException('Zone not found');
    return zone;
  }

  async update(id: string, updateZoneDto: UpdateZoneDto) {
    const zone = await this.findOne(id);
    if (updateZoneDto.code) {
      const existing = await this.prisma.zone.findFirst({
        where: {
          greenhouseId: zone.greenhouseId,
          code: updateZoneDto.code,
          id: { not: id }
        },
      });
      if (existing) throw new ConflictException('Zone code already exists');
    }
    return this.prisma.zone.update({
      where: { id },
      data: updateZoneDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.zone.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
