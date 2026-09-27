import {
  Controller,
  Get,
  Patch,
  Put,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import { UsersService } from './users.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdatePasswordDto } from './dto/update-password.dto.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Consultar perfil do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Perfil retornado com sucesso.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  getProfile(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.usersService.getProfile(user, requestId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Atualizar nome do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Perfil atualizado com sucesso.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  @ApiResponse({ status: 422, description: 'Dados de validação incorretos ou campos desconhecidos.' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @Req() req: Request,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.usersService.updateProfile(user.id, dto, requestId);
  }

  @Put('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Alterar senha do usuário autenticado' })
  @ApiResponse({ status: 204, description: 'Senha alterada com sucesso; outras sessões revogadas.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  @ApiResponse({ status: 403, description: 'Senha atual incorreta (REAUTHENTICATION_FAILED).' })
  @ApiResponse({ status: 422, description: 'Dados de validação incorretos.' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePasswordDto,
  ): Promise<void> {
    await this.usersService.changePassword(user.id, user.sessionId, dto);
  }
}
