import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createPrivateKey, createPublicKey } from 'node:crypto';
import { AuthenticationRequiredException } from '../../common/errors/problem-details.exception.js';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface GeneratedToken {
  accessToken: string;
  accessExpiresAt: Date;
}

/**
 * TokenService — Emissão e validação estrita de Access Tokens JWT com algoritmo RS256.
 *
 * Requisitos:
 * - Validade: 15 minutos
 * - Assinatura: RS256 assimétrica fixa
 * - Claims: iss, aud ('poolsafe-app'), sub (userId string), sid (sessionId string), jti, iat, exp
 * - Chaves carregadas de Base64 em variáveis de ambiente
 * - Não registra tokens nos logs
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKeyPem!: string;
  private publicKeyPem!: string;
  private issuer!: string;
  private readonly audience = 'poolsafe-app';
  private readonly expiresInSeconds = 15 * 60; // 15 minutos

  constructor(private readonly jwtService: JwtService) {}

  onModuleInit(): void {
    this.loadAndValidateKeys();
  }

  private loadAndValidateKeys(): void {
    const rawPriv = process.env['JWT_PRIVATE_KEY_BASE64'];
    const rawPub = process.env['JWT_PUBLIC_KEY_BASE64'];
    this.issuer = process.env['JWT_ISSUER'] || 'poolsafe-api';

    if (!rawPriv || !rawPub) {
      throw new Error(
        'Configuração JWT obrigatória ausente: JWT_PRIVATE_KEY_BASE64 e JWT_PUBLIC_KEY_BASE64 devem estar definidas no ambiente.',
      );
    }

    try {
      this.privateKeyPem = rawPriv.includes('-----BEGIN')
        ? rawPriv
        : Buffer.from(rawPriv, 'base64').toString('utf8');
      createPrivateKey(this.privateKeyPem);
    } catch (err) {
      throw new Error(
        `Configuração JWT inválida: JWT_PRIVATE_KEY_BASE64 não pôde ser decodificada como chave RSA privada válida: ${(err as Error).message}`,
      );
    }

    try {
      this.publicKeyPem = rawPub.includes('-----BEGIN')
        ? rawPub
        : Buffer.from(rawPub, 'base64').toString('utf8');
      createPublicKey(this.publicKeyPem);
    } catch (err) {
      throw new Error(
        `Configuração JWT inválida: JWT_PUBLIC_KEY_BASE64 não pôde ser decodificada como chave RSA pública válida: ${(err as Error).message}`,
      );
    }

    this.logger.log('Chaves RSA carregadas e validadas com sucesso para RS256.');
  }

  /**
   * Emite um novo Access Token JWT com validade de 15 minutos.
   */
  generateAccessToken(userId: string, sessionId: string): GeneratedToken {
    const now = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = now + this.expiresInSeconds;
    const jti = randomUUID();

    const payload = {
      sub: userId,
      sid: sessionId,
      jti,
    };

    const accessToken = this.jwtService.sign(payload, {
      algorithm: 'RS256',
      privateKey: this.privateKeyPem,
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: this.expiresInSeconds,
    });

    return {
      accessToken,
      accessExpiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  /**
   * Valida estritamente a assinatura, algoritmo, expiração, issuer, audience e claims mínimas.
   * Lança AuthenticationRequiredException caso a validação falhe.
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = this.jwtService.verify<AccessTokenPayload>(token, {
        algorithms: ['RS256'],
        publicKey: this.publicKeyPem,
        issuer: this.issuer,
        audience: this.audience,
      });

      if (!decoded.sub || !decoded.sid || !decoded.jti) {
        throw new AuthenticationRequiredException('Token inválido: claims obrigatórias ausentes.');
      }

      return decoded;
    } catch (err) {
      if (err instanceof AuthenticationRequiredException) {
        throw err;
      }
      throw new AuthenticationRequiredException('Token de acesso inválido ou expirado.');
    }
  }
}
