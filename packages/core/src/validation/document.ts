export type DocumentType = 'cpf' | 'cnpj';

export interface ParsedDocument {
  type: DocumentType;
  digits: string;
}

function toDigits(digits: string): number[] {
  return Array.from(digits, Number);
}

function isAllEqual(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

function checkDigit(values: number[], weights: number[]): number {
  let sum = 0;
  for (const [i, weight] of weights.entries()) sum += (values[i] ?? 0) * weight;
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function isValidCpf(digits: string): boolean {
  const v = toDigits(digits);
  const first = checkDigit(v, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(v, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return v[9] === first && v[10] === second;
}

function isValidCnpj(digits: string): boolean {
  const v = toDigits(digits);
  const first = checkDigit(v, CNPJ_WEIGHTS_1);
  const second = checkDigit(v, CNPJ_WEIGHTS_2);
  return v[12] === first && v[13] === second;
}

/**
 * Strips every non-digit, then validates a CPF (11 digits) or CNPJ (14 digits) by check digits.
 * Returns null for any other length, all-equal digits or a wrong check digit.
 */
export function parseDocument(input: string): ParsedDocument | null {
  const digits = input.replace(/\D/g, '');
  if (isAllEqual(digits)) return null;
  if (digits.length === 11 && isValidCpf(digits)) return { type: 'cpf', digits };
  if (digits.length === 14 && isValidCnpj(digits)) return { type: 'cnpj', digits };
  return null;
}

/** "52998224725" -> "529.982.247-25"; "11222333000181" -> "11.222.333/0001-81". */
export function formatDocument(doc: ParsedDocument): string {
  const d = doc.digits;
  if (doc.type === 'cpf') {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}
