import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user?.isActive) throw new ForbiddenException('Active platform permission required');

    const grant = await this.prisma.platformAdminGrant.findFirst({
      where: { userId: user.id, permission: 'PLANT_CATALOG_ADMIN', revokedAt: null },
      select: { id: true },
    });
    if (!grant) throw new ForbiddenException('Platform catalog administrator permission required');
    return true;
  }
}
