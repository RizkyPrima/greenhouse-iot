import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
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
  CreateDraftGrowthStageDto,
  ValidateProfileVersionDto,
  UpdateParameterDefinitionDto,
} from './dto/plant.dto.js';
import { PlantsService } from './plants.service.js';
import { PlantEvidenceService, PlantProposalsService } from './plant-evidence.service.js';
import { CreatePlantEvidenceDto, CreatePlantProposalDto, ReviewPlantEvidenceDto, ReviewPlantProposalDto } from './plant-evidence.dto.js';
import { CreatePlantRecommendationDto } from './plant-ai-recommendation.dto.js';
import { PlantAiRecommendationService } from './plant-ai-recommendation.service.js';
import { GeneratePlantSetupDto } from './plant-setup.dto.js';
import { PlantSetupService } from './plant-setup.service.js';
import { DevicePlantConfigurationService } from './device-plant-configuration.service.js';
import { ApplyDevicePlantConfigurationDto } from './device-plant-configuration.dto.js';

@ApiTags('Plant Standardization')
@ApiBearerAuth()
@Controller()
export class PlantsController {
  constructor(
    private readonly plants: PlantsService,
    private readonly evidence: PlantEvidenceService,
    private readonly proposals: PlantProposalsService,
    private readonly recommendations: PlantAiRecommendationService,
    private readonly plantSetup: PlantSetupService,
    private readonly deviceConfigurations: DevicePlantConfigurationService,
  ) {}

  @Post('organizations/:organizationId/plant-setups/generate')
  generatePlantSetup(@Param('organizationId') organizationId: string, @Body() dto: GeneratePlantSetupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plantSetup.generate(organizationId, dto, user);
  }

  @Get('organizations/:organizationId/plant-config-devices')
  listPlantConfigurationDevices(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.deviceConfigurations.listDevices(organizationId, user);
  }

  @Post('organizations/:organizationId/devices/:deviceId/plant-configurations')
  applyDevicePlantConfiguration(
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Body() dto: ApplyDevicePlantConfigurationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deviceConfigurations.apply(organizationId, deviceId, dto, user);
  }

  @Get('organizations/:organizationId/device-plant-configurations/:configurationId')
  getDevicePlantConfiguration(
    @Param('organizationId') organizationId: string,
    @Param('configurationId') configurationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deviceConfigurations.getDelivery(organizationId, configurationId, user);
  }

  @Post('organizations/:organizationId/scientific-evidence')
  createOrganizationEvidence(@Param('organizationId') organizationId: string, @Body() dto: CreatePlantEvidenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.evidence.createOrganizationEvidence(organizationId, dto.contract, user);
  }

  @Get('organizations/:organizationId/scientific-evidence')
  listOrganizationEvidence(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.evidence.listOrganizationEvidence(organizationId, user);
  }

  @Post('platform/scientific-evidence')
  createGlobalEvidence(@Body() dto: CreatePlantEvidenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.evidence.createGlobalEvidence(dto.contract, user);
  }

  @Get('scientific-evidence/:evidenceId')
  getEvidence(@Param('evidenceId') evidenceId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.evidence.getEvidence(evidenceId, user);
  }

  @Post('scientific-evidence/:evidenceId/verify')
  verifyEvidence(@Param('evidenceId') evidenceId: string, @Body() dto: ReviewPlantEvidenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.evidence.verifyEvidence(evidenceId, dto.reason, user);
  }

  @Post('organizations/:organizationId/plant-ai-proposals')
  createProposal(@Param('organizationId') organizationId: string, @Body() dto: CreatePlantProposalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.proposals.create(organizationId, dto.contract, user);
  }

  @Get('organizations/:organizationId/plant-ai-proposals')
  listProposals(@Param('organizationId') organizationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proposals.list(organizationId, user);
  }

  @Get('organizations/:organizationId/plant-ai-proposals/:proposalId')
  getProposal(@Param('organizationId') organizationId: string, @Param('proposalId') proposalId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proposals.get(organizationId, proposalId, user);
  }

  @Post('organizations/:organizationId/plant-ai-proposals/:proposalId/approve')
  approveProposal(@Param('organizationId') organizationId: string, @Param('proposalId') proposalId: string, @Body() dto: ReviewPlantProposalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.proposals.decide(organizationId, proposalId, true, dto.reason, user);
  }

  @Post('organizations/:organizationId/plant-ai-proposals/:proposalId/reject')
  rejectProposal(@Param('organizationId') organizationId: string, @Param('proposalId') proposalId: string, @Body() dto: ReviewPlantProposalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.proposals.decide(organizationId, proposalId, false, dto.reason, user);
  }

  @Post('organizations/:organizationId/plant-ai-proposals/:proposalId/apply')
  applyProposal(@Param('organizationId') organizationId: string, @Param('proposalId') proposalId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proposals.applyToDraft(organizationId, proposalId, user);
  }

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

  @Delete('organizations/:organizationId/plant-catalog/versions/:versionId')
  deleteCatalogVersion(@Param('organizationId') organizationId: string, @Param('versionId') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.deleteCatalogVersion(organizationId, id, user);
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

  @Post('organizations/:organizationId/plant-catalog/versions/:versionId/parameters/:parameterId/validate')
  validateCatalogParameter(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @Param('parameterId') parameterId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.validateCatalogParameter(organizationId, versionId, parameterId, user);
  }

  @Get('organizations/:organizationId/plant-catalog/versions/:versionId/parameter-validations')
  listCatalogParameterValidations(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.listCatalogParameterValidations(organizationId, versionId, user);
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

  @Get('platform-admin-grants')
  @UseGuards(PlatformAdminGuard)
  listPlatformGrants() {
    return this.plants.listPlatformGrants();
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

  @Post('organizations/:organizationId/plant-profiles/:profileId/recommendations')
  createRecommendation(
    @Param('organizationId') organizationId: string,
    @Param('profileId') profileId: string,
    @Body() dto: CreatePlantRecommendationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recommendations.recommend(organizationId, profileId, dto.profileVersionId, dto.growthStageId, user);
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
  createGrowthStage(@Param('organizationId') organizationId: string, @Param('versionId') versionId: string, @Body() dto: CreateDraftGrowthStageDto, @CurrentUser() user: AuthenticatedUser) {
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
  validateProfileVersion(@Param('organizationId') organizationId: string, @Param('versionId') id: string, @Body() dto: ValidateProfileVersionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.validateProfileVersion(organizationId, id, dto.expectedRevision, user);
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
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Opaque request key retained for safe replay' })
  activateZone(
    @Param('zoneId') zoneId: string,
    @Body() dto: ActivatePlantProfileDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plants.activateZone(zoneId, dto, idempotencyKey, user);
  }

  @Post('plant-assignments/:assignmentId/overrides')
  updateZoneOverride(@Param('assignmentId') id: string, @Body() dto: CreateZoneOverrideDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.updateZoneOverride(id, dto, user);
  }

  @Post('organizations/:organizationId/plant-assignments/:assignmentId/deactivate')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Opaque request key retained for safe replay' })
  deactivateZone(
    @Param('organizationId') organizationId: string,
    @Param('assignmentId') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plants.revokeAssignment(id, organizationId, idempotencyKey, user);
  }

  @Get('plant-assignments/:assignmentId/effective-config')
  effectiveConfig(@Param('assignmentId') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plants.effectiveZoneConfig(id, user);
  }
}
