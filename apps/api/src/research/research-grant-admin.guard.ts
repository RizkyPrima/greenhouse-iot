import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ResearchGrantAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user?.isActive) throw new ForbiddenException('Active organization OWNER membership required');

    const ownerMembership = await this.prisma.organizationMembership.findFirst({
      where: {
        userId: user.id,
        role: 'OWNER',
        organization: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!ownerMembership) throw new ForbiddenException('An active organization OWNER membership is required');
    return true;
  }
}
