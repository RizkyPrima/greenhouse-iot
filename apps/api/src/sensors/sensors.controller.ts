import { Controller, Get, Body, Patch, Param, Delete } from '@nestjs/common';
import { SensorsService } from './sensors.service.js';
import { UpdateSensorDto } from './dto/update-sensor.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@ApiTags('Sensors')
@ApiBearerAuth()
@Controller('sensors')
export class SensorsController {
  constructor(private readonly sensorsService: SensorsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.sensorsService.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sensorsService.findOne(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSensorDto: UpdateSensorDto) {
    return this.sensorsService.update(id, updateSensorDto);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sensorsService.remove(id);
  }
}
