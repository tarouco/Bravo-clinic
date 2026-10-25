import { randomBytes } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types';

const INBOUND_ID = /^[A-Za-z0-9-]{8,64}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32, 26 chars. */
function newRequestId(): string {
  let time = Date.now();
  let encodedTime = '';
  for (let i = 0; i < 10; i++) {
    encodedTime = CROCKFORD[time % 32] + encodedTime;
    time = Math.floor(time / 32);
  }
  let encodedRandom = '';
  for (const byte of randomBytes(16)) encodedRandom += CROCKFORD[byte % 32];
  return encodedTime + encodedRandom;
}

export function requestContext(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const inbound = c.req.header('X-Request-Id');
    const requestId = inbound !== undefined && INBOUND_ID.test(inbound) ? inbound : newRequestId();
    const startedAt = performance.now();
    c.set('requestId', requestId);

    await next();

    c.header('X-Request-Id', requestId);
    const userId = c.get('userId');
    logger.info('request', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - startedAt),
      ...(userId !== undefined && { userId }),
    });
  };
}
