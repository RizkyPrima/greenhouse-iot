import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ResearchGrantAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user?.isActive) throw new ForbiddenException('Active research grant administrator permission required');

    const grant = await this.prisma.platformAdminGrant.findFirst({
      where: { userId: user.id, permission: 'RESEARCH_SOURCE_GRANT_ADMIN', revokedAt: null },
      select: { id: true },
    });
    if (!grant) throw new ForbiddenException('Research grant management permission required');
    return true;
  }
}
