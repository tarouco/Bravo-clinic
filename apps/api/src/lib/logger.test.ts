import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, redact } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('redact', () => {
  it('replaces values of sensitive keys, at any depth and case, and keeps the rest (FND-27)', () => {
    const result = redact({
      password: 'a',
      nested: { token: 'b', Authorization: 'c' },
      code: '1',
      ok: 1,
    });

    expect(result).toEqual({
      password: '[redacted]',
      nested: { token: '[redacted]', Authorization: '[redacted]' },
      code: '[redacted]',
      ok: 1,
    });
  });

  it('redacts secret, cookie and pass-prefixed keys inside arrays without mutating the input', () => {
    const input = { items: [{ clientSecret: 'x', Cookie: 'y', passwordHash: 'z', name: 'n' }] };

    const result = redact(input);

    expect(result).toEqual({
      items: [
        { clientSecret: '[redacted]', Cookie: '[redacted]', passwordHash: '[redacted]', name: 'n' },
      ],
    });
    expect(input.items[0]?.clientSecret).toBe('x');
  });
});

describe('logger', () => {
  it('writes exactly one JSON line per call with level, msg and redacted fields', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.warn('something odd', { userId: 'u1', token: 'secret-token' });

    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]?.[0]);
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      level: 'warn',
      msg: 'something odd',
      userId: 'u1',
      token: '[redacted]',
    });
  });
});
