import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { GreenhousesService } from './greenhouses.service.js';
import { CreateGreenhouseDto } from './dto/create-greenhouse.dto.js';
import { UpdateGreenhouseDto } from './dto/update-greenhouse.dto.js';
import { CreateZoneDto } from '../zones/dto/create-zone.dto.js';
import { ZonesService } from '../zones/zones.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@ApiTags('Greenhouses')
@ApiBearerAuth()
@Controller('greenhouses')
export class GreenhousesController {
  constructor(
    private readonly greenhousesService: GreenhousesService,
    private readonly zonesService: ZonesService
  ) {}

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Post()
  create(@Body() createGreenhouseDto: CreateGreenhouseDto) {
    return this.greenhousesService.create(createGreenhouseDto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('organizationId') organizationId?: string) {
    return this.greenhousesService.findAll(user.id, organizationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.greenhousesService.findOne(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateGreenhouseDto: UpdateGreenhouseDto) {
    return this.greenhousesService.update(id, updateGreenhouseDto);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.greenhousesService.remove(id);
  }

  @Get(':id/zones')
  findZones(@Param('id') id: string) {
    return this.greenhousesService.findZones(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Post(':id/zones')
  createZone(@Param('id') id: string, @Body() createZoneDto: CreateZoneDto) {
    createZoneDto.greenhouseId = id;
    return this.zonesService.create(createZoneDto);
  }
}
