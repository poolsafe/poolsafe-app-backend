import {
  Controller,
  Get,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { HomeService } from './home.service.js';
import type { HomeResponse } from './dto/home-response.dto.js';

@ApiTags('Home')
@ApiBearerAuth()
@Controller('home')
@UseGuards(JwtAuthGuard)
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get()
  @ApiOperation({ summary: 'Obter resumo operacional consolidado do painel (Home)' })
  @ApiResponse({ status: 200, description: 'Resumo retornado com sucesso.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  getHomeSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<HomeResponse> {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.homeService.getHomeSummary(user.id, requestId);
  }
}
