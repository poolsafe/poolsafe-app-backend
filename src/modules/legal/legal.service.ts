import { Injectable } from '@nestjs/common';
import { ResourceNotFoundException } from '../../common/errors/problem-details.exception.js';
import {
  LEGAL_DOCUMENT_IDS,
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  LegalDocumentMetadata,
  LegalDocumentResponse,
} from './legal.constants.js';
import { TERMS_OF_USE_V1_0 } from './content/termos-de-uso.v1_0.js';
import { PRIVACY_NOTICE_V1_0 } from './content/aviso-de-privacidade.v1_0.js';

interface StoredDocument {
  id: string;
  title: string;
  versions: Record<string, { updatedAt: string; content: string }>;
  currentVersion: string;
}

const DOCUMENTS_REGISTRY: Record<string, StoredDocument> = {
  [LEGAL_DOCUMENT_IDS.TERMS]: {
    id: LEGAL_DOCUMENT_IDS.TERMS,
    title: 'Termos de Uso',
    currentVersion: CURRENT_TERMS_VERSION,
    versions: {
      '1.0': {
        updatedAt: '2026-10-18T00:00:00.000Z',
        content: TERMS_OF_USE_V1_0,
      },
    },
  },
  [LEGAL_DOCUMENT_IDS.PRIVACY]: {
    id: LEGAL_DOCUMENT_IDS.PRIVACY,
    title: 'Aviso de Privacidade',
    currentVersion: CURRENT_PRIVACY_VERSION,
    versions: {
      '1.0': {
        updatedAt: '2026-10-18T00:00:00.000Z',
        content: PRIVACY_NOTICE_V1_0,
      },
    },
  },
};

@Injectable()
export class LegalService {
  /**
   * Retorna os metadados de todos os documentos legais atualmente vigentes.
   */
  getDocuments(): LegalDocumentMetadata[] {
    return Object.values(DOCUMENTS_REGISTRY).map((doc) => {
      const versionData = doc.versions[doc.currentVersion]!;
      return {
        id: doc.id,
        title: doc.title,
        version: doc.currentVersion,
        updatedAt: versionData.updatedAt,
      };
    });
  }

  /**
   * Obtém o conteúdo e metadados de um documento legal por identificador e versão opcional.
   */
  getDocumentById(id: string, requestedVersion?: string): LegalDocumentResponse {
    const doc = DOCUMENTS_REGISTRY[id];
    if (!doc) {
      throw new ResourceNotFoundException('Documento legal não encontrado.');
    }

    const version = requestedVersion ?? doc.currentVersion;
    const versionData = doc.versions[version];
    if (!versionData) {
      throw new ResourceNotFoundException(
        `Versão "${version}" não encontrada para o documento "${id}".`,
      );
    }

    return {
      id: doc.id,
      title: doc.title,
      version,
      updatedAt: versionData.updatedAt,
      content: versionData.content,
    };
  }

  /**
   * Valida se a versão dos Termos de Uso informada corresponde à versão ativa.
   */
  isValidTermsVersion(version: string): boolean {
    return version === CURRENT_TERMS_VERSION;
  }

  /**
   * Valida se a versão do Aviso de Privacidade informada corresponde à versão ativa.
   */
  isValidPrivacyVersion(version: string): boolean {
    return version === CURRENT_PRIVACY_VERSION;
  }
}
