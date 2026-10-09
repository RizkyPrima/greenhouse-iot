const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

const controllerFiles = [
  'zones/zones.controller.ts',
  'sensors/sensors.controller.ts',
  'actuators/actuators.controller.ts',
];

for (const file of controllerFiles) {
  const filePath = path.join(srcDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Remove Post from import { Controller, Get, Post, ... }
  content = content.replace(/,\s*Post\b/, '');
  // Because it could be the first after {
  content = content.replace(/\{\s*Post,\s*/, '{ ');

  // Remove CreateDto imports
  content = content.replace(/import \{ Create[a-zA-Z]+Dto \} from '\.\/dto\/create-[a-z-]+\.dto\.js';\n/, '');

  fs.writeFileSync(filePath, content);
}

// Fix sensors.service.ts
const sensorsServicePath = path.join(srcDir, 'sensors/sensors.service.ts');
let sensorsContent = fs.readFileSync(sensorsServicePath, 'utf8');

// Replace create
sensorsContent = sensorsContent.replace(
  /const data: Prisma\.SensorCreateInput = \{[\s\S]*?\};[\s\S]*?\/\/ @ts-ignore[\s\S]*?delete data\.zoneId;/,
  `const data: Prisma.SensorCreateInput = {
      name: createSensorDto.name,
      code: createSensorDto.code,
      sensorType: createSensorDto.sensorType,
      unit: createSensorDto.unit,
      enabled: createSensorDto.enabled,
      metadata: createSensorDto.metadata ? (createSensorDto.metadata as any) : Prisma.JsonNull,
      device: { connect: { id: createSensorDto.deviceId } },
      zone: createSensorDto.zoneId ? { connect: { id: createSensorDto.zoneId } } : undefined,
    };`
);

// Replace update
sensorsContent = sensorsContent.replace(
  /const data: Prisma\.SensorUpdateInput = \{[\s\S]*?\};[\s\S]*?\/\/ @ts-ignore[\s\S]*?delete data\.zoneId;\n\s*if \(updateSensorDto\.zoneId\) data\.zone = \{ connect: \{ id: updateSensorDto\.zoneId \} \};/,
  `const data: Prisma.SensorUpdateInput = {
      name: updateSensorDto.name,
      code: updateSensorDto.code,
      sensorType: updateSensorDto.sensorType,
      unit: updateSensorDto.unit,
      enabled: updateSensorDto.enabled,
      metadata: updateSensorDto.metadata !== undefined ? (updateSensorDto.metadata as any) : undefined,
    };
    if (updateSensorDto.zoneId) {
      data.zone = { connect: { id: updateSensorDto.zoneId } };
    }`
);

fs.writeFileSync(sensorsServicePath, sensorsContent);

// Fix actuators.service.ts
const actuatorsServicePath = path.join(srcDir, 'actuators/actuators.service.ts');
let actuatorsContent = fs.readFileSync(actuatorsServicePath, 'utf8');

// Replace create
actuatorsContent = actuatorsContent.replace(
  /const data: Prisma\.ActuatorCreateInput = \{[\s\S]*?\};[\s\S]*?\/\/ @ts-ignore[\s\S]*?delete data\.zoneId;/,
  `const data: Prisma.ActuatorCreateInput = {
      name: createActuatorDto.name,
      code: createActuatorDto.code,
      actuatorType: createActuatorDto.actuatorType,
      enabled: createActuatorDto.enabled,
      metadata: createActuatorDto.metadata ? (createActuatorDto.metadata as any) : Prisma.JsonNull,
      device: { connect: { id: createActuatorDto.deviceId } },
      zone: createActuatorDto.zoneId ? { connect: { id: createActuatorDto.zoneId } } : undefined,
    };`
);

// Replace update
actuatorsContent = actuatorsContent.replace(
  /const data: Prisma\.ActuatorUpdateInput = \{[\s\S]*?\};[\s\S]*?\/\/ @ts-ignore[\s\S]*?delete data\.zoneId;\n\s*if \(updateActuatorDto\.zoneId\) data\.zone = \{ connect: \{ id: updateActuatorDto\.zoneId \} \};/,
  `const data: Prisma.ActuatorUpdateInput = {
      name: updateActuatorDto.name,
      code: updateActuatorDto.code,
      actuatorType: updateActuatorDto.actuatorType,
      enabled: updateActuatorDto.enabled,
      metadata: updateActuatorDto.metadata !== undefined ? (updateActuatorDto.metadata as any) : undefined,
    };
    if (updateActuatorDto.zoneId) {
      data.zone = { connect: { id: updateActuatorDto.zoneId } };
    }`
);

fs.writeFileSync(actuatorsServicePath, actuatorsContent);

console.log('Fixed');
