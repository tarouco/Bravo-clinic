import { describe, expect, it } from 'vitest';
import { formatDocument, parseDocument } from './document';

describe('parseDocument (FND-14, FND-15)', () => {
  it('parses a masked CPF', () => {
    expect(parseDocument('529.982.247-25')).toEqual({ type: 'cpf', digits: '52998224725' });
  });

  it('parses a masked CNPJ', () => {
    expect(parseDocument('11.222.333/0001-81')).toEqual({
      type: 'cnpj',
      digits: '11222333000181',
    });
  });

  it('accepts unmasked digits', () => {
    expect(parseDocument('52998224725')).toEqual({ type: 'cpf', digits: '52998224725' });
    expect(parseDocument('11222333000181')).toEqual({ type: 'cnpj', digits: '11222333000181' });
  });
});

describe('parseDocument rejections (FND-16)', () => {
  it.each([
    ['all-equal CPF digits', '111.111.111-11'],
    ['wrong CPF check digit', '529.982.247-24'],
    ['wrong CNPJ check digit', '11.222.333/0001-80'],
    ['10 digits', '1234567890'],
    ['empty string', ''],
    ['all-equal CNPJ digits', '00.000.000/0000-00'],
  ])('returns null for %s', (_label, input) => {
    expect(parseDocument(input)).toBeNull();
  });
});

describe('formatDocument', () => {
  it('formats a CPF as 529.982.247-25 and round-trips', () => {
    const doc = parseDocument('529.982.247-25');
    expect(doc).not.toBeNull();
    if (doc) {
      expect(formatDocument(doc)).toBe('529.982.247-25');
      expect(parseDocument(formatDocument(doc))).toEqual(doc);
    }
  });

  it('formats a CNPJ as 11.222.333/0001-81 and round-trips', () => {
    const doc = parseDocument('11222333000181');
    expect(doc).not.toBeNull();
    if (doc) {
      expect(formatDocument(doc)).toBe('11.222.333/0001-81');
      expect(parseDocument(formatDocument(doc))).toEqual(doc);
    }
  });
});
