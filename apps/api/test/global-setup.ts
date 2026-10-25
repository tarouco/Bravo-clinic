import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/db/migrate';
import { assertNotProduction, requireTestDatabaseUrl } from './require-test-db';

const rootDir = fileURLToPath(new URL('../../..', import.meta.url));

/** Validates the test database once, then brings its schema up to date. */
export default async function setup(project: TestProject): Promise<void> {
  const testUrl = requireTestDatabaseUrl(project.config.env);
  // The workers see DATABASE_URL = DATABASE_URL_TEST; the real values come from the root .env or the shell.
  const rootEnv = loadEnv('test', rootDir, '');
  assertNotProduction(testUrl, {
    urls: [rootEnv.DATABASE_URL, rootEnv.DATABASE_URL_UNPOOLED],
    branchId: rootEnv.NEON_BRANCH_PRODUCTION,
  });
  await runMigrations(testUrl);
}
