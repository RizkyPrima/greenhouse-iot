import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DecisionManagerController } from './decision-manager.controller.js';
import { DecisionManagerService } from './decision-manager.service.js';

@Module({ imports: [PrismaModule], controllers: [DecisionManagerController], providers: [DecisionManagerService], exports: [DecisionManagerService] })
export class DecisionManagerModule {}
