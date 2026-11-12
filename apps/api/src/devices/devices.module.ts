import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import { DevicesController } from './devices.controller.js';
import { SensorsModule } from '../sensors/sensors.module.js';
import { ActuatorsModule } from '../actuators/actuators.module.js';
import { MqttDeviceProvisioningService } from './mqtt-device-provisioning.service.js';

@Module({
  imports: [SensorsModule, ActuatorsModule],
  controllers: [DevicesController],
  providers: [DevicesService, MqttDeviceProvisioningService],
})
export class DevicesModule {}
