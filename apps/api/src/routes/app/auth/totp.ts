import { totpCodeSchema, totpDisableRequestSchema } from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requestMeta } from '../../../lib/request-meta';
import { validate } from '../../../middleware/validate';
import {
  confirmTotp,
  disableTotp,
  enrollTotp,
  verifyTotpCode,
} from '../../../modules/auth/totp.service';
import type { AppEnv } from '../../../types';

const codeBody = z.object({ code: totpCodeSchema });

/** Opt-in two-factor endpoints of every role under `/app/auth/totp/*` (FND-64..69, FND-135..136). */
export function totpRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/totp/enroll', async (c) => c.json(await enrollTotp(c.var.deps, c.get('auth'))));
  app.post('/totp/confirm', validate('json', codeBody), async (c) =>
    c.json(await confirmTotp(c.var.deps, c.get('auth'), c.req.valid('json').code, requestMeta(c))),
  );
  app.post('/totp/verify', validate('json', codeBody), async (c) => {
    await verifyTotpCode(c.var.deps, c.get('auth'), c.req.valid('json').code);
    return c.json({ ok: true });
  });
  app.post('/totp/disable', validate('json', totpDisableRequestSchema), async (c) =>
    c.json(await disableTotp(c.var.deps, c.get('auth'), c.req.valid('json').code, requestMeta(c))),
  );
  return app;
}
