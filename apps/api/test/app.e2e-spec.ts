import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import mqtt from 'mqtt';
import { AppModule } from '../src/app.module.js';
import { RedisService } from '../src/redis/redis.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { MqttMessage } from '../src/mqtt/mqtt.types.js';

describe('Greenhouse API (e2e)', () => {
  let app: INestApplication;
  let redisService: RedisService;
  let prismaService: PrismaService;
  let mqttService: MqttService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    redisService = app.get(RedisService);
    prismaService = app.get(PrismaService);
    mqttService = app.get(MqttService);

    // Give services a moment to establish connections
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const email = `phase6-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer()).post('/api/auth/register').send({
      email, password: 'Phase6Password123!', name: 'Phase 6 E2E',
    }).expect(201);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({
      email, password: 'Phase6Password123!',
    }).expect(200);
    accessToken = login.body.data.accessToken;

  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/health', () => {
    it('should return 200 with all services (API, DB, Redis, MQTT) up', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('services');
      expect(res.body.services.api).toBe('up');
      expect(res.body.services.database).toBe('up');
      expect(res.body.services.redis).toBe('up');
      expect(res.body.services.mqtt).toBe('up');
      expect(res.body.timestamp).toBeDefined();
    });

    it('should include X-Request-ID header in response and preserve custom X-Request-ID', async () => {
      const customId = 'test-req-custom-12345';
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set('X-Request-ID', customId);

      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('should generate an X-Request-ID if not supplied by client', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
    });
  });

  describe('Prisma Query Verification', () => {
    it('should execute raw query on PostgreSQL successfully', async () => {
      const isAlive = await prismaService.ping();
      expect(isAlive).toBe(true);
    });
  });

  describe('Redis SET/GET Verification', () => {
    it('should successfully SET, GET and DEL using key system:health:test', async () => {
      const testKey = 'system:health:test';
      const testValue = `test-val-${Date.now()}`;

      await redisService.set(testKey, testValue, 60);
      const retrieved = await redisService.get(testKey);
      expect(retrieved).toBe(testValue);

      await redisService.del(testKey);
      const afterDel = await redisService.get(testKey);
      expect(afterDel).toBeNull();
    });
  });

  describe('MQTT Integration Verification (EMQX)', () => {
    it('should be connected to EMQX broker with status "connected"', () => {
      expect(mqttService.isConnected()).toBe(true);
      expect(mqttService.getConnectionStatus()).toBe('connected');
    });

    it('should receive messages published from external test client via EMQX broker', async () => {
      const testTopic = 'greenhouse/GH001/CTRL001/telemetry';
      const testPayload = {
        device_id: 'CTRL001',
        temperature: 28.5,
        humidity: 70,
      };

      const messagePromise = new Promise<MqttMessage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error('Timeout waiting for MQTT message from EMQX'));
        }, 5000);

        const unsubscribe = mqttService.onMessage((msg) => {
          if (msg.topic === testTopic) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(msg);
          }
        });
      });

      // External test publisher client simulating ESP32 device
      const externalPublisher = mqtt.connect('mqtt://localhost:1883', {
        clientId: `test-external-publisher-${Date.now()}`,
        clean: true,
      });

      await new Promise<void>((resolve, reject) => {
        externalPublisher.on('connect', () => {
          externalPublisher.publish(
            testTopic,
            JSON.stringify(testPayload),
            { qos: 0 },
            (err) => {
              if (err) reject(err);
              else resolve();
            },
          );
        });
        externalPublisher.on('error', reject);
      });

      const received = await messagePromise;
      expect(received.topic).toBe(testTopic);
      expect(received.parsedTopic).toEqual({
        greenhouseId: 'GH001',
        deviceId: 'CTRL001',
        messageType: 'telemetry',
        raw: testTopic,
      });
      expect(received.payload).toEqual(testPayload);

      externalPublisher.end(true);
    });

    it('should successfully publish message through MqttService to EMQX', async () => {
      const commandTopic = 'greenhouse/GH001/CTRL001/command';
      const commandPayload = { command_id: 'CMD-TEST-1', action: 'PING' };

      await expect(
        mqttService.publish(commandTopic, commandPayload, { qos: 0 }),
      ).resolves.toBeUndefined();
    });
  });

  describe('Telemetry Pipeline (Phase 5)', () => {
    const deviceMqttId = `e2e-dev-${Date.now()}`;
    const greenhouseId = 'GH-E2E-001';

    it('should return null realtime state for unknown device', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/devices/UNKNOWN-DEV-XYZ/telemetry/latest`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('cached', false);
      expect(res.body.data).toBeNull();
    });

    it('should return empty device list for unknown greenhouse', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/greenhouses/GH-UNKNOWN-XYZ/telemetry/latest`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.deviceCount).toBe(0);
      expect(res.body.devices).toEqual([]);
    });

    it('should process valid telemetry MQTT message and update Redis realtime state', async () => {
      const telemetryTopic = `greenhouse/${greenhouseId}/${deviceMqttId}/telemetry`;
      const telemetryPayload = {
        seq: 1,
        ts: Date.now(),
        sensors: [
          { code: 'temp_air', value: 28.5 },
          { code: 'humidity', value: 72.0 },
        ],
      };

      // Publish via MQTT — pipeline processes it into Redis
      await mqttService.publish(telemetryTopic, telemetryPayload, { qos: 0 });

      // Wait for pipeline processing
      await new Promise((r) => setTimeout(r, 500));

      // Query realtime state from Redis
      const res = await request(app.getHttpServer())
        .get(`/api/devices/${deviceMqttId}/telemetry/latest`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(res.body.data).not.toBeNull();
      expect(res.body.data.deviceMqttId).toBe(deviceMqttId);
      expect(res.body.data.sensors).toHaveProperty('temp_air');
      expect(res.body.data.sensors).toHaveProperty('humidity');
      expect(res.body.data.sensors.temp_air.numericValue).toBe(28.5);
      expect(res.body.data.sensors.humidity.numericValue).toBe(72.0);
    });

    it('should show device in greenhouse realtime after receiving telemetry', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/greenhouses/${greenhouseId}/telemetry/latest`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.deviceCount).toBeGreaterThan(0);
      const found = (res.body.devices as { deviceMqttId: string }[])
        .find((d) => d.deviceMqttId === deviceMqttId);
      expect(found).toBeDefined();
    });

    it('should return empty historical telemetry for unregistered device', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/devices/${deviceMqttId}/telemetry/history`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      // Unregistered device → persistence skipped → count = 0
      expect(res.body.records).toEqual([]);
    });

    it('should return empty status logs for unregistered device', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/devices/${deviceMqttId}/status-logs`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toEqual([]);
    });
  });
});
