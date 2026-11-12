/**
 * Safe MQTT telemetry simulator for a registered, disposable test device.
 *
 * Requires MQTT_HOST, MQTT_PORT, MQTT_PROTOCOL, MQTT_USERNAME, MQTT_PASSWORD,
 * SIM_GH_ID, SIM_DEVICE_ID, DATABASE_URL, and SIMULATOR_ALLOW_DB_WRITES=true.
 * The greenhouse and device IDs must contain a TEST identifier and exist in
 * the disposable database selected by DATABASE_URL.
 */

import mqtt, { type MqttClient } from 'mqtt';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import {
  getSimulatorConfig,
  isDisposableTestDatabase,
} from './simulator-config.js';

const args = process.argv.slice(2);
const isContinuous = args.includes('--stream') || args.includes('-c');
const isValidation = args.includes('--validate') || args.includes('-v');
const config = getSimulatorConfig();

if (isValidation && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required for end-to-end simulator validation');
}

const prisma = new PrismaClient();
let redis: Redis | null = null;
const topicStatus = `greenhouse/${config.greenhouseId}/${config.deviceId}/status`;
const topicTelemetry = `greenhouse/${config.greenhouseId}/${config.deviceId}/telemetry`;
let client: MqttClient | null = null;

let seq = Math.floor(Date.now() / 1000);
let interval: NodeJS.Timeout | undefined;
let shuttingDown = false;

function generatePayload(currentSeq: number) {
  const temp = +(24 + Math.random() * 5).toFixed(1);
  const hum = +(65 + Math.random() * 15).toFixed(1);
  const soil = +(60 + Math.random() * 12).toFixed(1);
  const light = +(600 + Math.random() * 400).toFixed(0);

  return {
    seq: currentSeq,
    ts: Date.now(),
    sensors: [
      { code: 'temperature', value: temp, unit: '°C' },
      { code: 'humidity', value: hum, unit: '%' },
      { code: 'soil_moisture', value: soil, unit: '%' },
      { code: 'light_intensity', value: light, unit: 'lux' },
    ],
  };
}

