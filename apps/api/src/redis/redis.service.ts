import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.configService.get<string>('redis.url') || process.env.REDIS_URL;
    const host = this.configService.get<string>('redis.host') || process.env.REDIS_HOST || 'localhost';
    const port = this.configService.get<number>('redis.port') || parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = this.configService.get<string>('redis.password') || process.env.REDIS_PASSWORD || undefined;

    if (redisUrl) {
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          return Math.min(times * 100, 3000);
        },
      });
    } else {
      this.client = new Redis({
        host,
        port,
        password: password || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          return Math.min(times * 100, 3000);
        },
      });
    }

    this.client.on('connect', () => {
      this.isConnected = true;
      this.logger.log('Connected to Redis');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      this.logger.error(`Redis connection error: ${err.message}`);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.logger.warn('Redis connection closed');
    });

    // Initiate connection asynchronously
    this.client.connect().catch((err) => {
      this.isConnected = false;
      this.logger.error(`Initial Redis connection failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.client) {
        await this.client.quit();
        this.logger.log('Disconnected from Redis gracefully');
      }
    } catch (error) {
      this.logger.error('Error disconnecting from Redis', error);
    }
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      const response = await this.client.ping();
      return response === 'PONG';
    } catch (error) {
      this.logger.error('Redis health ping failed', error);
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (ttlSeconds && ttlSeconds > 0) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  getClient(): Redis {
    return this.client;
  }
}
