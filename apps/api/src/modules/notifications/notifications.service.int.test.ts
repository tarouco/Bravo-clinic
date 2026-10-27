import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../../test/factories';
import { forbiddenFetch, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb } from '../../db/client';
import { emailOutbox, notificationRecipients, pushSubscriptions, settings } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { JOB_CONTEXT } from '../../jobs/runner';
import { MAX_PUSH_PAYLOAD_BYTES, encodePushPayload, type WebPushClient } from '../../lib/push';
import { afterCommit, emit, withNotifications, type EmitEvent } from './notifications.service';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-27T12:00:00.000Z');
const VAPID = {
  VAPID_PUBLIC_KEY: 'BPublicKeyForTests',
  VAPID_PRIVATE_KEY: 'private-key-for-tests',
  VAPID_SUBJECT: 'mailto:ops@bravoclinic.test',
};

function stubPush(impl?: () => Promise<unknown>) {
  const sendNotification = vi.fn(impl ?? (() => Promise.resolve({ statusCode: 201 })));
  return { client: { sendNotification } satisfies WebPushClient, sendNotification };
}

const deps = (webPush: WebPushClient, env = testEnv(VAPID)) => ({
  db,
  env,
  fetch: forbiddenFetch,
  now: () => NOW,
  webPush,
});

const newBooking: EmitEvent = {
  name: 'staff.new_booking',
  entityId: 'b0000000-0000-4000-8000-000000000001',
  data: {
    customerName: 'Ana Souza',
    roomName: 'Sala Principal',
    startsAt: new Date('2026-10-28T13:00:00.000Z'),
    code: 'BRV-ABC123',
  },
};

const confirmed = (userId: string): EmitEvent => ({
  name: 'booking.confirmed',
  entityId: 'b1',
  userId,
  data: { bookingId: 'b1', when: '28/10/2026 10:00' },
  email: { subject: 'Reserva confirmada', html: '<p>ok</p>', text: 'ok' },
});

async function subscribe(userId: string, n: number) {
  const rows = await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: `https://push.example/${userId}/${String(n)}`,
      p256dh: 'BKey',
      auth: 'auth',
    })
    .returning();
  return rows[0]!;
}

const outbox = () => db.select().from(emailOutbox);

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

describe('staff events (GES-67, GES-68)', () => {
  async function recipients() {
    return db
      .insert(notificationRecipients)
      .values([
        { email: 'gerente@bravoclinic.test' },
        { email: 'recepcao@bravoclinic.test' },
        { email: 'antigo@bravoclinic.test', active: false },
      ])
      .returning();
  }

  it('queues one staff.new_booking per active recipient with the dedupe key; a repeat queues none', async () => {
    const [manager, desk] = await recipients();
    const { client } = stubPush();

    await withNotifications(deps(client), JOB_CONTEXT, (_tx, notify) => notify(newBooking));
    await withNotifications(deps(client), JOB_CONTEXT, (_tx, notify) => notify(newBooking));

    const rows = await outbox();
    expect(rows.map((r) => [r.toAddress, r.template, r.dedupeKey]).sort()).toEqual(
      [
        [
          'gerente@bravoclinic.test',
          'staff.new_booking',
          `staff:new_booking:${newBooking.entityId}:${manager?.id ?? ''}`,
        ],
        [
          'recepcao@bravoclinic.test',
          'staff.new_booking',
          `staff:new_booking:${newBooking.entityId}:${desk?.id ?? ''}`,
        ],
      ].sort(),
    );
    expect(rows[0]?.subject).toBe('Nova reserva BRV-ABC123: Sala Principal, 28/10/2026 às 10:00');
  });

  it('queues nothing while the event toggle is off', async () => {
    await recipients();
    const off = {
      ...((await db.select().from(settings).where(eq(settings.key, 'notifications.events')))[0]
        ?.value as Record<string, boolean>),
      new_booking: false,
    };
    await db.update(settings).set({ value: off }).where(eq(settings.key, 'notifications.events'));

    const result = await withNotifications(deps(stubPush().client), JOB_CONTEXT, (_tx, notify) =>
      notify(newBooking),
    );

    expect(result).toEqual({ outboxIds: [], pushIntents: [] });
    expect(await outbox()).toHaveLength(0);
  });

  it('sends staff.payment_issue, which has no toggle, even when every toggle is off', async () => {
    await recipients();
    const allOff = Object.fromEntries(
      Object.keys(
        (await db.select().from(settings).where(eq(settings.key, 'notifications.events')))[0]
          ?.value as Record<string, boolean>,
      ).map((k) => [k, false]),
    );
    await db
      .update(settings)
      .set({ value: allOff })
      .where(eq(settings.key, 'notifications.events'));

    await withNotifications(deps(stubPush().client), JOB_CONTEXT, (_tx, notify) =>
      notify({ name: 'staff.payment_issue', entityId: 'ch1', data: { reason: 'charged_back' } }),
    );

    expect((await outbox()).map((r) => r.template)).toEqual([
      'staff.payment_issue',
      'staff.payment_issue',
    ]);
  });
});

