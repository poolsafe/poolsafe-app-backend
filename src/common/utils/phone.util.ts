/**
 * Utilitários de validação e normalização de telefone brasileiro (E.164).
 */

const VALID_DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

/**
 * Remove todos os caracteres não-dígitos e eventual prefixo DDI +55.
 */
export function extractBrazilianDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits;
}

/**
 * Valida se um número informado é um telefone brasileiro válido com DDD.
 * Aceita números com 10 dígitos (fixo: DDD + 8 dígitos) ou 11 dígitos (móvel: DDD + 9 dígitos iniciado em 9).
 */
export function validateBrazilianPhone(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') {
    return false;
  }
  const digits = extractBrazilianDigits(raw);

  // Deve ter exatamente 10 ou 11 dígitos
  if (digits.length !== 10 && digits.length !== 11) {
    return false;
  }

  const ddd = digits.slice(0, 2);
  if (!VALID_DDDS.has(ddd)) {
    return false;
  }

  const numberPart = digits.slice(2);
  if (digits.length === 11) {
    // Celular: deve começar com 9
    return numberPart.startsWith('9');
  }

  // Fixo: deve começar com dígitos entre 2 e 5
  const firstDigit = numberPart[0];
  return firstDigit !== undefined && ['2', '3', '4', '5'].includes(firstDigit);
}

/**
 * Normaliza o telefone para o formato internacional E.164 (+55XXXXXXXXXXX).
 * Se o telefone for inválido, lança erro ou retorna null.
 */
export function normalizeBrazilianPhone(raw: string): string {
  const digits = extractBrazilianDigits(raw);
  if (!validateBrazilianPhone(raw)) {
    throw new Error('Telefone brasileiro inválido para normalização.');
  }
  return `+55${digits}`;
}
