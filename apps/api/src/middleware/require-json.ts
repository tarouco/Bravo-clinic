import type { MiddlewareHandler } from 'hono';
import { AppError } from '../lib/errors';
import type { AppEnv } from '../types';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Webhooks and jobs carry provider-defined bodies and validate them on their own.
const EXEMPT_PREFIXES = ['/webhooks/', '/jobs/'];
// Raw file uploads (AD-026); `readBinaryBody` checks their media type and size instead.
const BINARY_UPLOADS = [
  /^\/admin\/finance\/expenses\/[^/]+\/attachment$/,
  /^\/admin\/rooms\/[^/]+\/photo-uploads\/[^/]+\/[^/]+$/,
];

const isBinaryUpload = (method: string, path: string) =>
  method === 'PUT' && BINARY_UPLOADS.some((pattern) => pattern.test(path));

export function requireJson(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (
      MUTATING.has(c.req.method) &&
      !EXEMPT_PREFIXES.some((p) => c.req.path.startsWith(p)) &&
      !isBinaryUpload(c.req.method, c.req.path)
    ) {
      const mediaType = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type deve ser application/json');
      }
    }
    await next();
  };
}
