import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CommandStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import { ActuatorCommandDto } from './dto/actuator-command.dto.js';

const COMMAND_TIMEOUT_MS = 8000;
const TARGET_ALIASES: Record<string, string> = {
  pump: 'pump', pompa: 'pump',
  fan: 'fan', kipas: 'fan',
  light: 'light', lampu: 'light',
};

@Injectable()
export class ControlCommandsService {
  constructor(private readonly prisma: PrismaService, private readonly mqtt: MqttService) {}

  async send(actuatorId: string, userId: string, dto: ActuatorCommandDto) {
    const actuator = await this.prisma.actuator.findFirst({
      where: { id: actuatorId, deletedAt: null, enabled: true },
      include: { device: { include: { greenhouse: true } } },
    });
    if (!actuator) throw new NotFoundException('Enabled actuator not found');

    const target = TARGET_ALIASES[actuator.code.trim().toLowerCase()];
    if (!target) {
      throw new UnprocessableEntityException('This firmware only supports pump, fan, and light actuator codes');
    }

    const commandId = randomUUID();
    const record = await this.prisma.controlCommand.create({
      data: {
        commandId,
        deviceId: actuator.deviceId,
        actuatorId: actuator.id,
        userId,
        command: 'SET',
        target,
        value: dto.command === 'ON',
        status: CommandStatus.PENDING,
      },
    });
    const lastSeenAt = actuator.device.lastSeenAt?.getTime() ?? 0;
    if (actuator.device.status === 'OFFLINE' || !lastSeenAt || Date.now() - lastSeenAt > 30_000) {
      await this.failBeforePublish(record.id, 'Device is offline; command was not sent');
      throw new ServiceUnavailableException('Device is offline; command was not sent');
    }
    if (!this.mqtt.isConnected()) {
      await this.failBeforePublish(record.id, 'MQTT broker is unavailable; command was not sent');
      throw new ServiceUnavailableException('MQTT broker is unavailable; command was not sent');
    }
    const topic = `greenhouse/${actuator.device.greenhouse.code}/${actuator.device.deviceId}/command`;

    try {
      await this.mqtt.publish(topic, {
        commandId,
        command: dto.command,
        actuator: target,
      }, { qos: 1, retain: false });
      await this.prisma.controlCommand.updateMany({
        where: { id: record.id, status: CommandStatus.PENDING },
        data: { status: CommandStatus.SENT, sentAt: new Date() },
      });
      return await this.prisma.controlCommand.findUniqueOrThrow({ where: { id: record.id } });
    } catch (error) {
      await this.failBeforePublish(record.id, error instanceof Error ? error.message : 'MQTT publish failed');
      throw new ServiceUnavailableException('Unable to publish actuator command');
    }
  }

  private async failBeforePublish(id: string, error: string): Promise<void> {
    await this.prisma.controlCommand.updateMany({
      where: { id, status: { in: [CommandStatus.PENDING, CommandStatus.SENT] } },
      data: { status: CommandStatus.FAILED, error, completedAt: new Date() },
    });
  }

  async findByCommandId(commandId: string, userId: string) {
    const command = await this.prisma.controlCommand.findFirst({
      where: { commandId, device: { greenhouse: { organization: { memberships: { some: { userId } } } } } },
    });
    if (!command) throw new NotFoundException('Command not found');
    return command;
  }

  async findLatestActuatorStates(userId: string) {
    const commands = await this.prisma.controlCommand.findMany({
      where: {
        status: CommandStatus.EXECUTED,
        actuatorId: { not: null },
        device: { greenhouse: { organization: { memberships: { some: { userId } } } } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        actuatorId: true,
        result: true,
        createdAt: true,
      },
    });

    const latestByActuator = new Map<string, { actuatorId: string; activeState: boolean; updatedAt: Date }>();
    for (const command of commands) {
      if (!command.actuatorId || latestByActuator.has(command.actuatorId)) continue;
      const result = command.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
      const activeState = (result as Prisma.JsonObject).activeState;
      if (typeof activeState !== 'boolean') continue;
      latestByActuator.set(command.actuatorId, {
        actuatorId: command.actuatorId,
        activeState,
        updatedAt: command.createdAt,
      });
    }

    return [...latestByActuator.values()];
  }

  async handleResponse(deviceMqttId: string, payload: unknown) {
    if (!payload || typeof payload !== 'object') return null;
    const response = payload as Record<string, unknown>;
    const commandId = typeof response.commandId === 'string' ? response.commandId : '';
    if (!commandId || typeof response.status !== 'string' || typeof response.activeState !== 'boolean') return null;

    const command = await this.prisma.controlCommand.findUnique({
      where: { commandId },
      include: { device: { select: { deviceId: true, greenhouseId: true, greenhouse: { select: { code: true } } } } },
    });
    if (!command || command.device.deviceId !== deviceMqttId
      || (command.status !== CommandStatus.PENDING && command.status !== CommandStatus.SENT)) return null;

    const targetState = command.value === true;
    const succeeded = response.status === 'success'
      && response.activeState === targetState
      && response.actuator === command.target;
    const result = JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue;
    const updateResult = await this.prisma.controlCommand.updateMany({
      where: { id: command.id, status: { in: [CommandStatus.PENDING, CommandStatus.SENT] } },
      data: {
        status: succeeded ? CommandStatus.EXECUTED : CommandStatus.FAILED,
        acknowledgedAt: new Date(),
        completedAt: new Date(),
        result,
        error: succeeded ? null : (typeof response.error === 'string' ? response.error : 'Device rejected command or reported unexpected state'),
      },
    });
    if (updateResult.count === 0) return null;
    const updated = await this.prisma.controlCommand.findUniqueOrThrow({ where: { id: command.id } });
    return {
      commandId: updated.commandId,
      deviceMqttId,
      actuatorId: updated.actuatorId,
      target: updated.target,
      value: updated.value,
      status: updated.status,
      result: updated.result,
      error: updated.error,
      completedAt: updated.completedAt,
      greenhouseId: command.device.greenhouse.code,
      greenhouseDbId: command.device.greenhouseId,
    };
  }

  async expireSentCommands() {
    const cutoff = new Date(Date.now() - COMMAND_TIMEOUT_MS);
    const expired = await this.prisma.controlCommand.findMany({
      where: { status: CommandStatus.SENT, sentAt: { lt: cutoff } },
      include: { device: { select: { deviceId: true, greenhouseId: true, greenhouse: { select: { code: true } } } } },
    });
    if (expired.length === 0) return [];

    await this.prisma.controlCommand.updateMany({
      where: { id: { in: expired.map((item) => item.id) }, status: CommandStatus.SENT },
      data: { status: CommandStatus.TIMEOUT, error: 'Device did not acknowledge the command before timeout', completedAt: new Date() },
    });
    const actuallyExpired = await this.prisma.controlCommand.findMany({
      where: { id: { in: expired.map((item) => item.id) }, status: CommandStatus.TIMEOUT },
      include: { device: { select: { deviceId: true, greenhouseId: true, greenhouse: { select: { code: true } } } } },
    });
    return actuallyExpired.map((command) => ({
      commandId: command.commandId,
      deviceMqttId: command.device.deviceId,
      actuatorId: command.actuatorId,
      target: command.target,
      value: command.value,
      status: CommandStatus.TIMEOUT,
      error: 'Device did not acknowledge the command before timeout',
      completedAt: new Date(),
      greenhouseId: command.device.greenhouse.code,
      greenhouseDbId: command.device.greenhouseId,
    }));
  }
}
