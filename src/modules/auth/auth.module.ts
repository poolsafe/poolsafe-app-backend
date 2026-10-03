import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { HashService } from './hash.service.js';
import { TokenService } from './token.service.js';
import { SessionService } from './session.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordResetRateLimiter } from './password-reset-rate-limiter.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [JwtModule.register({}), EmailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    HashService,
    TokenService,
    SessionService,
    PasswordResetService,
    PasswordResetRateLimiter,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    HashService,
    TokenService,
    SessionService,
    PasswordResetService,
    PasswordResetRateLimiter,
    JwtAuthGuard,
  ],
})
export class AuthModule {}
