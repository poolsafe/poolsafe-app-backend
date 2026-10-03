import { Module } from '@nestjs/common';
import { MonitoringsController } from './monitorings.controller.js';
import { MonitoringsService } from './monitorings.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [MonitoringsController],
  providers: [MonitoringsService],
  exports: [MonitoringsService],
})
export class MonitoringsModule {}
