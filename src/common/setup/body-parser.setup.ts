import express from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Configura o parser de requisições HTTP (Express) com limites seletivos:
 * - Rotas internas (/internal/): suportam corpos de até 10 MiB para permitir recepção de frames
 *   de evidência codificados em Base64 (máx. 5 MiB decodificado + overhead de transporte).
 * - Demais rotas (públicas/autenticadas de usuário): preservam o teto restritivo padrão de 100 KiB
 *   como defesa em profundidade contra ataques de esgotamento de memória (DDoS).
 */
export function configureBodyParsers(app: NestExpressApplication): void {
  const internalJsonParser = express.json({ limit: '10mb' });
  const defaultJsonParser = express.json({ limit: '100kb' });

  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const url = req.originalUrl || req.url || '';
      if (url.includes('/internal/')) {
        return internalJsonParser(req, res, next);
      }
      return defaultJsonParser(req, res, next);
    },
  );

  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
}
