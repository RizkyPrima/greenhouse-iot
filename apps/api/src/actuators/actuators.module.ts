import { Module } from '@nestjs/common';
import { ActuatorsService } from './actuators.service.js';
import { ActuatorsController } from './actuators.controller.js';

@Module({
  controllers: [ActuatorsController],
  providers: [ActuatorsService],
  exports: [ActuatorsService],
})
export class ActuatorsModule {}
