import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { HealthResponseDto } from './health.dto.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Check health status of API, PostgreSQL, and Redis' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All services are up and healthy',
    type: HealthResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'One or more services are degraded or down',
    type: HealthResponseDto,
  })
  async checkHealth(@Res({ passthrough: false }) res: Response): Promise<void> {
    const health = await this.healthService.check();
    const httpStatus =
      health.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    res.status(httpStatus).json(health);
  }
}
