/**
 * Seed Script — Demo Users + Organization + Memberships
 * Run: npx ts-node --esm prisma/seed.ts  OR  npm run db:seed
 */
import { PrismaClient, UserRole } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Password123!";

const DEMO_ORG = {
  name: "Standard Greenhouse",
  slug: "standard-greenhouse",
  description: "Primary IoT greenhouse organization for Phase 7 demo",
};

const DEMO_USERS = [
  { email: "owner@example.com", name: "Greenhouse Owner", role: UserRole.OWNER },
  { email: "admin@example.com", name: "Greenhouse Admin", role: UserRole.ADMIN },
  { email: "operator@example.com", name: "Greenhouse Operator", role: UserRole.OPERATOR },
  { email: "viewer@example.com", name: "Greenhouse Viewer", role: UserRole.VIEWER },
];

async function main() {
  console.log("Seeding demo data...");
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const org = await prisma.organization.upsert({
    where: { slug: DEMO_ORG.slug },
    update: { name: DEMO_ORG.name, description: DEMO_ORG.description },
    create: { ...DEMO_ORG },
  });
  console.log(`Organization: "${org.name}" (${org.id})`);

  for (const demo of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: { name: demo.name, isActive: true, passwordHash },
      create: { email: demo.email, name: demo.name, passwordHash, isActive: true },
    });
    await prisma.organizationMembership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: { role: demo.role },
      create: { userId: user.id, organizationId: org.id, role: demo.role },
    });
    console.log(`  ${demo.email} -> ${demo.role}`);
  }
  // Seed Default Greenhouse Facility
  const gh = await prisma.greenhouse.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "GH-MAIN-01" } },
    update: { name: "Smart Greenhouse Alpha", location: "Sector 1 Rooftop" },
    create: {
      organizationId: org.id,
      name: "Smart Greenhouse Alpha",
      code: "GH-MAIN-01",
      location: "Sector 1 Rooftop",
      timezone: "Asia/Jakarta",
      status: "ACTIVE",
    },
  });
  console.log(`Greenhouse: "${gh.name}" (code: ${gh.code}, id: ${gh.id})`);

  // Seed ESP32-S3-N16R8 Device
  const device = await prisma.device.upsert({
    where: { deviceId: "ESP32-S3-01" },
    update: {
      greenhouseId: gh.id,
      name: "ESP32-S3 Edge Controller",
      deviceType: "ESP32-S3-N16R8",
      hardwareVersion: "N16R8",
      firmwareVersion: "1.0.0",
      status: "ONLINE",
    },
    create: {
      greenhouseId: gh.id,
      deviceId: "ESP32-S3-01",
      name: "ESP32-S3 Edge Controller",
      deviceType: "ESP32-S3-N16R8",
      hardwareVersion: "N16R8",
      firmwareVersion: "1.0.0",
      status: "ONLINE",
    },
  });
  console.log(`Device: "${device.name}" (${device.deviceId})`);

  // Seed Sensors for ESP32-S3
  const sensors = [
    { code: "temperature", name: "Temperature", unit: "°C", sensorType: "DHT22" },
    { code: "humidity", name: "Humidity", unit: "%", sensorType: "DHT22" },
    { code: "soil_moisture", name: "Soil Moisture", unit: "%", sensorType: "CAPACITIVE" },
    { code: "light_intensity", name: "Light Intensity", unit: "lux", sensorType: "LDR" },
  ];

  for (const s of sensors) {
    await prisma.sensor.upsert({
      where: { deviceId_code: { deviceId: device.id, code: s.code } },
      update: { name: s.name, unit: s.unit },
      create: {
        deviceId: device.id,
        code: s.code,
        name: s.name,
        unit: s.unit,
        sensorType: s.sensorType,
        enabled: true,
      },
    });
  }

  // Seed Actuators for ESP32-S3
  const actuators = [
    { code: "pump", name: "Water Irrigation Pump", actuatorType: "RELAY" },
    { code: "fan", name: "Ventilation Exhaust Fan", actuatorType: "RELAY" },
    { code: "light", name: "Supplemental Grow Light", actuatorType: "RELAY" },
  ];

  for (const a of actuators) {
    await prisma.actuator.upsert({
      where: { deviceId_code: { deviceId: device.id, code: a.code } },
      update: { name: a.name },
      create: {
        deviceId: device.id,
        code: a.code,
        name: a.name,
        actuatorType: a.actuatorType,
        enabled: true,
      },
    });
  }

  console.log("Seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());