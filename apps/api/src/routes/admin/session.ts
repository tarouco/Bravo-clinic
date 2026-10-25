import { adminSectionsFor } from '@bravo/core';
import { Hono } from 'hono';
import type { AppEnv } from '../../types';

/** `GET /admin/session`: what the signed-in staff member may open (FND-74). */
export function adminSessionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/session', (c) => {
    const { role } = c.get('auth');
    return c.json({ role, sections: adminSectionsFor(role) });
  });
  return app;
}
