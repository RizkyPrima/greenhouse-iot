import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateRuleSetDto, DecisionFeedbackDto } from './decision-manager.dto.js';
import { DecisionManagerService } from './decision-manager.service.js';

@ApiTags('Rule Engine / Decision Manager')
@ApiBearerAuth()
@Controller()
export class DecisionManagerController {
  constructor(private readonly decisions: DecisionManagerService) {}

  @Post('organizations/:organizationId/plant-profile-versions/:versionId/rule-sets')
  createRuleSet(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @Body() dto: CreateRuleSetDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.decisions.createRuleSet(organizationId, versionId, dto.definition, actor);
  }

  @Get('organizations/:organizationId/plant-profile-versions/:versionId/rule-sets')
  listRuleSets(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.decisions.listRuleSets(organizationId, versionId, actor);
  }

  @Post('organizations/:organizationId/rule-sets/:ruleSetId/approve')
  approveRuleSet(@Param('organizationId') organizationId: string, @Param('ruleSetId') ruleSetId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.decisions.approveRuleSet(organizationId, ruleSetId, actor);
  }

  @Get('organizations/:organizationId/decisions')
  listDecisions(@Param('organizationId') organizationId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.decisions.listDecisions(organizationId, actor);
  }

  @Post('organizations/:organizationId/decisions/:decisionId/feedback')
  addFeedback(@Param('organizationId') organizationId: string, @Param('decisionId') decisionId: string, @Body() dto: DecisionFeedbackDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.decisions.addFeedback(organizationId, decisionId, dto.feedback, dto.details, actor);
  }
}
