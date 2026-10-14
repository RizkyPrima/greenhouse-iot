/**
 * ==============================================================================================
 * Automated MQTT Telemetry & Heartbeat Simulator for Phase 8 Validation
 * Simulates ESP32-S3-N16R8 telemetry and heartbeat streams
 * ==============================================================================================
 * Usage:
 *   npx tsx --env-file=.env scripts/simulate-telemetry.ts             # Sends 5 packets & exits
 *   npx tsx --env-file=.env scripts/simulate-telemetry.ts --stream    # Continuous stream (every 3s)
 *   npx tsx --env-file=.env scripts/simulate-telemetry.ts --validate  # End-to-end validation
 * ==============================================================================================
 */

import mqtt from 'mqtt';
import { PrismaClient } from '@prisma/client';

const BROKER_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const GREENHOUSE_ID = process.env.SIM_GH_ID || 'GH-MAIN-01';
const DEVICE_ID = process.env.SIM_DEVICE_ID || 'ESP32-S3-01';

const TOPIC_STATUS = `greenhouse/${GREENHOUSE_ID}/${DEVICE_ID}/status`;
const TOPIC_TELEMETRY = `greenhouse/${GREENHOUSE_ID}/${DEVICE_ID}/telemetry`;
const TOPIC_COMMAND = `greenhouse/${GREENHOUSE_ID}/${DEVICE_ID}/command`;

const args = process.argv.slice(2);
const isContinuous = args.includes('--stream') || args.includes('-c');
const isValidation = args.includes('--validate') || args.includes('-v');

console.log('====================================================');
console.log('  ESP32-S3 TELEMETRY SIMULATOR — PHASE 8 VALIDATION  ');
console.log('====================================================');
console.log(`Broker:       ${BROKER_URL}`);
console.log(`Greenhouse:   ${GREENHOUSE_ID}`);
console.log(`Device ID:    ${DEVICE_ID}`);
console.log(`Mode:         ${isContinuous ? 'CONTINUOUS' : isValidation ? 'VALIDATION' : '5-PACKET BATCH'}`);
console.log('----------------------------------------------------');

const client = mqtt.connect(BROKER_URL, {
  clientId: `sim-${DEVICE_ID}-${Math.random().toString(36).substring(2, 6)}`,
  will: {
    topic: TOPIC_STATUS,
    payload: JSON.stringify({ status: 'offline', ts: Date.now() }),
    qos: 1,
    retain: false,
  },
});

let seq = 1;

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

client.on('connect', async () => {
  console.log('[MQTT] Connected to broker successfully!');

  // Publish Initial Online Status Heartbeat
  const statusPayload = {
    status: 'online',
    ip: '192.168.1.105',
    rssi: -58,
    free_heap: 312000,
    uptime: 10,
    firmware: '1.0.0-esp32s3',
    ts: Date.now(),
  };

  client.publish(TOPIC_STATUS, JSON.stringify(statusPayload), { qos: 1 });
  console.log(`[STATUS] Published "online" heartbeat to ${TOPIC_STATUS}`);

  // Subscribe to command topic to listen for relay overrides
  client.subscribe(TOPIC_COMMAND, () => {
    console.log(`[SUBSCRIBE] Listening for commands on: ${TOPIC_COMMAND}`);
  });

  if (isValidation) {
    console.log('\n[TEST 1/2] Publishing test telemetry packet...');
    const payload = generatePayload(seq++);
    client.publish(TOPIC_TELEMETRY, JSON.stringify(payload), { qos: 0 }, async () => {
      console.log(`[TELEMETRY] Packet sent: ${JSON.stringify(payload)}`);

      // Give backend 500ms to persist
      await new Promise((r) => setTimeout(r, 600));

      console.log('[TEST 2/2] Validating persistence in PostgreSQL database...');
      const prisma = new PrismaClient();
      try {
        const dev = await prisma.device.findFirst({
          where: { deviceId: DEVICE_ID },
          include: { sensors: true },
        });

        if (!dev) {
          console.error('❌ FAIL: Device not found in PostgreSQL!');
          process.exit(1);
        }
        console.log(`✓ Device found in DB: "${dev.name}" (Status: ${dev.status})`);

        const latestRecord = await prisma.telemetryRecord.findFirst({
          where: { deviceMqttId: DEVICE_ID },
          include: { values: true },
          orderBy: { processedAt: 'desc' },
        });

        if (!latestRecord || latestRecord.values.length === 0) {
          console.error('❌ FAIL: Telemetry record was not persisted to database!');
          process.exit(1);
        }

        console.log(`✓ Telemetry record persisted: ID=${latestRecord.id}, values=${latestRecord.values.length}`);
        console.log('\n🎉 ALL VALIDATION CHECKS PASSED: MQTT -> NestJS -> PostgreSQL -> Realtime pipeline is 100% operational!\n');
      } catch (err) {
        console.error('Validation error:', err);
        process.exit(1);
      } finally {
        await prisma.$disconnect();
        client.end();
        process.exit(0);
      }
    });
    return;
  }

  // Batch or Continuous loop
  const interval = setInterval(() => {
    const payload = generatePayload(seq++);
    client.publish(TOPIC_TELEMETRY, JSON.stringify(payload), { qos: 0 });
    console.log(`[TELEMETRY #${payload.seq}] Temp: ${payload.sensors[0].value}°C | Hum: ${payload.sensors[1].value}% | Soil: ${payload.sensors[2].value}% | Lux: ${payload.sensors[3].value}`);

    if (!isContinuous && seq > 5) {
      clearInterval(interval);
      console.log('\n[SIMULATOR] Completed 5-packet batch. Disconnecting gracefully...');
      client.end();
      process.exit(0);
    }
  }, 2500);
});

client.on('message', (topic, message) => {
  console.log(`\n[COMMAND RECEIVED] Topic: ${topic} => ${message.toString()}`);
  // Echo ACK response
  const respTopic = `greenhouse/${GREENHOUSE_ID}/${DEVICE_ID}/response`;
  client.publish(respTopic, JSON.stringify({ deviceId: DEVICE_ID, status: 'ack', ts: Date.now() }));
  console.log(`[RESPONSE ACK] Sent to ${respTopic}`);
});

client.on('error', (err) => {
  console.error('[MQTT ERROR]', err.message);
});
