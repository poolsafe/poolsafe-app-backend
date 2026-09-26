import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { HashService } from './hash.service.js';
import { TokenService } from './token.service.js';
import { SessionService } from './session.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    HashService,
    TokenService,
    SessionService,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    HashService,
    TokenService,
    SessionService,
    JwtAuthGuard,
  ],
})
export class AuthModule {}
