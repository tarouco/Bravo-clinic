/** Integration tests never skip silently: a missing test database is a hard failure. */
export function requireTestDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL_TEST;
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_TEST is required for integration tests');
  }
  return url;
}
