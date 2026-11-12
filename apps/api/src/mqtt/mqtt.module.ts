import { Global, Module } from '@nestjs/common';
import { MqttService } from './mqtt.service.js';
import { EmqxManagementService } from './emqx-management.service.js';

@Global()
@Module({
  providers: [EmqxManagementService, MqttService],
  exports: [MqttService, EmqxManagementService],
})
export class MqttModule {}
