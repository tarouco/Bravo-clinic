import type { ZodType } from 'zod';

/**
 * Parses a fixture with its core contract schema and returns the parsed value. A fixture that
 * drifts from the contract throws at import time, so a contract change breaks the web tests
 * (AD-035).
 */
export function parseFixture<S extends ZodType>(
  schema: S,
  value: unknown,
  name: string,
): ReturnType<S['parse']> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Fixture "${name}" violates its contract schema: ${result.error.message}`);
  }
  return result.data as ReturnType<S['parse']>;
}
