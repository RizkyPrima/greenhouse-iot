import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../authorization.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthenticatedUser } from '../auth.types.js';

@Injectable()
export class ResourceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      params: Record<string, string>;
      body?: Record<string, unknown>;
      route?: { path?: string };
    }>();

    const organizationId = await this.resolveOrganizationId(request);
    if (!organizationId) return true;

    await this.authorization.getMembership(request.user.id, organizationId);
    return true;
  }

  private async resolveOrganizationId(request: {
    params: Record<string, string>;
    body?: Record<string, unknown>;
    route?: { path?: string };
  }): Promise<string | null> {
    const body = request.body ?? {};
    const params = request.params ?? {};
    const route = request.route?.path ?? '';

    if (typeof body.organizationId === 'string') return body.organizationId;
    if (typeof body.greenhouseId === 'string') return this.authorization.greenhouseOrganizationId(body.greenhouseId);
    if (typeof body.deviceId === 'string') return this.authorization.deviceOrganizationId(body.deviceId);

    if (route.includes('/telemetry/')) {
      try {
        if (route.includes('/devices/')) {
          const mqttDevice = request.params.deviceMqttId;
          return mqttDevice ? await this.authorization.deviceMqttOrganizationId(mqttDevice) : null;
        }
        if (route.includes('/greenhouses/')) {
          const greenhouseId = request.params.greenhouseId;
          return greenhouseId ? await this.authorization.greenhouseOrganizationId(greenhouseId) : null;
        }
      } catch (error) {
        if (error instanceof NotFoundException) return null;
        throw error;
      }
      return null;
    }

    const id = params.id;
    if (!id) return null;

    if (route.includes('/organizations')) {
      return id;
    }
    if (route.includes('/greenhouses')) {
      return this.authorization.greenhouseOrganizationId(id);
    }
    if (route.includes('/zones')) {
      return this.authorization.zoneOrganizationId(id);
    }
    if (route.includes('/devices')) {
      return this.authorization.deviceOrganizationId(id);
    }
    if (route.includes('/sensors')) {
      return this.authorization.sensorOrganizationId(id);
    }
    if (route.includes('/actuators')) {
      return this.authorization.actuatorOrganizationId(id);
    }

    return null;
  }
}
