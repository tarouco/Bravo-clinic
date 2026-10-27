import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { settings } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

async function getConfig(env: Record<string, string | undefined> = {}) {
  const app = createApp({ db, env: testEnv(env), fetch: forbiddenFetch });
  return send(app, 'GET', '/public/config');
}

describe('GET /public/config: googleEnabled (FND-76, FND-134)', () => {
  it('is false without Google credentials', async () => {
    const result = await getConfig();

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ googleEnabled: false });
  });

  it('is true only when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set', async () => {
    const both = await getConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    const onlyId = await getConfig({ GOOGLE_CLIENT_ID: 'id' });

    expect(both.body).toMatchObject({ googleEnabled: true });
    expect(onlyId.body).toMatchObject({ googleEnabled: false });
  });
});

describe('GET /public/config: environment (FND-76)', () => {
  it('is production on the production branch and development anywhere else', async () => {
    const production = await getConfig({ NEON_BRANCH: 'production' });
    const dev = await getConfig({ NEON_BRANCH: 'dev' });
    const local = await getConfig();

    expect(production.body).toMatchObject({ environment: 'production' });
    expect(dev.body).toMatchObject({ environment: 'development' });
    expect(local.body).toMatchObject({ environment: 'development' });
  });
});

describe('GET /public/config: whatsappE164 (FND-76)', () => {
  it('returns the seeded clinic.whatsapp_e164 value and follows later edits', async () => {
    await runSeed(db);
    expect((await getConfig()).body).toEqual({
      googleEnabled: false,
      whatsappE164: '',
      environment: 'development',
      vapidPublicKey: null,
    });

    await db
      .update(settings)
      .set({ value: '+5547999990000' })
      .where(eq(settings.key, 'clinic.whatsapp_e164'));

    expect((await getConfig()).body).toMatchObject({ whatsappE164: '+5547999990000' });
  });

  it('falls back to the factory default when the settings table is not seeded yet', async () => {
    const result = await getConfig();

    expect(result.body).toMatchObject({ whatsappE164: '' });
  });
});
