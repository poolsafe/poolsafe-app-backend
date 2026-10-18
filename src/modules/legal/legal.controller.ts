import {
  Controller,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { LegalService } from './legal.service.js';

@ApiTags('Legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get('documents')
  @ApiOperation({
    summary: 'Listar metadados dos documentos legais vigentes',
    description:
      'Disponibiliza consulta pública dos documentos de Termos de Uso e Aviso de Privacidade antes e após o cadastro.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de metadados retornada com sucesso.',
  })
  getDocuments(@Req() req: Request) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const documents = this.legalService.getDocuments();
    return {
      data: documents,
      meta: { requestId },
    };
  }

  @Get('documents/:id')
  @ApiOperation({
    summary: 'Consultar conteúdo completo de documento legal versionado',
    description:
      'Retorna o texto aprovado, versão e data de atualização para leitura no aplicativo antes ou depois do cadastro.',
  })
  @ApiParam({
    name: 'id',
    description: 'Identificador do documento (ex: termos-de-uso, aviso-de-privacidade)',
    example: 'termos-de-uso',
  })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Versão específica do documento. Se omitido, retorna a versão vigente.',
    example: '1.0',
  })
  @ApiResponse({
    status: 200,
    description: 'Documento retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Documento ou versão não encontrada (RESOURCE_NOT_FOUND).',
  })
  getDocumentById(
    @Param('id') id: string,
    @Query('version') version: string | undefined,
    @Req() req: Request,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const document = this.legalService.getDocumentById(id, version);
    return {
      data: document,
      meta: { requestId },
    };
  }
}
