import { Controller, Get, Body, Patch, Param, Delete } from '@nestjs/common';
import { ZonesService } from './zones.service.js';
import { UpdateZoneDto } from './dto/update-zone.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';

@ApiTags('Zones')
@ApiBearerAuth()
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.zonesService.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.zonesService.findOne(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateZoneDto: UpdateZoneDto) {
    return this.zonesService.update(id, updateZoneDto);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.zonesService.remove(id);
  }
}
