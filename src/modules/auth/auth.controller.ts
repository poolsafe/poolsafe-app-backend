import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { LogoutDto } from './dto/logout.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar conta de usuário e sessão inicial' })
  @ApiResponse({ status: 201, description: 'Conta criada com sucesso e tokens emitidos.' })
  @ApiResponse({ status: 409, description: 'Conflito de e-mail existente.' })
  @ApiResponse({ status: 422, description: 'Erro de validação nos dados fornecidos.' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.authService.register(dto, requestId);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autenticar com e-mail e senha' })
  @ApiResponse({ status: 200, description: 'Autenticado com sucesso.' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas.' })
  @ApiResponse({ status: 422, description: 'Erro de validação.' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.authService.login(dto, requestId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotacionar par de access/refresh tokens' })
  @ApiResponse({ status: 200, description: 'Tokens rotacionados com sucesso.' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido, expirado ou reutilizado.' })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    return this.authService.refresh(dto, requestId);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerrar sessão ativa' })
  @ApiResponse({ status: 204, description: 'Sessão revogada com sucesso.' })
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto);
  }
}
