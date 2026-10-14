import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

interface AuthenticatedClientData {
  user?: {
    id: string;
    email: string;
    memberships: Array<{ organizationId: string; role: string }>;
  };
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/realtime',
})
export class TelemetryGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TelemetryGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const rawAuth = client.handshake.auth?.token || client.handshake.headers?.authorization;
    const token =
      typeof rawAuth === 'string' && rawAuth.startsWith('Bearer ')
        ? rawAuth.slice(7).trim()
        : typeof rawAuth === 'string'
        ? rawAuth.trim()
        : null;

    if (!token) {
      this.logger.warn(`[WS_UNAUTHORIZED] Client ${client.id} rejected: No token provided in handshake`);
      client.emit('error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }

    try {
      const jwtSecret = this.config.get<string>('JWT_SECRET') || 'dev_jwt_secret_change_in_production_32chars';
      const payload = await this.jwt.verifyAsync<{ sub: string; type?: string }>(token, {
        secret: jwtSecret,
      });

      if (!payload.sub) {
        throw new Error('Invalid token subject');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub, isActive: true },
        select: {
          id: true,
          email: true,
          memberships: { select: { organizationId: true, role: true } },
        },
      });

      if (!user) {
        this.logger.warn(`[WS_UNAUTHORIZED] Client ${client.id}: User not found or inactive`);
        client.emit('error', { message: 'User not found or inactive' });
        client.disconnect(true);
        return;
      }

      (client.data as AuthenticatedClientData).user = user;
      this.logger.log(`[WS_CONNECT] Authenticated client connected: ${client.id} (${user.email})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[WS_UNAUTHORIZED] Client ${client.id} rejected: ${msg}`);
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userEmail = (client.data as AuthenticatedClientData)?.user?.email;
    this.logger.log(`[WS_DISCONNECT] Client disconnected: ${client.id}${userEmail ? ` (${userEmail})` : ''}`);
  }

  @SubscribeMessage('subscribe:greenhouse')
  async handleSubscribeGreenhouse(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { greenhouseId: string },
  ): Promise<void> {
    if (!data?.greenhouseId) return;

    const user = (client.data as AuthenticatedClientData)?.user;
    if (!user) {
      client.emit('error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }

    // Resolve greenhouse to verify organization membership
    const gh = await this.prisma.greenhouse.findFirst({
      where: {
        OR: [{ id: data.greenhouseId }, { code: data.greenhouseId }],
        deletedAt: null,
      },
      select: { id: true, organizationId: true },
    });

    if (!gh) {
      client.emit('error', { message: `Greenhouse not found: ${data.greenhouseId}` });
      return;
    }

    // Server-side authorization check: verify user belongs to the organization
    const hasOrgAccess = user.memberships.some((m) => m.organizationId === gh.organizationId);
    if (!hasOrgAccess) {
      this.logger.warn(
        `[WS_FORBIDDEN] User ${user.email} attempted cross-organization access to greenhouse ${data.greenhouseId}`,
      );
      client.emit('error', { message: 'Forbidden: Access denied to this greenhouse' });
      return;
    }

    const room = `greenhouse:${data.greenhouseId}`;
    await client.join(room);
    if (data.greenhouseId !== gh.id) {
      await client.join(`greenhouse:${gh.id}`);
    }
    this.logger.log(`[WS_JOIN] Client ${client.id} (${user.email}) joined ${room}`);
    client.emit('subscribed', { room, success: true });
  }

  @SubscribeMessage('unsubscribe:greenhouse')
  handleUnsubscribeGreenhouse(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { greenhouseId: string },
  ): void {
    if (data?.greenhouseId) {
      const room = `greenhouse:${data.greenhouseId}`;
      void client.leave(room);
      this.logger.log(`[WS_LEAVE] Client ${client.id} left ${room}`);
      client.emit('unsubscribed', { room, success: true });
    }
  }

  @SubscribeMessage('subscribe:device')
  async handleSubscribeDevice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { deviceMqttId: string },
  ): Promise<void> {
    if (data?.deviceMqttId) {
      const user = (client.data as AuthenticatedClientData)?.user;
      if (!user) {
        client.emit('error', { message: 'Authentication required' });
        client.disconnect(true);
        return;
      }
      const device = await this.prisma.device.findFirst({
        where: { deviceId: data.deviceMqttId, deletedAt: null },
        select: { greenhouse: { select: { organizationId: true } } },
      });
      if (!device || !user.memberships.some((m) => m.organizationId === device.greenhouse.organizationId)) {
        client.emit('error', { message: 'Forbidden: Access denied to this device' });
        return;
      }
      const room = `device:${data.deviceMqttId}`;
      void client.join(room);
      this.logger.log(`[WS_JOIN] Client ${client.id} joined ${room}`);
      client.emit('subscribed', { room, success: true });
    }
  }

  broadcastTelemetry(greenhouseId: string, deviceMqttId: string, payload: unknown): void {
    if (!this.server) return;
    const packet = {
      greenhouseId,
      deviceMqttId,
      payload,
      timestamp: new Date().toISOString(),
    };

    // Emit to specific rooms and general broadcast
    this.server.to(`greenhouse:${greenhouseId}`).emit('telemetry:update', packet);
    this.server.to(`device:${deviceMqttId}`).emit('telemetry:update', packet);
    this.server.emit('telemetry:broadcast', packet);
  }

  broadcastStatus(
    greenhouseId: string,
    deviceMqttId: string,
    status: string,
    lastSeenAt: string,
  ): void {
    if (!this.server) return;
    const packet = {
      greenhouseId,
      deviceMqttId,
      status,
      lastSeenAt,
    };

    this.server.to(`greenhouse:${greenhouseId}`).emit('status:update', packet);
    this.server.to(`device:${deviceMqttId}`).emit('status:update', packet);
    this.server.emit('status:broadcast', packet);
  }

  broadcastCommandUpdate(update: {
    commandId: string;
    deviceMqttId: string;
    greenhouseId: string;
    greenhouseDbId?: string;
    actuatorId: string | null;
    target: string;
    value: unknown;
    status: string;
    result?: unknown;
    error?: string | null;
    completedAt?: Date | null;
  }): void {
    if (!this.server) return;
    const packet = { ...update, timestamp: new Date().toISOString() };
    this.server.to(`greenhouse:${update.greenhouseId}`).emit('actuator:command:update', packet);
    if (update.greenhouseDbId) {
      this.server.to(`greenhouse:${update.greenhouseDbId}`).emit('actuator:command:update', packet);
    }
    this.server.to(`device:${update.deviceMqttId}`).emit('actuator:command:update', packet);
  }
}
