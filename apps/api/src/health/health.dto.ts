import { ApiProperty } from '@nestjs/swagger';

export class ServiceStatusDto {
  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  api: 'up' | 'down';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  database: 'up' | 'down';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  redis: 'up' | 'down';

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  mqtt: 'up' | 'down';
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded'] })
  status: 'ok' | 'degraded';

  @ApiProperty({ example: '2026-10-01T05:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ type: ServiceStatusDto })
  services: ServiceStatusDto;
}
