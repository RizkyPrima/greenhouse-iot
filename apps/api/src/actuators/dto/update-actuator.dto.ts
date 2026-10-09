import { PartialType } from '@nestjs/swagger';
import { CreateActuatorDto } from './create-actuator.dto.js';

export class UpdateActuatorDto extends PartialType(CreateActuatorDto) {}
