import type { Db } from './db/client';
import type { Env } from './env';

/** Injectable dependencies of the app; tests replace what they need. */
export interface AppDeps {
  db: Db;
  now: () => Date;
  fetch: typeof fetch;
  env: Env;
}

/** Hono environment shared by every middleware and route of the API. */
export type AppEnv = {
  Variables: {
    requestId: string;
    deps: AppDeps;
    /** Set by the auth middleware once the caller is known; included in the request log line. */
    userId?: string;
  };
};
