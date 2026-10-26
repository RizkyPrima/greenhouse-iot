import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import {
  ActivatePlantProfileDto,
  AdoptPlantCatalogVersionDto,
  CreateCatalogVersionDto,
  CreateParameterDefinitionDto,
  CreatePlatformGrantDto,
  CreatePlantCatalogDto,
  CreatePlantProfileDto,
  CreateZoneOverrideDto,
  UpdateCatalogVersionDto,
  UpdateProfileDraftDto,
  UpdateGrowthStageDto,
  CreateGrowthStageDto,
  UpdateParameterDefinitionDto,
} from './dto/plant.dto.js';
import { PlantsService } from './plants.service.js';

@ApiTags('Plant Standardization')
@ApiBearerAuth()
@Controller()
export class PlantsController {
  constructor(private readonly plants: PlantsService) {}

  @Get('organizations/:organizationId/plant-catalog')
  listOrganizationCatalog(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.listCatalogForOrganization(organizationId, user);
  }

  @Get('organizations/:organizationId/plant-catalog/:catalogId')
  getOrganizationCatalog(@Param('organizationId') organizationId: string, @Param('catalogId') catalogId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.getCatalogForOrganization(organizationId, catalogId, user);
  }

  @Post('organizations/:organizationId/plant-catalog')
  createCatalog(@Param('organizationId') organizationId: string, @Body() dto: CreatePlantCatalogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createCatalog(organizationId, dto, user);
  }

  @Post('organizations/:organizationId/plant-catalog/:catalogId/versions')
  createCatalogVersion(@Param('organizationId') organizationId: string, @Param('catalogId') id: string, @Body() dto: CreateCatalogVersionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createCatalogVersion(organizationId, id, dto, user);
  }

  @Patch('organizations/:organizationId/plant-catalog/versions/:versionId/draft')
  updateCatalogVersion(@Param('organizationId') organizationId: string, @Param('versionId') id: string, @Body() dto: UpdateCatalogVersionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateCatalogVersion(organizationId, id, dto, user);
  }

  @Post('organizations/:organizationId/plant-catalog/versions/:versionId/parameters')
  createParameter(@Param('organizationId') organizationId: string, @Param('versionId') id: string, @Body() dto: CreateParameterDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createParameterDefinition(organizationId, id, dto, user);
  }

  @Patch('organizations/:organizationId/plant-catalog/versions/:versionId/parameters/:parameterId')
  updateParameter(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @Param('parameterId') parameterId: string, @Body() dto: UpdateParameterDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateParameterDefinition(organizationId, versionId, parameterId, dto, user);
  }

  @Delete('organizations/:organizationId/plant-catalog/versions/:versionId/parameters/:parameterId')
  deleteParameter(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @Param('parameterId') parameterId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.deleteParameterDefinition(organizationId, versionId, parameterId, user);
  }

  @Post('organizations/:organizationId/plant-catalog/versions/:versionId/publish')
  publishCatalogVersion(@Param('organizationId') organizationId: string, @Param('versionId') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.publishCatalogVersion(organizationId, id, user);
  }

  // Grant provisioning intentionally has no public/bootstrap endpoint. An existing platform admin
  // may delegate or revoke the capability; the first grant is provisioned out of band.
  @Post('platform-admin-grants')
  @UseGuards(PlatformAdminGuard)
  createPlatformGrant(@Body() dto: CreatePlatformGrantDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createPlatformGrant(dto.userId, user);
  }

  @Patch('platform-admin-grants/:grantId/revoke')
  @UseGuards(PlatformAdminGuard)
  revokePlatformGrant(@Param('grantId') grantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.revokePlatformGrant(grantId, user);
  }

  @Get('organizations/:organizationId/plant-profiles')
  listProfiles(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.listProfiles(organizationId, user);
  }

  @Get('organizations/:organizationId/plant-profiles/:profileId')
  getProfile(@Param('organizationId') organizationId: string, @Param('profileId') profileId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.getProfile(organizationId, profileId, user);
  }

  @Post('organizations/:organizationId/plant-profiles')
  createProfile(@Param('organizationId') organizationId: string, @Body() dto: CreatePlantProfileDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createProfile(organizationId, dto, user);
  }

  @Post('organizations/:organizationId/plant-profiles/:profileId/versions')
  createProfileVersion(@Param('organizationId') organizationId: string, @Param('profileId') profileId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createProfileVersion(organizationId, profileId, user);
  }

  @Patch('organizations/:organizationId/plant-profile-versions/:versionId/draft')
  updateProfileDraft(@Param('organizationId') organizationId: string, @Param('versionId') id: string, @Body() dto: UpdateProfileDraftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateProfileDraft(organizationId, id, dto, user);
  }

  @Post('organizations/:organizationId/plant-profile-versions/:versionId/stages')
  createGrowthStage(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @Body() dto: CreateGrowthStageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createGrowthStage(organizationId, versionId, dto, user);
  }

  @Patch('organizations/:organizationId/growth-stages/:stageId')
  updateGrowthStage(@Param('organizationId') organizationId: string, @Param('stageId') stageId: string, @Body() dto: UpdateGrowthStageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateGrowthStage(organizationId, stageId, dto, user);
  }

  @Post('organizations/:organizationId/plant-profiles/:profileId/adoptions')
  adoptCatalogVersion(
    @Param('organizationId') organizationId: string,
    @Param('profileId') profileId: string,
    @Body() dto: AdoptPlantCatalogVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plants.adoptCatalogVersion(organizationId, profileId, dto, user);
  }

  @Post('organizations/:organizationId/plant-profile-versions/:versionId/validate')
  validateProfileVersion(@Param('organizationId') organizationId: string, @Param('versionId') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.validateProfileVersion(organizationId, id, user);
  }

  @Get('organizations/:organizationId/plant-config-audit')
  listAudit(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.listAudit(organizationId, user);
  }

  @Get('zones/:zoneId/plant-assignments')
  listZoneAssignments(@Param('zoneId') zoneId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.listZoneAssignments(zoneId, user);
  }

  @Post('zones/:zoneId/plant-assignments')
  activateZone(@Param('zoneId') zoneId: string, @Body() dto: ActivatePlantProfileDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.activateZone(zoneId, dto, user);
  }

  @Post('plant-assignments/:assignmentId/overrides')
  updateZoneOverride(@Param('assignmentId') id: string, @Body() dto: CreateZoneOverrideDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateZoneOverride(id, dto, user);
  }

  @Post('organizations/:organizationId/plant-assignments/:assignmentId/deactivate')
  deactivateZone(@Param('organizationId') organizationId: string, @Param('assignmentId') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.revokeAssignment(id, organizationId, user);
  }

  @Get('plant-assignments/:assignmentId/effective-config')
  effectiveConfig(@Param('assignmentId') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.effectiveZoneConfig(id, user);
  }
}
