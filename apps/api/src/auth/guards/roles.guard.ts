import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth.types.js';
import { AuthorizationService } from '../authorization.service.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      params: Record<string, string>;
      body?: Record<string, unknown>;
      route?: { path?: string };
    }>();
    const organizationId = await this.resolveOrganizationId(request);

    if (!organizationId) {
      throw new ForbiddenException('Organization context is required for this operation');
    }

    await this.authorization.requireRole(request.user.id, organizationId, roles);
    return true;
  }

  private async resolveOrganizationId(request: {
    params: Record<string, string>;
    body?: Record<string, unknown>;
    route?: { path?: string };
  }): Promise<string | null> {
    const params = request.params ?? {};
    const body = request.body ?? {};
    const route = request.route?.path ?? '';

    if (typeof body.organizationId === 'string') return body.organizationId;
    if (typeof body.greenhouseId === 'string') return this.authorization.greenhouseOrganizationId(body.greenhouseId);
    if (typeof body.deviceId === 'string') return this.authorization.deviceOrganizationId(body.deviceId);

    const id = params.id;
    if (!id) return null;

    if (route.includes('/organizations')) return id;
    if (route.includes('/greenhouses')) return this.authorization.greenhouseOrganizationId(id);
    if (route.includes('/zones')) return this.authorization.zoneOrganizationId(id);
    if (route.includes('/devices')) return this.authorization.deviceOrganizationId(id);
    if (route.includes('/sensors')) return this.authorization.sensorOrganizationId(id);
    if (route.includes('/actuators')) return this.authorization.actuatorOrganizationId(id);

    return null;
  }
}
