import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * PrismaModule — disponibiliza PrismaService globalmente para todos os módulos.
 *
 * Marcado como @Global para evitar importação repetida nos módulos de funcionalidade.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
