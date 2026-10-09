import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { DevicesService } from './devices.service.js';
import { UpsertDeviceDto } from './dto/upsert-device.dto.js';
import { InstallationIdPipe } from './pipes/installation-id.pipe.js';

/**
 * Endpoints de instalação e FCM Token (docs/api-contract.md Seção 13).
 * As respostas jamais incluem o FCM Token e usam `Cache-Control: private, no-store`.
 */
@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Put(':installationId')
  @ApiOperation({ summary: 'Registrar ou atualizar a instalação e seu FCM Token (idempotente)' })
  @ApiResponse({ status: 201, description: 'Nova instalação registrada.' })
  @ApiResponse({ status: 200, description: 'Instalação atualizada de forma idempotente.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  @ApiResponse({ status: 422, description: 'installationId, plataforma ou token inválidos.' })
  async upsert(
    @Param('installationId', InstallationIdPipe) installationId: string,
    @Body() dto: UpsertDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const result = await this.devicesService.register(user, installationId, dto, requestId);

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.response;
  }

  @Delete(':installationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Invalidar a instalação do usuário autenticado (idempotente)' })
  @ApiResponse({ status: 204, description: 'Instalação invalidada (ou já inexistente/inválida).' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  @ApiResponse({ status: 422, description: 'installationId inválido.' })
  async remove(
    @Param('installationId', InstallationIdPipe) installationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'private, no-store');
    await this.devicesService.invalidate(user, installationId);
  }
}
