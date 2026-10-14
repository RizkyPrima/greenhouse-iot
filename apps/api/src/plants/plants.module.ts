import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlantsController } from './plants.controller.js';
import { PlantsService } from './plants.service.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

@Module({
  imports: [PrismaModule],
  controllers: [PlantsController],
  providers: [PlantsService, PlatformAdminGuard],
})
export class PlantsModule {}
