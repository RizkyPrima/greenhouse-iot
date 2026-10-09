import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthService } from './health.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';

describe('HealthService', () => {
  let healthService: HealthService;
  let mockPrismaService: Partial<PrismaService>;
  let mockRedisService: Partial<RedisService>;
  let mockMqttService: Partial<MqttService>;

  beforeEach(() => {
    mockPrismaService = {
      ping: vi.fn(),
    };
    mockRedisService = {
      ping: vi.fn(),
    };
    mockMqttService = {
      isConnected: vi.fn(),
    };

    healthService = new HealthService(
      mockPrismaService as PrismaService,
      mockRedisService as RedisService,
      mockMqttService as MqttService,
    );
  });

  it('should return ok when database, redis, and mqtt are healthy', async () => {
    (mockPrismaService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockRedisService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockMqttService.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const result = await healthService.check();

    expect(result.status).toBe('ok');
    expect(result.services.api).toBe('up');
    expect(result.services.database).toBe('up');
    expect(result.services.redis).toBe('up');
    expect(result.services.mqtt).toBe('up');
    expect(result.timestamp).toBeDefined();
  });

  it('should return degraded when database is down', async () => {
    (mockPrismaService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (mockRedisService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockMqttService.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const result = await healthService.check();

    expect(result.status).toBe('degraded');
    expect(result.services.api).toBe('up');
    expect(result.services.database).toBe('down');
    expect(result.services.redis).toBe('up');
    expect(result.services.mqtt).toBe('up');
  });

  it('should return degraded when redis is down', async () => {
    (mockPrismaService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockRedisService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (mockMqttService.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const result = await healthService.check();

    expect(result.status).toBe('degraded');
    expect(result.services.api).toBe('up');
    expect(result.services.database).toBe('up');
    expect(result.services.redis).toBe('down');
    expect(result.services.mqtt).toBe('up');
  });

  it('should return degraded when mqtt is down', async () => {
    (mockPrismaService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockRedisService.ping as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (mockMqttService.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await healthService.check();

    expect(result.status).toBe('degraded');
    expect(result.services.api).toBe('up');
    expect(result.services.database).toBe('up');
    expect(result.services.redis).toBe('up');
    expect(result.services.mqtt).toBe('down');
  });
});
