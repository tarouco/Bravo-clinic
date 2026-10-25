import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';
import { validationFailed } from '../lib/errors';

/** `validate('json' | 'query' | 'param', schema)`: failures become 422 VALIDATION_FAILED. */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) throw validationFailed(result.error.issues);
  });
}
