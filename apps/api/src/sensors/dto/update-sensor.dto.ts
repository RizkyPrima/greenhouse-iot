import { PartialType } from '@nestjs/swagger';
import { CreateSensorDto } from './create-sensor.dto.js';

export class UpdateSensorDto extends PartialType(CreateSensorDto) {}
