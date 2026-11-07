import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard.js';
import { CamerasController } from './cameras.controller.js';
import { CamerasService } from './cameras.service.js';
import { InternalCamerasController } from './internal-cameras.controller.js';
import { InternalCamerasService } from './internal-cameras.service.js';
import { CameraHeartbeatValidationPipe } from './dto/camera-heartbeat.dto.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CamerasController, InternalCamerasController],
  providers: [
    CamerasService,
    InternalCamerasService,
    InternalServiceGuard,
    CameraHeartbeatValidationPipe,
  ],
  exports: [CamerasService, InternalCamerasService],
})
export class CamerasModule {}
