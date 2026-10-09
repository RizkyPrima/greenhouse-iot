import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { UserRole } from '@prisma/client';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { AddMemberDto } from './dto/add-member.dto.js';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createOrganizationDto: CreateOrganizationDto, userId: string) {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: createOrganizationDto.slug },
    });
    if (existing) {
      throw new ConflictException('Organization slug already exists');
    }
    return this.prisma.organization.create({
      data: {
        name: createOrganizationDto.name,
        slug: createOrganizationDto.slug,
        description: createOrganizationDto.description,
        memberships: {
          create: {
            userId,
            role: UserRole.OWNER,
          },
        },
      },
      include: { memberships: { select: { userId: true, role: true } } },
    });
  }

  findAll(userId: string) {
    return this.prisma.organization.findMany({
      where: { deletedAt: null, memberships: { some: { userId } } },
    });
  }

  async findOne(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }


  async addMember(organizationId: string, dto: AddMemberDto) {
    await this.findOne(organizationId);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
    });
    if (existing) throw new ConflictException('User is already a member of this organization');

    return this.prisma.organizationMembership.create({
      data: { organizationId, userId: user.id, role: dto.role },
      select: { id: true, organizationId: true, userId: true, role: true, createdAt: true },
    });
  }

  async findMembers(id: string) {
    await this.findOne(id);
    return this.prisma.organizationMembership.findMany({
      where: { organizationId: id },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, isActive: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateMemberRole(organizationId: string, membershipId: string, role: UserRole) {
    await this.findOne(organizationId);
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!membership) throw new NotFoundException('Membership not found');

    if (membership.role === UserRole.OWNER && role !== UserRole.OWNER) {
      const ownerCount = await this.prisma.organizationMembership.count({
        where: { organizationId, role: UserRole.OWNER },
      });
      if (ownerCount <= 1) throw new ForbiddenException('Organization must retain at least one owner');
    }

    return this.prisma.organizationMembership.update({
      where: { id: membershipId },
      data: { role },
      select: { id: true, organizationId: true, userId: true, role: true, updatedAt: true },
    });
  }

  async update(id: string, updateOrganizationDto: UpdateOrganizationDto) {
    await this.findOne(id);
    if (updateOrganizationDto.slug) {
      const existing = await this.prisma.organization.findFirst({
        where: { slug: updateOrganizationDto.slug, id: { not: id } },
      });
      if (existing) throw new ConflictException('Organization slug already exists');
    }
    return this.prisma.organization.update({
      where: { id },
      data: updateOrganizationDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.organization.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
