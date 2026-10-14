import { Controller, Get, Body, Patch, Param, Delete, Post } from '@nestjs/common';
import { ActuatorsService } from './actuators.service.js';
import { UpdateActuatorDto } from './dto/update-actuator.dto.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ControlCommandsService } from './control-commands.service.js';
import { ActuatorCommandDto } from './dto/actuator-command.dto.js';

@ApiTags('Actuators')
@ApiBearerAuth()
@Controller('actuators')
export class ActuatorsController {
  constructor(
    private readonly actuatorsService: ActuatorsService,
    private readonly commands: ControlCommandsService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.actuatorsService.findAll(user.id);
  }

  @Get('commands/:commandId')
  findCommand(@Param('commandId') commandId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.commands.findByCommandId(commandId, user.id);
  }

  @Get('states')
  findLatestStates(@CurrentUser() user: AuthenticatedUser) {
    return this.commands.findLatestActuatorStates(user.id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.OPERATOR)
  @Post(':id/command')
  sendCommand(
    @Param('id') id: string,
    @Body() dto: ActuatorCommandDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commands.send(id, user.id, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.actuatorsService.findOne(id);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateActuatorDto: UpdateActuatorDto) {
    return this.actuatorsService.update(id, updateActuatorDto);
  }

  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.actuatorsService.remove(id);
  }
}
