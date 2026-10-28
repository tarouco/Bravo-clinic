import { deletionConfirmSchema } from '@bravo/core';
import { Hono } from 'hono';
import { clearSessionCookie } from '../../auth/session';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  deleteOwnAccount,
  exportUserData,
  listConsents,
} from '../../modules/privacy/privacy.service';
import type { AppEnv } from '../../types';

/** LGPD self-service of the session user (GES-121..GES-126, GES-128). */
export function privacyRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/me/consents', async (c) =>
    c.json(await listConsents(c.var.deps.db, c.get('auth').userId)),
  );

  app.get('/me/data-export', async (c) => {
    const { db, now } = c.var.deps;
    const exported = await exportUserData({ db }, actorContext(c), c.get('auth').userId, now());
    return c.json(exported.data, 200, {
      'Content-Disposition': `attachment; filename="${exported.fileName}"`,
      'Cache-Control': 'no-store',
    });
  });

  app.post('/me/deletion', validate('json', deletionConfirmSchema), async (c) => {
    await deleteOwnAccount(c.var.deps, actorContext(c), c.get('auth').userId, c.req.valid('json'));
    clearSessionCookie(c);
    return c.json({ deleted: true });
  });
  return app;
}
