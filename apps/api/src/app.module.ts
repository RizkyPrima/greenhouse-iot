import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/env.validation.js';
import {
  appConfig,
  databaseConfig,
  redisConfig,
  mqttConfig,
} from './config/app.config.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { HealthModule } from './health/health.module.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { LoggingMiddleware } from './common/middleware/logging.middleware.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { GreenhousesModule } from './greenhouses/greenhouses.module.js';
import { ZonesModule } from './zones/zones.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { SensorsModule } from './sensors/sensors.module.js';
import { ActuatorsModule } from './actuators/actuators.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlantsModule } from './plants/plants.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      load: [appConfig, databaseConfig, redisConfig, mqttConfig],
    }),
    PrismaModule,
    RedisModule,
    MqttModule,
    HealthModule,
    OrganizationsModule,
    GreenhousesModule,
    ZonesModule,
    DevicesModule,
    SensorsModule,
    ActuatorsModule,
    TelemetryModule,
    AuthModule,
    PlantsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, LoggingMiddleware)
      .forRoutes('{*path}');
  }
}
