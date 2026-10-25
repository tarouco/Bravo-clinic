import { describe, expect, it } from 'vitest';
import { EnvError, getEnv, parseEnv } from './env';

// 32 bytes of 0x01, base64-encoded.
const validKey = Buffer.alloc(32, 1).toString('base64');

function validSource(): Record<string, string | undefined> {
  return {
    DATABASE_URL: 'postgres://user:db-password-sentinel@db.example.com/bravo',
    SESSION_SECRET: 's'.repeat(32),
    ENCRYPTION_KEY: validKey,
    APP_BASE_URL: 'https://bravo.example.com',
    EMAIL_FROM: 'no-reply@bravo.example.com',
  };
}

function catchEnvError(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return error as EnvError;
  }
  throw new Error('parseEnv did not throw');
}

describe('parseEnv', () => {
  it('names the missing variable and never echoes provided values (FND-23)', () => {
    const source = validSource();
    delete source.SESSION_SECRET;

    const error = catchEnvError(source);

    expect(error.variables).toContain('SESSION_SECRET');
    expect(error.message).toContain('SESSION_SECRET');
    for (const value of Object.values(source)) {
      expect(error.message).not.toContain(value as string);
    }
  });

  it('rejects a 31-character SESSION_SECRET without echoing it', () => {
    const secret = 'x'.repeat(31);
    const error = catchEnvError({ ...validSource(), SESSION_SECRET: secret });

    expect(error.variables).toEqual(['SESSION_SECRET']);
    expect(error.message).not.toContain(secret);
  });

  it('rejects an ENCRYPTION_KEY that is not 32 bytes of base64', () => {
    const sixteenBytes = Buffer.alloc(16, 1).toString('base64');
    const thirtyThreeBytes = Buffer.alloc(33, 1).toString('base64');

    for (const key of [sixteenBytes, thirtyThreeBytes, 'not base64 at all!!', '']) {
      const error = catchEnvError({ ...validSource(), ENCRYPTION_KEY: key });
      expect(error.variables).toEqual(['ENCRYPTION_KEY']);
    }
  });

  it('rejects a non-URL APP_BASE_URL', () => {
    const error = catchEnvError({ ...validSource(), APP_BASE_URL: 'bravo.example.com' });

    expect(error.variables).toEqual(['APP_BASE_URL']);
  });

  it('rejects an invalid EMAIL_FROM', () => {
    const error = catchEnvError({ ...validSource(), EMAIL_FROM: 'not-an-email' });

    expect(error.variables).toEqual(['EMAIL_FROM']);
  });

  it('rejects a missing DATABASE_URL', () => {
    const source = validSource();
    delete source.DATABASE_URL;

    const error = catchEnvError(source);

    expect(error.variables).toEqual(['DATABASE_URL']);
  });

  it('lists every offending variable at once', () => {
    const error = catchEnvError({});

    expect([...error.variables].sort()).toEqual([
      'APP_BASE_URL',
      'DATABASE_URL',
      'EMAIL_FROM',
      'ENCRYPTION_KEY',
      'SESSION_SECRET',
    ]);
  });

  it('parses a valid env and leaves absent optional variables undefined', () => {
    const env = parseEnv(validSource());

    expect(env.DATABASE_URL).toBe('postgres://user:db-password-sentinel@db.example.com/bravo');
    expect(env.APP_BASE_URL).toBe('https://bravo.example.com');
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(env.NEON_BRANCH).toBeUndefined();
    expect(env.DATABASE_URL_UNPOOLED).toBeUndefined();
  });

  it('passes optional variables through when present', () => {
    const env = parseEnv({
      ...validSource(),
      RESEND_API_KEY: 're_123',
      GOOGLE_CLIENT_ID: 'gid',
      GOOGLE_CLIENT_SECRET: 'gsecret',
      NEON_BRANCH: 'dev',
    });

    expect(env.RESEND_API_KEY).toBe('re_123');
    expect(env.GOOGLE_CLIENT_ID).toBe('gid');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('gsecret');
    expect(env.NEON_BRANCH).toBe('dev');
  });
});

describe('getEnv', () => {
  it('parses process.env once and returns the memoized result', () => {
    const first = getEnv();
    const second = getEnv();

    expect(first).toBe(second);
    expect(first.APP_BASE_URL).toBe('http://localhost:5173');
  });
});
