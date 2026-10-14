import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module.js';
import { TelemetryProcessorService } from './telemetry-processor.service.js';
import { TelemetryRealtimeService } from './telemetry-realtime.service.js';
import { TelemetryPersistenceService } from './telemetry-persistence.service.js';
import { TelemetryController } from './telemetry.controller.js';

import { TelemetryGateway } from './telemetry.gateway.js';

import { JwtModule } from '@nestjs/jwt';
import { ActuatorsModule } from '../actuators/actuators.module.js';

@Module({
  imports: [MqttModule, ActuatorsModule, JwtModule.register({})],
  providers: [
    TelemetryProcessorService,
    TelemetryRealtimeService,
    TelemetryPersistenceService,
    TelemetryGateway,
  ],
  controllers: [TelemetryController],
  exports: [TelemetryRealtimeService, TelemetryPersistenceService, TelemetryGateway],
})
export class TelemetryModule {}
