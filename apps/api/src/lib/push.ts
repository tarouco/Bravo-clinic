import { eq, inArray, sql } from 'drizzle-orm';
import * as webPushLib from 'web-push';
import type { Db } from '../db/client';
import { pushSubscriptions } from '../db/schema';
import type { Env } from '../env';
import { logger } from './logger';

// Web push sender (GES-78..GES-81, design.md "Notifications service"). VAPID keys come from the
// env; without all three nothing is sent. Dead subscriptions are pruned.

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** A push to every subscription of `userId`, collected by `emit()` and sent after commit. */
export interface PushIntent {
  userId: string;
  payload: PushPayload;
}

/** The part of the `web-push` module the sender uses; tests inject a stub. */
export interface WebPushClient {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: {
      vapidDetails: { subject: string; publicKey: string; privateKey: string };
      TTL: number;
    },
  ): Promise<unknown>;
}

export interface PushDeps {
  env: Pick<Env, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>;
  now: () => Date;
  webPush?: WebPushClient;
}

export const MAX_PUSH_PAYLOAD_BYTES = 3 * 1024;
/** Consecutive failures after which a subscription is deleted (GES-79). */
export const MAX_PUSH_FAILURES = 5;
const TTL_SECONDS = 24 * 60 * 60;

export interface PushStats {
  sent: number;
  pruned: number;
  failed: number;
}

/** VAPID details when all three keys are set, else null (GES-81). */
export function vapidDetails(env: PushDeps['env']) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env;
  if (VAPID_PUBLIC_KEY === undefined || VAPID_PRIVATE_KEY === undefined) return null;
  if (VAPID_SUBJECT === undefined) return null;
  return { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };
}

/** The JSON payload, with the body shortened so the whole message stays within 3 KB. */
export function encodePushPayload(payload: PushPayload): string {
  const fits = (json: string) => Buffer.byteLength(json, 'utf8') <= MAX_PUSH_PAYLOAD_BYTES;
  let json = JSON.stringify(payload);
  const chars = [...payload.body];
  while (!fits(json) && chars.length > 0) {
    chars.pop();
    json = JSON.stringify({ ...payload, body: `${chars.join('')}…` });
  }
  return json;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Sends each intent to every subscription of its user. 404/410 deletes the subscription; any
 * other failure increments `failure_count` and deletes it at 5; a success sets `last_success_at`
 * and resets the count. Never throws: the originating request already succeeded.
 */
export async function sendPush(db: Db, intents: PushIntent[], deps: PushDeps): Promise<PushStats> {
  const stats: PushStats = { sent: 0, pruned: 0, failed: 0 };
  const vapid = vapidDetails(deps.env);
  if (vapid === null || intents.length === 0) return stats;
  const client = deps.webPush ?? webPushLib;
  try {
    const userIds = [...new Set(intents.map((intent) => intent.userId))];
    const subscriptions = await db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));
    for (const intent of intents) {
      const payload = encodePushPayload(intent.payload);
      for (const sub of subscriptions.filter((s) => s.userId === intent.userId)) {
        try {
          await client.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { vapidDetails: vapid, TTL: TTL_SECONDS },
          );
          stats.sent += 1;
          await db
            .update(pushSubscriptions)
            .set({ lastSuccessAt: deps.now(), failureCount: 0 })
            .where(eq(pushSubscriptions.id, sub.id));
        } catch (error) {
          const status = statusOf(error);
          if (status === 404 || status === 410) {
            stats.pruned += 1;
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
            continue;
          }
          stats.failed += 1;
          const [row] = await db
            .update(pushSubscriptions)
            .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
            .where(eq(pushSubscriptions.id, sub.id))
            .returning({ failureCount: pushSubscriptions.failureCount });
          if (row !== undefined && row.failureCount >= MAX_PUSH_FAILURES) {
            stats.pruned += 1;
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          }
          logger.warn('push delivery failed', { subscriptionId: sub.id, status: status ?? null });
        }
      }
    }
  } catch (error) {
    logger.error('push dispatch failed', {
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
  return stats;
}
