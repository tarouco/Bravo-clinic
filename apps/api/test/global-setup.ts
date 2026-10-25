import type { TestProject } from 'vitest/node';
import { requireTestDatabaseUrl } from './require-test-db';

export default function setup(project: TestProject): void {
  requireTestDatabaseUrl(project.config.env);
}
