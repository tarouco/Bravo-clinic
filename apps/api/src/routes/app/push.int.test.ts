import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { pushSubscriptions } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-27T12:00:00.000Z');

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = (env: Record<string, string | undefined> = {}) =>
  createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv(env) });

// Shapes of `PushSubscription.toJSON()` (base64url keys, https endpoint).
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const subscription = {
  endpoint: ENDPOINT,
  keys: {
    p256dh:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
  expirationTime: null,
};

async function tenant(email: string) {
  const user = await createUser(db, { email });
  return { user, cookie: await loginAs(db, user, { now: NOW }) };
}

const rows = () => db.select().from(pushSubscriptions);

describe('POST /app/push/subscriptions (GES-76)', () => {
  it('stores the subscription for the user and answers 201', async () => {
    const { user, cookie } = await tenant('ana@bravoclinic.test');

    const res = await send(buildApp(), 'POST', '/app/push/subscriptions', {
      cookie,
      body: subscription,
      headers: { 'User-Agent': 'Mozilla/5.0 Test' },
    });

    expect(res.status).toBe(201);
    expect(
      (await rows()).map((r) => [r.userId, r.endpoint, r.p256dh, r.auth, r.userAgent]),
    ).toEqual([
      [user.id, ENDPOINT, subscription.keys.p256dh, subscription.keys.auth, 'Mozilla/5.0 Test'],
    ]);
  });

  it('upserts by endpoint and reassigns an endpoint owned by another user', async () => {
    const a = await tenant('ana@bravoclinic.test');
    const b = await tenant('bia@bravoclinic.test');
    await send(buildApp(), 'POST', '/app/push/subscriptions', {
      cookie: a.cookie,
      body: subscription,
    });
    await db.update(pushSubscriptions).set({ failureCount: 3 });

    const again = await send(buildApp(), 'POST', '/app/push/subscriptions', {
      cookie: a.cookie,
      body: subscription,
    });
    expect(again.status).toBe(201);
    expect(await rows()).toHaveLength(1);

    const moved = await send(buildApp(), 'POST', '/app/push/subscriptions', {
      cookie: b.cookie,
      body: { ...subscription, keys: { ...subscription.keys, auth: 'newAuthSecret_-12' } },
    });

    expect(moved.status).toBe(201);
    const all = await rows();
    expect(all.map((r) => [r.userId, r.endpoint, r.auth, r.failureCount])).toEqual([
      [b.user.id, ENDPOINT, 'newAuthSecret_-12', 0],
    ]);
  });

  it('answers 422 for an http:// endpoint or keys that are not base64url', async () => {
    const { cookie } = await tenant('ana@bravoclinic.test');
    const app = buildApp();

    const http = await send(app, 'POST', '/app/push/subscriptions', {
      cookie,
      body: { ...subscription, endpoint: 'http://push.example/abc' },
    });
    const badKey = await send(app, 'POST', '/app/push/subscriptions', {
      cookie,
      body: { ...subscription, keys: { ...subscription.keys, p256dh: 'not+base64/url=' } },
    });

    expect(http.status).toBe(422);
    expect(http.error?.code).toBe('VALIDATION_FAILED');
    expect(http.error?.details).toEqual([
      { path: 'endpoint', message: 'Endereço de notificação inválido' },
    ]);
    expect(badKey.status).toBe(422);
    expect(badKey.error?.details?.[0]?.path).toBe('keys.p256dh');
    expect(await rows()).toHaveLength(0);
  });

  it('answers 401 without a session', async () => {
    const res = await send(buildApp(), 'POST', '/app/push/subscriptions', { body: subscription });

    expect(res.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });
});

describe('DELETE /app/push/subscriptions (GES-77)', () => {
  it('removes the subscription by endpoint and answers 204', async () => {
    const { cookie } = await tenant('ana@bravoclinic.test');
    await send(buildApp(), 'POST', '/app/push/subscriptions', { cookie, body: subscription });

    const res = await send(buildApp(), 'DELETE', '/app/push/subscriptions', {
      cookie,
      body: { endpoint: ENDPOINT },
    });

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it("leaves another user's subscription in place", async () => {
    const a = await tenant('ana@bravoclinic.test');
    const b = await tenant('bia@bravoclinic.test');
    await send(buildApp(), 'POST', '/app/push/subscriptions', {
      cookie: a.cookie,
      body: subscription,
    });

    const res = await send(buildApp(), 'DELETE', '/app/push/subscriptions', {
      cookie: b.cookie,
      body: { endpoint: ENDPOINT },
    });

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(1);
  });

  it('answers 401 without a session', async () => {
    const res = await send(buildApp(), 'DELETE', '/app/push/subscriptions', {
      body: { endpoint: ENDPOINT },
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /public/config: vapidPublicKey (GES-75)', () => {
  it('is null without the VAPID env vars', async () => {
    const res = await send(buildApp(), 'GET', '/public/config');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ vapidPublicKey: null });
  });

  it('equals VAPID_PUBLIC_KEY when VAPID is configured', async () => {
    const res = await send(
      buildApp({
        VAPID_PUBLIC_KEY: 'BPublicKey-value_1',
        VAPID_PRIVATE_KEY: 'private',
        VAPID_SUBJECT: 'mailto:ops@bravoclinic.test',
      }),
      'GET',
      '/public/config',
    );

    expect(res.body).toMatchObject({ vapidPublicKey: 'BPublicKey-value_1' });
  });
});
