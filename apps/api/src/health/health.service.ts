import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { HealthResponseDto } from './health.dto.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly mqttService: MqttService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [dbHealthy, redisHealthy] = await Promise.all([
      this.prismaService.ping(),
      this.redisService.ping(),
    ]);

    const mqttHealthy = this.mqttService.isConnected();
    const isHealthy = dbHealthy && redisHealthy && mqttHealthy;

    return {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        api: 'up',
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
        mqtt: mqttHealthy ? 'up' : 'down',
      },
    };
  }
}
