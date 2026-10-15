import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ResearchAdminGuard } from './research-admin.guard.js';
import { ResearchController } from './research.controller.js';
import { ResearchGrantAdminGuard } from './research-grant-admin.guard.js';
import { ResearchGrantsController } from './research-grants.controller.js';
import { CrossrefMetadataProvider, OpenAlexMetadataProvider } from './research-metadata.providers.js';
import { ResearchGrantsService } from './research-grants.service.js';
import { ResearchService } from './research.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ResearchController, ResearchGrantsController],
  providers: [
    ResearchService,
    ResearchGrantsService,
    ResearchAdminGuard,
    ResearchGrantAdminGuard,
    CrossrefMetadataProvider,
    OpenAlexMetadataProvider,
  ],
})
export class ResearchModule {}
