import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { AppEnv } from '../types';
import { logger } from './logger';

export interface ErrorDetail {
  path: string;
  message: string;
}

/** Field errors (`path` + `message`) or an object with machine-readable context, e.g. `{ reason }`. */
export type ErrorDetails = ErrorDetail[] | Record<string, unknown>;

export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code = 'BAD_REQUEST', message = 'Requisição inválida') =>
  new AppError(400, code, message);

export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Não autenticado') =>
  new AppError(401, code, message);

export const forbidden = (code = 'FORBIDDEN', message = 'Acesso negado') =>
  new AppError(403, code, message);

export const notFound = (code = 'NOT_FOUND', message = 'Recurso não encontrado') =>
  new AppError(404, code, message);

export const conflict = (code = 'CONFLICT', message = 'Conflito com o estado atual do recurso') =>
  new AppError(409, code, message);

export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(
    429,
    'TOO_MANY_ATTEMPTS',
    'Muitas tentativas. Tente novamente em instantes.',
    undefined,
    { 'Retry-After': String(retryAfterSeconds) },
  );

/** 422 VALIDATION_FAILED from zod issues; `path` is the issue path joined by ".". */
export function validationFailed(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  return new AppError(
    422,
    'VALIDATION_FAILED',
    'Dados inválidos',
    issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
  );
}

/** The driver error inside `err`, looking through `cause` (drizzle wraps pg errors). */
function driverError(err: unknown): (Error & { code: string; constraint?: unknown }) | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return current as Error & { code: string; constraint?: unknown };
    }
    current = current.cause;
  }
  return undefined;
}

/** SQLSTATE of the driver error inside `err` (e.g. `23P01` exclusion violation). */
export function sqlStateOf(err: unknown): string | undefined {
  return driverError(err)?.code;
}

/** Name of the unique index/constraint a failed insert violated (SQLSTATE 23505), if any. */
export function uniqueViolationConstraint(err: unknown): string | undefined {
  const driver = driverError(err);
  if (driver?.code !== '23505') return undefined;
  return typeof driver.constraint === 'string' ? driver.constraint : undefined;
}

function envelope(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: ErrorDetails,
  headers?: Record<string, string>,
): Response {
  const body = {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      requestId: c.get('requestId'),
    },
  };
  return c.json(body, status, headers);
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) {
    return envelope(c, err.status, err.code, err.message, err.details, err.headers);
  }
  if (err instanceof ZodError) {
    const e = validationFailed(err.issues);
    return envelope(c, e.status, e.code, e.message, e.details);
  }
  if (err instanceof HTTPException && err.status === 400) {
    const e = badRequest();
    return envelope(c, e.status, e.code, e.message);
  }
  const state = sqlStateOf(err);
  if (state === '23P01') {
    return envelope(c, 409, 'SLOT_TAKEN', 'Este horário acabou de ser reservado.');
  }
  if (state === '23505') {
    return envelope(c, 409, 'CONFLICT', 'Conflito com o estado atual do recurso');
  }
  logger.error('unhandled error', {
    requestId: c.get('requestId'),
    error: { name: err.name, message: err.message, stack: err.stack },
  });
  return envelope(c, 500, 'INTERNAL', 'Erro interno');
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) => {
  const e = notFound();
  return envelope(c, e.status, e.code, e.message);
};