function publish(topic: string, payload: object, qos: 0 | 1): Promise<void> {
  const activeClient = client;
  if (!activeClient) return Promise.reject(new Error('MQTT client is not initialized'));
  return new Promise((resolve, reject) => {
    activeClient.publish(topic, JSON.stringify(payload), { qos, retain: false }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function assertSafeTarget(): Promise<void> {
  const databases = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT current_database() AS name
  `;
  if (!databases[0] || !isDisposableTestDatabase(databases[0].name)) {
    throw new Error('Refusing to publish: DATABASE_URL does not target a disposable test database');
  }

  const greenhouse = await prisma.greenhouse.findFirst({
    where: {
      OR: [{ id: config.greenhouseId }, { code: config.greenhouseId }],
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!greenhouse) {
    throw new Error('Refusing to publish: configured test greenhouse is not registered');
  }

  const device = await prisma.device.findFirst({
    where: {
      deviceId: config.deviceId,
      greenhouseId: greenhouse.id,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!device) {
    throw new Error('Refusing to publish: configured test device is not registered in that greenhouse');
  }
}

async function waitForValidation(payload: ReturnType<typeof generatePayload>): Promise<void> {
  const deadline = Date.now() + 20000;
  let redisVerified = false;
  let postgresVerified = false;

  while (Date.now() < deadline && (!redisVerified || !postgresVerified)) {
    if (!redisVerified && redis) {
      const raw = await redis.get(`realtime:device:${config.deviceId}`);
      if (raw) {
        const state = JSON.parse(raw) as {
          greenhouseId?: string;
          lastTelemetryAt?: string | null;
          sensors?: Record<string, { numericValue?: number | null }>;
        };
        redisVerified =
          state.greenhouseId === config.greenhouseId &&
          Boolean(state.lastTelemetryAt) &&
          payload.sensors.every(
            (sensor) => state.sensors?.[sensor.code]?.numericValue === sensor.value,
          );
      }
    }

    if (!postgresVerified) {
      const record = await prisma.telemetryRecord.findFirst({
        where: {
          deviceMqttId: config.deviceId,
          sequenceNumber: payload.seq,
          greenhouseId: config.greenhouseId,
        },
        include: { values: true },
      });
      postgresVerified =
        Boolean(record) &&
        record!.values.length === payload.sensors.length &&
        payload.sensors.every((sensor) =>
          record!.values.some(
            (value) =>
              value.sensorCode === sensor.code &&
              value.numericValue === sensor.value,
          ),
        );
    }

    if (!redisVerified || !postgresVerified) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!redisVerified) throw new Error('Telemetry was not verified in Redis before timeout');
  console.log('[PASS] Telemetry state verified in Redis');
  if (!postgresVerified) throw new Error('Telemetry was not verified in PostgreSQL before timeout');
  console.log('[PASS] Telemetry record and sensor values verified in PostgreSQL');
}

async function stop(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (interval) clearInterval(interval);
  const activeClient = client;
  if (activeClient?.connected) {
    await new Promise<void>((resolve) => activeClient.end(false, {}, () => resolve()));
  } else {
    activeClient?.end(true);
  }
  if (redis) await redis.quit();
  await prisma.$disconnect();
  process.exitCode = exitCode;
}

async function start(): Promise<void> {
  try {
    await assertSafeTarget();
    console.log('[PASS] Registered test device belongs to a disposable test database');
    if (isValidation) redis = new Redis(process.env.REDIS_URL!);
    const mqttClient = mqtt.connect(config.brokerUrl, {
      username: config.username,
      password: config.password,
      clientId: `sim-${config.deviceId}-${Math.random().toString(36).substring(2, 6)}`,
      connectTimeout: 10000,
      reconnectPeriod: 3000,
      will: {
        topic: topicStatus,
        payload: JSON.stringify({ status: 'offline', ts: Date.now() }),
        qos: 1,
        retain: false,
      },
    });
    client = mqttClient;

    mqttClient.on('connect', async () => {
      if (shuttingDown) return;
      try {
        console.log(`[MQTT] Authenticated connection established to ${config.brokerUrl}`);
        const statusPayload = {
          status: 'online',
          ip: '127.0.0.1',
          rssi: -58,
          free_heap: 312000,
          uptime: 10,
          firmware: 'simulator-test',
          ts: Date.now(),
        };
        await publish(topicStatus, statusPayload, 1);
        console.log(`[STATUS] Published heartbeat on ${topicStatus}`);

        if (isValidation) {
          const payload = generatePayload(seq++);
          await publish(topicTelemetry, payload, 1);
          console.log(`[TELEMETRY] Published test packet on ${topicTelemetry}`);
          await waitForValidation(payload);
          console.log('[PASS] MQTT -> NestJS -> Redis/PostgreSQL validation complete');
          await stop();
          return;
        }

        let packetsSent = 0;
        interval = setInterval(() => {
          void (async () => {
            const payload = generatePayload(seq++);
            await publish(topicTelemetry, payload, 0);
            packetsSent++;
            console.log(`[TELEMETRY #${payload.seq}] Published on ${topicTelemetry}`);
            if (!isContinuous && packetsSent >= 5) {
              await stop();
            }
          })().catch((error: unknown) => {
            console.error('[SIMULATOR ERROR]', error instanceof Error ? error.message : 'Unknown error');
            void stop(1);
          });
        }, 2500);
      } catch (error) {
        console.error('[SIMULATOR ERROR]', error instanceof Error ? error.message : 'Unknown error');
        await stop(1);
      }
    });

    mqttClient.on('error', (error) => {
      console.error('[MQTT ERROR]', error.message);
    });
  } catch (error) {
    console.error('[SIMULATOR ERROR]', error instanceof Error ? error.message : 'Unknown error');
    await stop(1);
  }
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
void start();
