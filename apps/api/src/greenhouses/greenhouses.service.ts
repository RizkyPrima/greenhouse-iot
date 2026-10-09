import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateGreenhouseDto } from './dto/create-greenhouse.dto.js';
import { UpdateGreenhouseDto } from './dto/update-greenhouse.dto.js';

@Injectable()
export class GreenhousesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createGreenhouseDto: CreateGreenhouseDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: createGreenhouseDto.organizationId }});
    if (!org) throw new NotFoundException('Organization not found');

    const existing = await this.prisma.greenhouse.findUnique({
      where: { organizationId_code: { organizationId: createGreenhouseDto.organizationId, code: createGreenhouseDto.code } },
    });
    if (existing) throw new ConflictException('Greenhouse code already exists in this organization');

    return this.prisma.greenhouse.create({ data: createGreenhouseDto });
  }

  findAll(userId: string, organizationId?: string) {
    return this.prisma.greenhouse.findMany({
      where: {
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
        organization: { memberships: { some: { userId } } },
      },
    });
  }

  async findOne(id: string) {
    const gh = await this.prisma.greenhouse.findFirst({ where: { id, deletedAt: null } });
    if (!gh) throw new NotFoundException('Greenhouse not found');
    return gh;
  }

  async update(id: string, updateGreenhouseDto: UpdateGreenhouseDto) {
    const gh = await this.findOne(id);
    if (updateGreenhouseDto.code) {
      const existing = await this.prisma.greenhouse.findFirst({
        where: {
          organizationId: gh.organizationId,
          code: updateGreenhouseDto.code,
          id: { not: id }
        },
      });
      if (existing) throw new ConflictException('Greenhouse code already exists');
    }
    return this.prisma.greenhouse.update({
      where: { id },
      data: updateGreenhouseDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.greenhouse.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findZones(id: string) {
    await this.findOne(id);
    return this.prisma.zone.findMany({ where: { greenhouseId: id, deletedAt: null } });
  }
}
