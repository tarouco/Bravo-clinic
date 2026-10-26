import { isIP } from 'node:net';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppEnv } from '../types';
import { originFromPath, type RequestContext } from './audit';

const MAX_USER_AGENT_LENGTH = 500;

/** What services need to know about the HTTP request, without depending on Hono. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  /** Native path of the request, used to derive the audit origin. */
  path: string;
}

function validIp(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate !== undefined && candidate !== '' && isIP(candidate) !== 0 ? candidate : null;
}

/**
 * Client address as the proxy in front of the function reports it: Netlify's own header first,
 * then the first `X-Forwarded-For` hop. Anything that is not an IP is dropped, so the value is
 * safe for `inet` columns. Spoofing can only dodge the per-IP counters, never the per-account ones.
 */
export function clientIp(c: Context): string | null {
  return (
    validIp(c.req.header('X-Nf-Client-Connection-Ip')) ??
    validIp(c.req.header('X-Forwarded-For')?.split(',')[0])
  );
}

export function requestMeta(c: Context<AppEnv>): RequestMeta {
  const userAgent = c.req.header('User-Agent');
  return {
    ip: clientIp(c),
    userAgent: userAgent === undefined ? null : userAgent.slice(0, MAX_USER_AGENT_LENGTH),
    requestId: c.get('requestId'),
    path: c.req.path,
  };
}

/** Audit context for an action of `actor` (null for anonymous flows such as password reset). */
export function auditContext(
  meta: RequestMeta,
  actor: { id: string; role: string } | null,
): RequestContext {
  return {
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    origin: originFromPath(meta.path),
    ip: meta.ip,
    requestId: meta.requestId,
  };
}

/** Absolute URL on the public site, used in e-mail links and redirect URIs. */
export function appUrl(env: Pick<Env, 'APP_BASE_URL'>, path: string): string {
  return new URL(path, env.APP_BASE_URL).toString();
}

/** Audit context of the authenticated caller of a `/app` or `/admin` route. */
export function actorContext(c: Context<AppEnv>): RequestContext {
  const auth = c.get('auth');
  return auditContext(requestMeta(c), { id: auth.userId, role: auth.role });
}
