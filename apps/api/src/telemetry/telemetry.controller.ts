import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TelemetryRealtimeService } from './telemetry-realtime.service.js';
import { TelemetryPersistenceService } from './telemetry-persistence.service.js';

@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller()
export class TelemetryController {
  private readonly logger = new Logger(TelemetryController.name);

  constructor(
    private readonly realtime: TelemetryRealtimeService,
    private readonly persistence: TelemetryPersistenceService,
  ) {}

  // ─── Realtime endpoints (from Redis) ────────────────────────────────────────

  @Get('devices/:deviceMqttId/telemetry/latest')
  @ApiOperation({ summary: 'Get realtime device state (from Redis)' })
  @ApiParam({ name: 'deviceMqttId', description: 'Device MQTT ID' })
  async getDeviceRealtime(@Param('deviceMqttId') deviceMqttId: string) {
    const state = await this.realtime.getDeviceState(deviceMqttId);
    return {
      data: state,
      cached: state !== null,
    };
  }

  @Get('greenhouses/:greenhouseId/telemetry/latest')
  @ApiOperation({ summary: 'Get realtime state for all devices in a greenhouse' })
  @ApiParam({ name: 'greenhouseId', description: 'Greenhouse ID' })
  async getGreenhouseRealtime(@Param('greenhouseId') greenhouseId: string) {
    const states = await this.realtime.getAllGreenhouseDeviceStates(greenhouseId);
    return {
      greenhouseId,
      deviceCount: states.length,
      devices: states,
    };
  }

  // ─── Historical endpoints (from PostgreSQL) ──────────────────────────────────

  @Get('devices/:deviceMqttId/telemetry/history')
  @ApiOperation({ summary: 'Get historical telemetry for a device' })
  @ApiParam({ name: 'deviceMqttId', description: 'Device MQTT ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max records (default 100)' })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO timestamp from' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'ISO timestamp to' })
  async getDeviceTelemetry(
    @Param('deviceMqttId') deviceMqttId: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const limitNum = limit ? Math.min(parseInt(limit, 10), 500) : 100;
    const records = await this.persistence.getDeviceHistory(deviceMqttId, limitNum, from, to);
    return {
      deviceMqttId,
      count: records.length,
      records,
    };
  }

  @Get('devices/:deviceMqttId/status-logs')
  @ApiOperation({ summary: 'Get status logs for a device' })
  @ApiParam({ name: 'deviceMqttId', description: 'Device MQTT ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getDeviceStatusLogs(
    @Param('deviceMqttId') deviceMqttId: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? Math.min(parseInt(limit, 10), 200) : 50;
    const logs = await this.persistence.getDeviceStatusLogs(deviceMqttId, limitNum);
    return {
      deviceMqttId,
      count: logs.length,
      logs,
    };
  }

  @Get('greenhouses/:greenhouseId/telemetry/stats')
  @ApiOperation({ summary: 'Get telemetry statistics for a greenhouse' })
  @ApiParam({ name: 'greenhouseId', description: 'Greenhouse ID (DB id or MQTT id)' })
  async getGreenhouseStats(@Param('greenhouseId') greenhouseId: string) {
    const stats = await this.persistence.getGreenhouseStats(greenhouseId);
    return { greenhouseId, ...stats };
  }
}