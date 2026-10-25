import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveScrypt(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, params, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** scrypt N=16384, r=8, p=1, 16-byte salt, 64-byte key; format `scrypt$N$r$p$salt$hash` (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveScrypt(password, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Constant-time check; a malformed stored value is simply "not equal". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every(Number.isInteger)) return false;
  const expected = Buffer.from(hash, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await deriveScrypt(password, Buffer.from(salt, 'base64'), params);
  return timingSafeEqual(actual, expected);
}

/** Random token as base64url (32 bytes give 43 characters). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** AES-256-GCM; output is `base64(iv | tag | ciphertext)`. `keyB64` is a 32-byte base64 key. */
export function encryptSecret(plaintext: string, keyB64: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Throws when the key is wrong or the ciphertext was altered (GCM authentication). */
export function decryptSecret(ciphertext: string, keyB64: string): string {
  const bytes = Buffer.from(ciphertext, 'base64');
  const iv = bytes.subarray(0, IV_LENGTH);
  const tag = bytes.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  decipher.setAuthTag(tag);
  const body = bytes.subarray(IV_LENGTH + TAG_LENGTH);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
