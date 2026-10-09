import { Module } from '@nestjs/common';
import { GreenhousesService } from './greenhouses.service.js';
import { GreenhousesController } from './greenhouses.controller.js';
import { ZonesModule } from '../zones/zones.module.js';

@Module({
  imports: [ZonesModule],
  controllers: [GreenhousesController],
  providers: [GreenhousesService],
})
export class GreenhousesModule {}
