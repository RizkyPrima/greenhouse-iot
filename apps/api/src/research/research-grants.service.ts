import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPermission } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class ResearchGrantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, actor: AuthenticatedUser) {
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
            permission: PlatformPermission.RESEARCH_SOURCE_ADMIN,
            grantedByUserId: actor.id,
            grantedAt: now,
          },
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          throw new ConflictException('An active research source grant already exists for this user');
        }
        throw error;
      }

      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id,
          action: 'RESEARCH_SOURCE_GRANT_CREATED',
          entityType: 'PlatformAdminGrant',
          entityId: grant.id,
          details: {
            recipientUserId: userId,
            permission: PlatformPermission.RESEARCH_SOURCE_ADMIN,
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
      if (!grant || grant.permission !== PlatformPermission.RESEARCH_SOURCE_ADMIN) {
        throw new NotFoundException('Research source grant not found');
      }
      if (grant.revokedAt) return grant;

      const now = new Date();
      const changed = await tx.platformAdminGrant.updateMany({
        where: { id: grantId, permission: PlatformPermission.RESEARCH_SOURCE_ADMIN, revokedAt: null },
        data: { revokedAt: now },
      });
      if (changed.count === 0) {
        const current = await tx.platformAdminGrant.findUnique({ where: { id: grantId } });
        if (!current || current.permission !== PlatformPermission.RESEARCH_SOURCE_ADMIN) {
          throw new NotFoundException('Research source grant not found');
        }
        return current;
      }

      await tx.plantConfigAuditEvent.create({
        data: {
          actorUserId: actor.id,
          action: 'RESEARCH_SOURCE_GRANT_REVOKED',
          entityType: 'PlatformAdminGrant',
          entityId: grant.id,
          details: {
            recipientUserId: grant.userId,
            permission: PlatformPermission.RESEARCH_SOURCE_ADMIN,
            revokedAt: now.toISOString(),
          },
          createdAt: now,
        },
      });
      return { ...grant, revokedAt: now };
    });
  }
}
