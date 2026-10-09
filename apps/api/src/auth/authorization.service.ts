import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async getMembership(userId: string, organizationId: string) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership) throw new ForbiddenException('You do not have access to this organization');
    return membership;
  }

  async requireRole(userId: string, organizationId: string, roles: UserRole[]) {
    const membership = await this.getMembership(userId, organizationId);
    if (!roles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient permissions for this resource');
    }
    return membership;
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { id: true } });
    if (!organization) throw new NotFoundException('Organization not found');
    return true;
  }

  async greenhouseOrganizationId(greenhouseId: string): Promise<string> {
    const greenhouse = await this.prisma.greenhouse.findFirst({
      where: { id: greenhouseId, deletedAt: null },
      select: { organizationId: true },
    });
    if (!greenhouse) throw new NotFoundException('Greenhouse not found');
    return greenhouse.organizationId;
  }

  async zoneOrganizationId(zoneId: string): Promise<string> {
    const zone = await this.prisma.zone.findFirst({
      where: { id: zoneId, deletedAt: null },
      select: { greenhouse: { select: { organizationId: true } } },
    });
    if (!zone) throw new NotFoundException('Zone not found');
    return zone.greenhouse.organizationId;
  }

  async deviceOrganizationId(deviceId: string): Promise<string> {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, deletedAt: null },
      select: { greenhouse: { select: { organizationId: true } } },
    });
    if (!device) throw new NotFoundException('Device not found');
    return device.greenhouse.organizationId;
  }

  async sensorOrganizationId(sensorId: string): Promise<string> {
    const sensor = await this.prisma.sensor.findFirst({
      where: { id: sensorId, deletedAt: null },
      select: { device: { select: { greenhouse: { select: { organizationId: true } } } } },
    });
    if (!sensor) throw new NotFoundException('Sensor not found');
    return sensor.device.greenhouse.organizationId;
  }

  async actuatorOrganizationId(actuatorId: string): Promise<string> {
    const actuator = await this.prisma.actuator.findFirst({
      where: { id: actuatorId, deletedAt: null },
      select: { device: { select: { greenhouse: { select: { organizationId: true } } } } },
    });
    if (!actuator) throw new NotFoundException('Actuator not found');
    return actuator.device.greenhouse.organizationId;
  }

  async deviceMqttOrganizationId(deviceMqttId: string): Promise<string> {
    const device = await this.prisma.device.findFirst({
      where: { deviceId: deviceMqttId, deletedAt: null },
      select: { greenhouse: { select: { organizationId: true } } },
    });
    if (!device) throw new NotFoundException('Device not found');
    return device.greenhouse.organizationId;
  }
}
