import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ResearchGrantAdminGuard } from './research-grant-admin.guard.js';
import { CreateResearchSourceGrantDto } from './research-grants.dto.js';
import { ResearchGrantsService } from './research-grants.service.js';

@ApiTags('Research Source Grant Administration')
@ApiBearerAuth()
@Controller('platform/research-source-grants')
@UseGuards(ResearchGrantAdminGuard)
export class ResearchGrantsController {
  constructor(private readonly grants: ResearchGrantsService) {}

  @Post()
  create(@Body() dto: CreateResearchSourceGrantDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.grants.create(dto.userId, actor);
  }

  @Patch(':grantId/revoke')
  revoke(@Param('grantId') grantId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.grants.revoke(grantId, actor);
  }
}
