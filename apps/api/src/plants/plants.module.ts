import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { MqttModule } from '../mqtt/mqtt.module.js';
import { PlantsController } from './plants.controller.js';
import { PlantsService } from './plants.service.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import { PlantEvidenceService, PlantProposalsService } from './plant-evidence.service.js';
import { PlantAiRecommendationService } from './plant-ai-recommendation.service.js';
import { PLANT_RECOMMENDATION_PROVIDER } from './plant-recommendation-provider.js';
import { OpenAiCompatibleRecommendationProvider } from './openai-compatible-recommendation.provider.js';
import { PlantSetupService } from './plant-setup.service.js';
import { DevicePlantConfigurationService } from './device-plant-configuration.service.js';

@Module({
  imports: [PrismaModule, MqttModule],
  controllers: [PlantsController],
  providers: [
    PlantsService, PlatformAdminGuard, PlantEvidenceService, PlantProposalsService, PlantAiRecommendationService, PlantSetupService, DevicePlantConfigurationService,
    OpenAiCompatibleRecommendationProvider,
    { provide: PLANT_RECOMMENDATION_PROVIDER, useExisting: OpenAiCompatibleRecommendationProvider },
  ],
  exports: [DevicePlantConfigurationService],
})
export class PlantsModule {}
