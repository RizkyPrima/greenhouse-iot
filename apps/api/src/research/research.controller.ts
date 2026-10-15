import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ResearchAdminGuard } from './research-admin.guard.js';
import { RegisterResearchSourceDto, ResearchListQueryDto, SearchResearchSourcesDto } from './research.dto.js';
import { ResearchService } from './research.service.js';

@ApiTags('Research Source Registry')
@ApiBearerAuth()
@Controller('research')
@UseGuards(ResearchAdminGuard)
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Post('sources/manual')
  register(@Body() dto: RegisterResearchSourceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.research.register(dto, user);
  }

  @Post('sources/search')
  search(@Body() dto: SearchResearchSourcesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.research.search(dto, user);
  }

  @Get('sources')
  listSources(@Query() query: ResearchListQueryDto) {
    return this.research.listSources(query);
  }

  @Get('sources/:id')
  getSource(@Param('id') id: string) {
    return this.research.getSource(id);
  }

  @Get('jobs')
  listJobs(@Query() query: ResearchListQueryDto) {
    return this.research.listJobs(query);
  }
}
