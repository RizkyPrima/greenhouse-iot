import { Global, Module } from '@nestjs/common';
import { MqttService } from './mqtt.service.js';

@Global()
@Module({
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
