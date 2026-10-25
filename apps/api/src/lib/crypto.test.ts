import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  randomToken,
  sha256Hex,
  verifyPassword,
} from './crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

describe('hashPassword / verifyPassword (FND-51)', () => {
  it('verifies the right password and starts with the scrypt parameter prefix', async () => {
    const hash = await hashPassword('Senha-Forte-123');

    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('Senha-Forte-123', hash)).toBe(true);
  });

  it('rejects another password', async () => {
    const hash = await hashPassword('Senha-Forte-123');

    expect(await verifyPassword('Outra-Senha-456', hash)).toBe(false);
  });

  it('salts: two hashes of the same password differ and both verify', async () => {
    const first = await hashPassword('Senha-Forte-123');
    const second = await hashPassword('Senha-Forte-123');

    expect(first).not.toBe(second);
    expect(await verifyPassword('Senha-Forte-123', second)).toBe(true);
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$a$b')).toBe(false);
  });
});

describe('encryptSecret / decryptSecret (FND-70)', () => {
  it('round-trips and the ciphertext differs from the plaintext', () => {
    const ciphertext = encryptSecret('JBSWY3DPEHPK3PXP', KEY);

    expect(ciphertext).not.toBe('JBSWY3DPEHPK3PXP');
    expect(ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(ciphertext, KEY)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh IV: the same plaintext encrypts differently each time', () => {
    expect(encryptSecret('JBSWY3DPEHPK3PXP', KEY)).not.toBe(encryptSecret('JBSWY3DPEHPK3PXP', KEY));
  });

  it('throws when the ciphertext was tampered with', () => {
    const bytes = Buffer.from(encryptSecret('JBSWY3DPEHPK3PXP', KEY), 'base64');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;

    expect(() => decryptSecret(bytes.toString('base64'), KEY)).toThrow();
  });

  it('throws when decrypting under another key', () => {
    const ciphertext = encryptSecret('JBSWY3DPEHPK3PXP', KEY);

    expect(() => decryptSecret(ciphertext, OTHER_KEY)).toThrow();
  });
});

describe('sha256Hex / randomToken (FND-51)', () => {
  it('hashes "abc" to the known SHA-256 digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('randomToken is 43 base64url characters and unique per call', () => {
    const token = randomToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });
});