describe('tenant events and web push (GES-78)', () => {
  it('queues the given e-mail to the user and pushes { title, body, url, tag } to each of their subscriptions', async () => {
    const user = await createUser(db);
    const other = await createUser(db);
    await subscribe(user.id, 1);
    await subscribe(user.id, 2);
    await subscribe(other.id, 1);
    const { client, sendNotification } = stubPush();

    await withNotifications(deps(client), JOB_CONTEXT, (_tx, notify) => notify(confirmed(user.id)));

    const rows = await outbox();
    expect(rows.map((r) => [r.toAddress, r.template, r.subject])).toEqual([
      [user.email, 'booking.confirmed', 'Reserva confirmada'],
    ]);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const endpoints = sendNotification.mock.calls.map((call) => (call as unknown[])[0]);
    expect(endpoints).toEqual(
      expect.arrayContaining([
        { endpoint: `https://push.example/${user.id}/1`, keys: { p256dh: 'BKey', auth: 'auth' } },
        { endpoint: `https://push.example/${user.id}/2`, keys: { p256dh: 'BKey', auth: 'auth' } },
      ]),
    );
    const [, payload, options] = sendNotification.mock.calls[0] as unknown as [
      unknown,
      string,
      { vapidDetails: unknown },
    ];
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(3 * 1024);
    expect(JSON.parse(payload)).toEqual({
      title: 'Reserva confirmada',
      body: 'Sua reserva de 28/10/2026 10:00 está confirmada.',
      url: '/app/minhas-reservas/b1',
      tag: 'booking.confirmed',
    });
    expect(options.vapidDetails).toEqual({
      subject: VAPID.VAPID_SUBJECT,
      publicKey: VAPID.VAPID_PUBLIC_KEY,
      privateKey: VAPID.VAPID_PRIVATE_KEY,
    });
  });

  it('keeps every payload within 3 KB by shortening the body', () => {
    const json = encodePushPayload({ title: 'T', body: 'é'.repeat(4000), url: '/app', tag: 't' });

    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_BYTES);
    expect(JSON.parse(json)).toMatchObject({ title: 'T', url: '/app', tag: 't' });
  });

  it('a rolled-back transaction leaves no outbox row and sends no push (GES-67, GES-78)', async () => {
    const user = await createUser(db);
    await subscribe(user.id, 1);
    await db.insert(notificationRecipients).values({ email: 'gerente@bravoclinic.test' });
    const { client, sendNotification } = stubPush();

    await expect(
      withNotifications(deps(client), JOB_CONTEXT, async (_tx, notify) => {
        await notify(confirmed(user.id));
        await notify(newBooking);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await outbox()).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('attempts no push without VAPID and still resolves with the e-mail queued (GES-81)', async () => {
    const user = await createUser(db);
    await subscribe(user.id, 1);
    const { client, sendNotification } = stubPush();

    const result = await withNotifications(deps(client, testEnv()), JOB_CONTEXT, (_tx, notify) =>
      notify(confirmed(user.id)),
    );

    expect(result.outboxIds).toHaveLength(1);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await outbox()).toHaveLength(1);
  });
});

describe('push pruning (GES-79, GES-80)', () => {
  const failing = (statusCode: number) => () =>
    Promise.reject(Object.assign(new Error(`push ${String(statusCode)}`), { statusCode }));

  async function pushOnce(userId: string, client: WebPushClient) {
    const result = await db.transaction((tx) =>
      emit(tx, JOB_CONTEXT, confirmed(userId), deps(client)),
    );
    await afterCommit({ outboxIds: [], pushIntents: result.pushIntents }, deps(client));
  }

  it('deletes the subscription on 410 and on 404', async () => {
    const user = await createUser(db);
    await subscribe(user.id, 1);
    await pushOnce(user.id, stubPush(failing(410)).client);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);

    await subscribe(user.id, 2);
    await pushOnce(user.id, stubPush(failing(404)).client);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it('increments failure_count on 500 and deletes the subscription at the 5th failure', async () => {
    const user = await createUser(db);
    const sub = await subscribe(user.id, 1);
    const { client } = stubPush(failing(500));

    for (let i = 1; i <= 4; i++) {
      await pushOnce(user.id, client);
      const [row] = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.id, sub.id));
      expect(row?.failureCount).toBe(i);
    }
    await pushOnce(user.id, client);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it('a success resets failure_count and sets last_success_at', async () => {
    const user = await createUser(db);
    const sub = await subscribe(user.id, 1);
    await pushOnce(user.id, stubPush(failing(500)).client);
    await pushOnce(user.id, stubPush(failing(503)).client);

    await pushOnce(user.id, stubPush().client);

    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    expect(row?.failureCount).toBe(0);
    expect(row?.lastSuccessAt?.toISOString()).toBe(NOW.toISOString());
  });
});
