import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPermission } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

const manageablePermissions: PlatformPermission[] = [
  PlatformPermission.RESEARCH_SOURCE_ADMIN,
  PlatformPermission.SCIENTIFIC_EVIDENCE_CURATOR,
];

@Injectable()
export class ResearchGrantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, actor: AuthenticatedUser, permission: PlatformPermission = PlatformPermission.RESEARCH_SOURCE_ADMIN) {
    if (!manageablePermissions.includes(permission)) {
      throw new ForbiddenException('Unsupported platform grant permission');
    }
    if (userId === actor.id) throw new ForbiddenException('Administrators cannot grant this permission to themselves');

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const recipient = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
      if (!recipient?.isActive) throw new NotFoundException('Active user not found');

      let grant;
      try {
        grant = await tx.platformAdminGrant.create({
          data: {
            userId,
            permission,
            grantedByUserId: actor.id,
            grantedAt: now,
          },
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          throw new ConflictException(`An active ${permission} grant already exists for this user`);
        }
        throw error;
      }

      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id,
          action: permission === PlatformPermission.SCIENTIFIC_EVIDENCE_CURATOR ? 'SCIENTIFIC_EVIDENCE_CURATOR_GRANT_CREATED' : 'RESEARCH_SOURCE_GRANT_CREATED',
          entityType: 'PlatformAdminGrant',
          entityId: grant.id,
          details: {
            recipientUserId: userId,
            permission,
            grantedAt: now.toISOString(),
          },
          createdAt: now,
        },
      });
      return grant;
    });
  }

  async revoke(grantId: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.platformAdminGrant.findUnique({ where: { id: grantId } });
      if (!grant || !manageablePermissions.includes(grant.permission)) {
        throw new NotFoundException('Platform grant not found');
      }
      if (grant.revokedAt) return grant;

      const now = new Date();
      const changed = await tx.platformAdminGrant.updateMany({
        where: { id: grantId, permission: grant.permission, revokedAt: null },
        data: { revokedAt: now },
      });
      if (changed.count === 0) {
        const current = await tx.platformAdminGrant.findUnique({ where: { id: grantId } });
        if (!current || current.permission !== grant.permission) {
          throw new NotFoundException('Platform grant not found');
        }
        return current;
      }

      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id,
          action: grant.permission === PlatformPermission.SCIENTIFIC_EVIDENCE_CURATOR ? 'SCIENTIFIC_EVIDENCE_CURATOR_GRANT_REVOKED' : 'RESEARCH_SOURCE_GRANT_REVOKED',
          entityType: 'PlatformAdminGrant',
          entityId: grant.id,
          details: {
            recipientUserId: grant.userId,
            permission: grant.permission,
            revokedAt: now.toISOString(),
          },
          createdAt: now,
        },
      });
      return { ...grant, revokedAt: now };
    });
  }
}
