/**
 * Constantes e identificadores dos documentos legais versionados do PoolSafe.
 */
export const LEGAL_DOCUMENT_IDS = {
  TERMS: 'termos-de-uso',
  PRIVACY: 'aviso-de-privacidade',
} as const;

export type LegalDocumentId =
  (typeof LEGAL_DOCUMENT_IDS)[keyof typeof LEGAL_DOCUMENT_IDS];

export const CURRENT_TERMS_VERSION = '1.0';
export const CURRENT_PRIVACY_VERSION = '1.0';
export const CURRENT_PHONE_CONTACT_VERSION = '1.0';

export interface LegalDocumentMetadata {
  id: string;
  title: string;
  version: string;
  updatedAt: string;
}

export interface LegalDocumentResponse extends LegalDocumentMetadata {
  content: string;
}
