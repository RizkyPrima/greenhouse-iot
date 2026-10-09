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

  handleConnection(client: Socket): void {
    this.logger.log(`[WS_CONNECT] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[WS_DISCONNECT] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:greenhouse')
  handleSubscribeGreenhouse(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { greenhouseId: string },
  ): void {
    if (data?.greenhouseId) {
      const room = `greenhouse:${data.greenhouseId}`;
      void client.join(room);
      this.logger.log(`[WS_JOIN] Client ${client.id} joined ${room}`);
      client.emit('subscribed', { room, success: true });
    }
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
  handleSubscribeDevice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { deviceMqttId: string },
  ): void {
    if (data?.deviceMqttId) {
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
}
