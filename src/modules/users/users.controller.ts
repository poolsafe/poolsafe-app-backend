import {
  Controller,
  Get,
  Post,
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
import { RegisterManifestationsDto } from './dto/register-manifestations.dto.js';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Consultar perfil do usuário autenticado',
    description:
      'Retorna identificação, telefone e situação atualizada das manifestações de Termos de Uso, Aviso de Privacidade e autorização de contato.',
  })
  @ApiResponse({ status: 200, description: 'Perfil retornado com sucesso.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  getProfile(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.usersService.getProfile(user.id, requestId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Atualizar perfil do usuário autenticado',
    description:
      'Permite atualizar o nome, atualizar ou remover o telefone e gerenciar a autorização específica de contato. Preserva campos omitidos.',
  })
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

  @Post('me/manifestations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar aceite e ciência para contas existentes',
    description:
      'Operação autenticada e idempotente para contas existentes registrarem aceite dos Termos de Uso e ciência do Aviso de Privacidade, preservando o horário original.',
  })
  @ApiResponse({ status: 200, description: 'Manifestações registradas com sucesso.' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou sessão revogada/expirada.' })
  @ApiResponse({ status: 422, description: 'Versão inválida ou desatualizada.' })
  registerManifestations(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterManifestationsDto,
    @Req() req: Request,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.usersService.registerManifestations(user.id, dto, requestId);
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
