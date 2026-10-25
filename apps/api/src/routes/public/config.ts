import { parseSetting, settingDefaults } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { settings } from '../../db/schema';
import type { AppEnv } from '../../types';

const WHATSAPP_KEY = 'clinic.whatsapp_e164';

/** `GET /public/config`: switches the web app needs before anyone signs in (FND-76, FND-134). */
export function configRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/config', async (c) => {
    const { db, env } = c.var.deps;
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, WHATSAPP_KEY));
    return c.json({
      googleEnabled: env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined,
      whatsappE164:
        row === undefined ? settingDefaults()[WHATSAPP_KEY] : parseSetting(WHATSAPP_KEY, row.value),
      environment: env.NEON_BRANCH === 'production' ? 'production' : 'development',
    });
  });
  return app;
}
