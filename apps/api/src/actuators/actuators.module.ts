import { Module } from '@nestjs/common';
import { ActuatorsService } from './actuators.service.js';
import { ActuatorsController } from './actuators.controller.js';
import { ControlCommandsService } from './control-commands.service.js';

@Module({
  controllers: [ActuatorsController],
  providers: [ActuatorsService, ControlCommandsService],
  exports: [ActuatorsService, ControlCommandsService],
})
export class ActuatorsModule {}
