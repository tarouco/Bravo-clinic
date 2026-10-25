import * as OTPAuth from 'otpauth';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../lib/crypto';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  isRecoveryCode,
  otpauthUri,
  verifyTotp,
} from './totp';

const SECRET = 'JBSWY3DPEHPK3PXP';
const NOW = new Date('2026-10-27T13:00:00Z');
const STEP_MS = 30_000;
const stepOf = (at: Date) => Math.floor(at.getTime() / STEP_MS);

/** Code for the step `offset` steps away from NOW, generated independently of the module under test. */
function codeAt(offset: number): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(SECRET),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp: NOW.getTime() + offset * STEP_MS });
}

describe('generateTotpSecret and otpauthUri (FND-64)', () => {
  it('returns a fresh 20-byte base32 secret each time', () => {
    const first = generateTotpSecret();
    const second = generateTotpSecret();

    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(second).not.toBe(first);
  });

  it('builds a URI with issuer "Bravô Clinic" and the e-mail as label', () => {
    const uri = otpauthUri(SECRET, 'ana@exemplo.com');

    expect(uri.startsWith('otpauth://totp/Brav%C3%B4%20Clinic:ana%40exemplo.com?')).toBe(true);
    const parsed = OTPAuth.URI.parse(uri) as OTPAuth.TOTP;
    expect(parsed.issuer).toBe('Bravô Clinic');
    expect(parsed.label).toBe('ana@exemplo.com');
    expect(parsed.secret.base32).toBe(SECRET);
    expect([parsed.algorithm, parsed.digits, parsed.period]).toEqual(['SHA1', 6, 30]);
  });
});

describe('verifyTotp (FND-67, FND-68)', () => {
  it('accepts the current step and returns its number', () => {
    expect(verifyTotp(SECRET, codeAt(0), null, NOW)).toEqual({ ok: true, step: stepOf(NOW) });
  });

  it('accepts the previous and the next step, not two steps away', () => {
    expect(verifyTotp(SECRET, codeAt(-1), null, NOW)).toEqual({ ok: true, step: stepOf(NOW) - 1 });
    expect(verifyTotp(SECRET, codeAt(1), null, NOW)).toEqual({ ok: true, step: stepOf(NOW) + 1 });
    expect(verifyTotp(SECRET, codeAt(-2), null, NOW)).toEqual({ ok: false });
    expect(verifyTotp(SECRET, codeAt(2), null, NOW)).toEqual({ ok: false });
  });

  it('rejects a step that was already used and anything before it', () => {
    const step = stepOf(NOW);

    expect(verifyTotp(SECRET, codeAt(0), step, NOW)).toEqual({ ok: false });
    expect(verifyTotp(SECRET, codeAt(-1), step, NOW)).toEqual({ ok: false });
    expect(verifyTotp(SECRET, codeAt(1), step, NOW)).toEqual({ ok: true, step: step + 1 });
  });

  it('rejects a wrong code', () => {
    const wrong = codeAt(0) === '000000' ? '000001' : '000000';

    expect(verifyTotp(SECRET, wrong, null, NOW)).toEqual({ ok: false });
  });
});

describe('recovery codes (FND-65, FND-70)', () => {
  it('generates ten distinct XXXX-XXXX codes without 0, O, 1 or I', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(isRecoveryCode(code)).toBe(true);
    }
  });

  it('hashes with sha256 and tells recovery codes from 6-digit codes', () => {
    expect(hashRecoveryCode('ABCD-2345')).toBe(sha256Hex('ABCD-2345'));
    expect(isRecoveryCode('123456')).toBe(false);
    expect(isRecoveryCode('ABCD2345')).toBe(false);
  });
});
