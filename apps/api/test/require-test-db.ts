/** Integration tests never skip silently: a missing test database is a hard failure. */
export function requireTestDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL_TEST;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_TEST is required for integration tests');
  }
  return url;
}

/** Host and database of a connection string; the Neon pooler suffix is ignored. */
function databaseIdentity(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname.replace('-pooler', '')}${parsed.pathname}`;
}

export interface ProductionTargets {
  /** `DATABASE_URL` and `DATABASE_URL_UNPOOLED` from the root `.env` or the shell. */
  urls: (string | undefined)[];
  /** `NEON_BRANCH_PRODUCTION`: the id of the production branch. */
  branchId?: string | undefined;
}

/** AD-018: the harness truncates every table, so it must never point at production. */
export function assertNotProduction(testUrl: string, production: ProductionTargets): void {
  const identity = databaseIdentity(testUrl);
  for (const url of production.urls) {
    if (url !== undefined && url !== '' && databaseIdentity(url) === identity) {
      throw new Error('DATABASE_URL_TEST points at the production database; refusing to run');
    }
  }
  const branchId = production.branchId;
  if (branchId !== undefined && branchId !== '' && testUrl.includes(branchId)) {
    throw new Error('DATABASE_URL_TEST targets the production branch; refusing to run');
  }
}
