import type { JWTVerifyGetKey } from 'jose';
import type { AuthContext } from './auth/session';
import type { Db } from './db/client';
import type { Env } from './env';
import type { Registry } from './extensions/registry';

/** Injectable dependencies of the app; tests replace what they need. */
export interface AppDeps {
  db: Db;
  now: () => Date;
  fetch: typeof fetch;
  env: Env;
  /** Ports of the later features (AD-033); tests inject fakes. */
  registry: Registry;
  /** Google's signing keys; tests inject a local key set. Defaults to Google's remote JWKS. */
  googleJwks?: JWTVerifyGetKey;
}

/** Hono environment shared by every middleware and route of the API. */
export type AppEnv = {
  Variables: {
    requestId: string;
    deps: AppDeps;
    /** Set by the auth middleware once the caller is known; included in the request log line. */
    userId?: string;
    /** Set by `requireAuth`; always present behind it. */
    auth: AuthContext;
  };
};
