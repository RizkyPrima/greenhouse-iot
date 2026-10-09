import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service.js';

describe('RedisService', () => {
  let redisService: RedisService;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'redis.url') return undefined;
        if (key === 'redis.host') return 'localhost';
        if (key === 'redis.port') return 6379;
        return undefined;
      }),
    };

    redisService = new RedisService(mockConfigService as ConfigService);
  });

  it('should initialize and define client', () => {
    expect(redisService).toBeDefined();
  });
});
