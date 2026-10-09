import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { DevicesService } from './devices.service.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { CreateSensorDto } from '../sensors/dto/create-sensor.dto.js';
import { SensorsService } from '../sensors/sensors.service.js';
import { CreateActuatorDto } from '../actuators/dto/create-actuator.dto.js';
import { ActuatorsService } from '../actuators/actuators.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devicesService: DevicesService,
    private readonly sensorsService: SensorsService,
    private readonly actuatorsService: ActuatorsService
  ) {}

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Post()
  create(@Body() createDeviceDto: CreateDeviceDto) {
    return this.devicesService.create(createDeviceDto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('organizationId') organizationId?: string) {
    return this.devicesService.findAll(user.id, organizationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDeviceDto: UpdateDeviceDto) {
    return this.devicesService.update(id, updateDeviceDto);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.devicesService.remove(id);
  }

  @Get(':id/sensors')
  findSensors(@Param('id') id: string) {
    return this.devicesService.findSensors(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Post(':id/sensors')
  createSensor(@Param('id') id: string, @Body() createSensorDto: CreateSensorDto) {
    createSensorDto.deviceId = id;
    return this.sensorsService.create(createSensorDto);
  }

  @Get(':id/actuators')
  findActuators(@Param('id') id: string) {
    return this.devicesService.findActuators(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Post(':id/actuators')
  createActuator(@Param('id') id: string, @Body() createActuatorDto: CreateActuatorDto) {
    createActuatorDto.deviceId = id;
    return this.actuatorsService.create(createActuatorDto);
  }
}
