import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class ActuatorCommandDto {
  @ApiProperty({ enum: ['ON', 'OFF'] })
  @IsIn(['ON', 'OFF'])
  command: 'ON' | 'OFF';
}
