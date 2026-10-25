import { randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { sha256Hex } from '../lib/crypto';

export const TOTP_ISSUER = 'Bravô Clinic';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Codes of the previous and next 30-second step are accepted too (clock drift). */
const WINDOW = 1;

// No 0/O/1/I: recovery codes are read from paper and typed by hand.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const RECOVERY_CODE_COUNT = 10;

function totpFor(secretBase32: string, label = ''): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** 20 random bytes as base32, the size authenticator apps expect. */
export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** `otpauth://totp/Bravô%20Clinic:<email>?secret=...&issuer=...` for the QR code. */
export function otpauthUri(secretBase32: string, email: string): string {
  return totpFor(secretBase32, email).toString();
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Checks a 6-digit code against the current 30-second step and its two neighbours. A step at or
 * before `lastUsedStep` is a replay and fails, so a code works once (FND-67, FND-68).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastUsedStep: number | null,
  now: Date,
): TotpResult {
  const totp = totpFor(secretBase32);
  const timestamp = now.getTime();
  const delta = totp.validate({ token: code, timestamp, window: WINDOW });
  if (delta === null) return { ok: false };
  const step = totp.counter({ timestamp }) + delta;
  if (lastUsedStep !== null && step <= lastUsedStep) return { ok: false };
  return { ok: true, step };
}

export function isRecoveryCode(code: string): boolean {
  return RECOVERY_CODE.test(code);
}

/** Recovery codes are stored as sha256 only (FND-70). */
export function hashRecoveryCode(code: string): string {
  return sha256Hex(code);
}

/** Ten distinct `XXXX-XXXX` codes. */
export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  const group = () =>
    Array.from({ length: 4 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join(
      '',
    );
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(`${group()}-${group()}`);
  return [...codes];
}
