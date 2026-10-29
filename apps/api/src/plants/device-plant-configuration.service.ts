import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DevicePlantConfigurationStatus, PlantVersionStatus, UserRole, Prisma } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { buildGreenhouseTopic } from '../mqtt/mqtt.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { plantParameterDefinitionChecksum } from './plant-config.js';
import type { ApplyDevicePlantConfigurationDto } from './device-plant-configuration.dto.js';

const PARAMETER_SENSOR_CODES: Record<string, string> = {
  air_temperature: 'temperature',
  relative_humidity: 'humidity',
  soil_moisture: 'soil_moisture',
  light_intensity: 'light_intensity',
};
const CAPABILITY_SCHEMA = 'plant-monitoring/v1';
const DEVICE_ONLINE_WINDOW_MS = 30_000;
const ACK_TIMEOUT_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class DevicePlantConfigurationService {
  private readonly logger = new Logger(DevicePlantConfigurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly mqtt: MqttService,
  ) {}

  async listDevices(organizationId: string, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, [UserRole.OWNER, UserRole.ADMIN]);
    const devices = await this.prisma.device.findMany({
      where: { deletedAt: null, greenhouse: { organizationId, deletedAt: null } },
      include: {
        greenhouse: { select: { code: true, name: true } },
        sensors: { where: { deletedAt: null, enabled: true }, select: { code: true, name: true, unit: true } },
        plantConfigurations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { configurationId: true, version: true, status: true, createdAt: true, error: true },
        },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });

    return Promise.all(devices.map(async (device) => {
      const latestStatus = await this.prisma.deviceStatusLog.findFirst({
        where: { deviceMqttId: device.deviceId, greenhouseId: device.greenhouse.code },
        orderBy: { receivedAt: 'desc' },
        select: { rawPayload: true, receivedAt: true },
      });
      const rawStatus = isRecord(latestStatus?.rawPayload) ? latestStatus.rawPayload : {};
      const capability = isRecord(rawStatus.capabilities) ? rawStatus.capabilities : {};
      const sensorCodes = Array.isArray(capability.sensorCodes)
        ? capability.sensorCodes.filter((code): code is string => typeof code === 'string')
        : [];
      const registeredSensorCodes = new Set(device.sensors.map(({ code }) => code));
      const supportedParameterKeys = Object.entries(PARAMETER_SENSOR_CODES)
        .filter(([, code]) => sensorCodes.includes(code) && registeredSensorCodes.has(code))
        .map(([key]) => key);
      const dataMode = capability.sensorDataMode === 'PHYSICAL' || capability.sensorDataMode === 'SIMULATED'
        ? capability.sensorDataMode
        : null;
      const lastSeenAt = device.lastSeenAt;
      return {
        id: device.id,
        deviceId: device.deviceId,
        name: device.name,
        greenhouse: device.greenhouse,
        status: device.status,
        lastSeenAt,
        firmwareVersion: device.firmwareVersion,
        sensors: device.sensors,
        lastConfiguration: device.plantConfigurations[0] ?? null,
        capability: {
          schema: capability.plantConfiguration === CAPABILITY_SCHEMA ? CAPABILITY_SCHEMA : null,
          sensorCodes,
          supportedParameterKeys,
          sensorDataMode: dataMode,
          reportedAt: latestStatus?.receivedAt ?? null,
        },
      };
    }));
  }

  async apply(
    organizationId: string,
    deviceId: string,
    input: ApplyDevicePlantConfigurationDto,
    actor: AuthenticatedUser,
  ) {
    await this.authorization.requireRole(actor.id, organizationId, [UserRole.OWNER, UserRole.ADMIN]);

    const existing = await this.prisma.devicePlantConfiguration.findUnique({
      where: { configurationId: input.configurationId },
    });
    if (existing) {
      if (existing.organizationId !== organizationId || existing.deviceId !== deviceId) {
        throw new ConflictException('Configuration id has already been used for another device.');
      }
      const existingPayload = isRecord(existing.payload) ? existing.payload : {};
      if (existing.catalogVersionId !== input.catalogVersionId
        || !Array.isArray(existingPayload.parameterKeys)
        || JSON.stringify(existingPayload.parameterKeys) !== JSON.stringify(input.parameterKeys)) {
        throw new ConflictException('Configuration id was reused with different catalog parameters.');
      }
      if (existing.status === DevicePlantConfigurationStatus.PENDING) {
        const catalogVersion = await this.prisma.plantCatalogVersion.findFirst({
          where: {
            id: existing.catalogVersionId,
            status: PlantVersionStatus.PUBLISHED,
            plantCatalog: { organizationId },
          },
          include: { parameterDefinitions: true },
        });
        if (!catalogVersion) throw new ConflictException('Only a published catalog version belonging to this organization can be applied.');
        const definitionsByKey = new Map(catalogVersion.parameterDefinitions.map((definition) => [definition.parameterKey, definition]));
        const existingKeys = existingPayload.parameterKeys.filter((key): key is string => typeof key === 'string');
        const definitions = existingKeys.map((key) => definitionsByKey.get(key)).filter((definition) => definition !== undefined);
        if (definitions.length !== existingKeys.length) {
          throw new ConflictException('Pending device configuration references parameters outside its published catalog version.');
        }
        await this.assertParameterDefinitionsUserValidated(organizationId, definitions);
        return this.publishExisting(existing);
      }
      return existing;
    }

    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, deletedAt: null, greenhouse: { organizationId, deletedAt: null } },
      include: {
        greenhouse: { select: { id: true, code: true } },
        sensors: { where: { deletedAt: null, enabled: true }, select: { code: true } },
      },
    });
    if (!device) throw new NotFoundException('Device not found in this organization.');
    if (device.status !== 'ONLINE' || !device.lastSeenAt
      || Date.now() - device.lastSeenAt.getTime() > DEVICE_ONLINE_WINDOW_MS) {
      throw new ConflictException('Device must be online and have reported within the last 30 seconds.');
    }

    const latestStatus = await this.prisma.deviceStatusLog.findFirst({
      where: { deviceMqttId: device.deviceId, greenhouseId: device.greenhouse.code },
      orderBy: { receivedAt: 'desc' },
      select: { rawPayload: true, receivedAt: true },
    });
    const rawStatus = isRecord(latestStatus?.rawPayload) ? latestStatus.rawPayload : {};
    const capability = isRecord(rawStatus.capabilities) ? rawStatus.capabilities : {};
    const reportedAt = latestStatus?.receivedAt?.getTime() ?? 0;
    if (capability.plantConfiguration !== CAPABILITY_SCHEMA || Date.now() - reportedAt > DEVICE_ONLINE_WINDOW_MS) {
      throw new ConflictException('Device firmware has not reported support for plant-monitoring/v1 recently. Update its firmware and wait for a fresh heartbeat.');
    }
    if (capability.sensorDataMode !== 'PHYSICAL' && capability.sensorDataMode !== 'SIMULATED') {
      throw new ConflictException('Device has not reported whether its sensor readings are physical or simulated.');
    }

    const catalogVersion = await this.prisma.plantCatalogVersion.findFirst({
      where: {
        id: input.catalogVersionId,
        status: PlantVersionStatus.PUBLISHED,
        plantCatalog: { organizationId },
      },
      include: { parameterDefinitions: true },
    });
    if (!catalogVersion) throw new ConflictException('Only a published catalog version belonging to this organization can be applied.');

    const definitions = new Map(catalogVersion.parameterDefinitions.map((definition) => [definition.parameterKey, definition]));
    const missingKeys = input.parameterKeys.filter((key) => !definitions.has(key));
    if (missingKeys.length > 0) {
      throw new BadRequestException(`Parameters are not defined by the published catalog version: ${missingKeys.join(', ')}`);
    }
    const unsupportedKeys = input.parameterKeys.filter((key) => !PARAMETER_SENSOR_CODES[key]);
    if (unsupportedKeys.length > 0) {
      throw new UnprocessableEntityException({
        code: 'DEVICE_PARAMETER_UNSUPPORTED',
        message: 'The current ESP32-S3 firmware cannot monitor one or more selected catalog parameters.',
        parameterKeys: unsupportedKeys,
      });
    }

    const selectedDefinitions = input.parameterKeys.map((key) => definitions.get(key)!);
    await this.assertParameterDefinitionsUserValidated(organizationId, selectedDefinitions);

    const sensorCodes = input.parameterKeys.map((key) => PARAMETER_SENSOR_CODES[key]);
    const reportedSensorCodes = new Set(
      Array.isArray(capability.sensorCodes) ? capability.sensorCodes.filter((code): code is string => typeof code === 'string') : [],
    );
    const registeredSensorCodes = new Set(device.sensors.map(({ code }) => code));
    const unavailable = sensorCodes.filter((code) => !reportedSensorCodes.has(code) || !registeredSensorCodes.has(code));
    if (unavailable.length > 0) {
      throw new UnprocessableEntityException({
        code: 'DEVICE_SENSOR_UNAVAILABLE',
        message: 'Selected parameters require sensor channels that this device has not reported and registered.',
        sensorCodes: unavailable,
      });
    }

    const previous = await this.prisma.devicePlantConfiguration.findFirst({
      where: { deviceId: device.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (previous?.version ?? 0) + 1;
    const payload = {
      type: 'plant_config',
      schema: CAPABILITY_SCHEMA,
      configurationId: input.configurationId,
      version,
      mode: 'monitoring_only',
      catalogVersionId: catalogVersion.id,
      parameterKeys: input.parameterKeys,
      sensorCodes,
    };
    let delivery;
    try {
      delivery = await this.prisma.devicePlantConfiguration.create({
        data: {
          configurationId: input.configurationId,
          organizationId,
          deviceId: device.id,
          deviceMqttId: device.deviceId,
          catalogVersionId: catalogVersion.id,
          version,
          status: DevicePlantConfigurationStatus.PENDING,
          payload: payload as Prisma.InputJsonValue,
          createdByUserId: actor.id,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A device configuration was created concurrently. Refresh the device status and retry with a new configuration id.');
      }
      throw error;
    }

    return this.publishExisting(delivery);
  }

  private async assertParameterDefinitionsUserValidated(
    organizationId: string,
    selectedDefinitions: Array<{
      id: string;
      parameterKey: string;
      label: string;
      dataType: string;
      unit: string | null;
      valueSchema: unknown;
      metadataSchema: unknown;
    }>,
  ) {
    const validationAudits = await this.prisma.plantConfigAuditEvent.findMany({
      where: {
        organizationId,
        action: 'CATALOG_PARAMETER_USER_VALIDATED',
        entityType: 'PlantParameterDefinition',
        entityId: { in: selectedDefinitions.map(({ id }) => id) },
        actorUserId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, toChecksum: true },
    });
    const latestValidationByParameter = new Map<string, (typeof validationAudits)[number]>();
    for (const audit of validationAudits) {
      if (!latestValidationByParameter.has(audit.entityId)) latestValidationByParameter.set(audit.entityId, audit);
    }
    const unvalidatedKeys = selectedDefinitions
      .filter((definition) => latestValidationByParameter.get(definition.id)?.toChecksum !== plantParameterDefinitionChecksum(definition))
      .map(({ parameterKey }) => parameterKey);
    if (unvalidatedKeys.length > 0) {
      throw new UnprocessableEntityException({
        code: 'DEVICE_PARAMETER_NOT_USER_VALIDATED',
        message: 'One or more selected parameters have not been reviewed by a user since their latest changes.',
        parameterKeys: unvalidatedKeys,
      });
    }
  }

  async getDelivery(organizationId: string, configurationId: string, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, [UserRole.OWNER, UserRole.ADMIN]);
    const delivery = await this.prisma.devicePlantConfiguration.findFirst({
      where: { configurationId, organizationId },
    });
    if (!delivery) throw new NotFoundException('Device configuration delivery not found.');
    if ((delivery.status === DevicePlantConfigurationStatus.PENDING
      || delivery.status === DevicePlantConfigurationStatus.PUBLISHING
      || delivery.status === DevicePlantConfigurationStatus.SENT
      || delivery.status === DevicePlantConfigurationStatus.RECEIVED)
      && Date.now() - delivery.createdAt.getTime() > ACK_TIMEOUT_MS) {
      return this.prisma.devicePlantConfiguration.update({
        where: { id: delivery.id },
        data: {
          status: DevicePlantConfigurationStatus.TIMEOUT,
          error: 'No device acknowledgement received within 60 seconds.',
          completedAt: new Date(),
        },
      });
    }
    return delivery;
  }

  async handleAcknowledgement(
    greenhouseCode: string,
    deviceMqttId: string,
    payload: unknown,
  ): Promise<void> {
    if (!isRecord(payload) || payload.type !== 'plant_config'
      || typeof payload.configurationId !== 'string'
      || !Number.isInteger(payload.version)
      || !['RECEIVED', 'APPLIED', 'REJECTED'].includes(String(payload.status))) {
      this.logger.warn(`[PLANT_CONFIG_ACK_INVALID] device=${deviceMqttId}`);
      return;
    }

    const delivery = await this.prisma.devicePlantConfiguration.findFirst({
      where: {
        configurationId: payload.configurationId,
        deviceMqttId,
        device: { greenhouse: { code: greenhouseCode } },
      },
    });
    if (!delivery || delivery.version !== payload.version
      || delivery.status === DevicePlantConfigurationStatus.TIMEOUT
      || delivery.status === DevicePlantConfigurationStatus.FAILED
      || delivery.status === DevicePlantConfigurationStatus.REJECTED) {
      this.logger.warn(`[PLANT_CONFIG_ACK_UNMATCHED] device=${deviceMqttId} configuration=${payload.configurationId}`);
      return;
    }

    const status = payload.status as 'RECEIVED' | 'APPLIED' | 'REJECTED';
    const now = new Date();
    const data: Prisma.DevicePlantConfigurationUpdateInput = status === 'RECEIVED'
      ? { status: DevicePlantConfigurationStatus.RECEIVED, receivedAt: delivery.receivedAt ?? now }
      : status === 'APPLIED'
        ? { status: DevicePlantConfigurationStatus.APPLIED, receivedAt: delivery.receivedAt ?? now, appliedAt: now, completedAt: now, error: null }
        : {
            status: DevicePlantConfigurationStatus.REJECTED,
            error: typeof payload.error === 'string' ? payload.error.slice(0, 500) : 'Device rejected the monitoring configuration.',
            completedAt: now,
          };

    await this.prisma.devicePlantConfiguration.updateMany({
      where: {
        id: delivery.id,
        status: {
          in: [
            DevicePlantConfigurationStatus.PUBLISHING,
            DevicePlantConfigurationStatus.PENDING,
            DevicePlantConfigurationStatus.SENT,
            DevicePlantConfigurationStatus.RECEIVED,
          ],
        },
      },
      data,
    });
  }

  private async publishExisting(delivery: {
    id: string;
    status: DevicePlantConfigurationStatus;
    payload: Prisma.JsonValue;
    deviceMqttId: string;
    deviceId: string;
    configurationId: string;
  }) {
    if (delivery.status !== DevicePlantConfigurationStatus.PENDING) {
      return delivery;
    }
    const claimed = await this.prisma.devicePlantConfiguration.updateMany({
      where: { id: delivery.id, status: DevicePlantConfigurationStatus.PENDING },
      data: { status: DevicePlantConfigurationStatus.PUBLISHING },
    });
    if (claimed.count !== 1) {
      return this.prisma.devicePlantConfiguration.findUniqueOrThrow({ where: { id: delivery.id } });
    }

    const device = await this.prisma.device.findFirst({
      where: { id: delivery.deviceId, deletedAt: null },
      include: { greenhouse: { select: { code: true } } },
    });
    if (!device) {
      await this.prisma.devicePlantConfiguration.update({
        where: { id: delivery.id },
        data: { status: DevicePlantConfigurationStatus.FAILED, error: 'Device no longer exists.', completedAt: new Date() },
      });
      throw new NotFoundException('Device no longer exists.');
    }
    if (!this.mqtt.isConnected()) {
      await this.prisma.devicePlantConfiguration.update({
        where: { id: delivery.id },
        data: { status: DevicePlantConfigurationStatus.FAILED, error: 'MQTT broker is not connected.', completedAt: new Date() },
      });
      throw new ServiceUnavailableException({ code: 'MQTT_UNAVAILABLE', message: 'MQTT broker is not connected; no device configuration was sent.' });
    }

    try {
      await this.mqtt.publish(
        buildGreenhouseTopic(device.greenhouse.code, delivery.deviceMqttId, 'config'),
        JSON.stringify(delivery.payload),
        { qos: 1, retain: false },
      );
    } catch (error) {
      await this.prisma.devicePlantConfiguration.update({
        where: { id: delivery.id },
        data: {
          status: DevicePlantConfigurationStatus.FAILED,
          error: error instanceof Error ? error.message.slice(0, 500) : 'MQTT publish failed.',
          completedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException({ code: 'MQTT_PUBLISH_FAILED', message: 'MQTT broker did not accept the device configuration. No device acknowledgement is assumed.' });
    }

    const sentAt = new Date();
    await this.prisma.devicePlantConfiguration.updateMany({
      where: { id: delivery.id, status: DevicePlantConfigurationStatus.PUBLISHING },
      data: { status: DevicePlantConfigurationStatus.SENT, sentAt },
    });
    return this.prisma.devicePlantConfiguration.findUniqueOrThrow({ where: { id: delivery.id } });
  }
}
