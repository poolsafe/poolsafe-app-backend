import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { InternalAlertsController } from './internal-alerts.controller.js';
import { InternalAlertsService } from './internal-alerts.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AlertsController, InternalAlertsController],
  providers: [AlertsService, InternalAlertsService, InternalServiceGuard],
  exports: [AlertsService, InternalAlertsService],
})
export class AlertsModule {}
