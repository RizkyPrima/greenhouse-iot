import { Module } from '@nestjs/common';
import { SensorsService } from './sensors.service.js';
import { SensorsController } from './sensors.controller.js';

@Module({
  controllers: [SensorsController],
  providers: [SensorsService],
  exports: [SensorsService],
})
export class SensorsModule {}
