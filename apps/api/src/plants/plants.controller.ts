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

  @Get('plant-catalog')
  listCatalog() {
    return this.plants.listCatalog();
  }

  @Get('plant-catalog/admin')
  @UseGuards(PlatformAdminGuard)
  listCatalogForAdmin() {
    return this.plants.listCatalogForAdmin();
  }

  @Get('plant-catalog/admin/:catalogId')
  @UseGuards(PlatformAdminGuard)
  getCatalogForAdmin(@Param('catalogId') catalogId: string) {
    return this.plants.getCatalogForAdmin(catalogId);
  }

  @Get('plant-catalog/:catalogId')
  getCatalog(@Param('catalogId') catalogId: string) {
    return this.plants.getCatalog(catalogId);
  }

  @Post('plant-catalog')
  @UseGuards(PlatformAdminGuard)
  createCatalog(@Body() dto: CreatePlantCatalogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createCatalog(dto, user);
  }

  @Post('plant-catalog/:catalogId/versions')
  @UseGuards(PlatformAdminGuard)
  createCatalogVersion(@Param('catalogId') id: string, @Body() dto: CreateCatalogVersionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createCatalogVersion(id, dto, user);
  }

  @Patch('plant-catalog/versions/:versionId/draft')
  @UseGuards(PlatformAdminGuard)
  updateCatalogVersion(@Param('versionId') id: string, @Body() dto: UpdateCatalogVersionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateCatalogVersion(id, dto, user);
  }

  @Post('plant-catalog/versions/:versionId/parameters')
  @UseGuards(PlatformAdminGuard)
  createParameter(@Param('versionId') id: string, @Body() dto: CreateParameterDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.createParameterDefinition(id, dto, user);
  }

  @Patch('plant-catalog/versions/:versionId/parameters/:parameterId')
  @UseGuards(PlatformAdminGuard)
  updateParameter(@Param('versionId') versionId: string, @Param('parameterId') parameterId: string, @Body() dto: UpdateParameterDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateParameterDefinition(versionId, parameterId, dto, user);
  }

  @Delete('plant-catalog/versions/:versionId/parameters/:parameterId')
  @UseGuards(PlatformAdminGuard)
  deleteParameter(@Param('versionId') versionId: string, @Param('parameterId') parameterId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.deleteParameterDefinition(versionId, parameterId, user);
  }

  @Post('plant-catalog/versions/:versionId/publish')
  @UseGuards(PlatformAdminGuard)
  publishCatalogVersion(@Param('versionId') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.publishCatalogVersion(id, user);
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
