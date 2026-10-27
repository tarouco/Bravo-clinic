import {
  notificationCatalog,
  parseSetting,
  settingDefaults,
  type NotificationEvent,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { withTransaction, type Db, type Tx } from '../../db/client';
import { notificationRecipients, settings, users } from '../../db/schema';
import {
  renderStaffEmail,
  systemTestTemplate,
  type StaffTemplate,
} from '../../emails/templates/gestao';
import type { Env } from '../../env';
import type { RequestContext } from '../../lib/audit';
import { dispatchEmails, queueEmail, type EmailAttachment } from '../../lib/email';
import { logger } from '../../lib/logger';
import { sendPush, type PushIntent, type WebPushClient } from '../../lib/push';

// The single emit point of tenant and staff notifications (AD-025, GES-67, GES-68, GES-78).
// `emit` writes in the caller's transaction; `afterCommit` sends e-mails and pushes once it
// committed, so a rollback produces neither.

export interface NotificationEmail {
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  dedupeKey?: string;
}

export interface EmitEvent {
  name: NotificationEvent;
  /** Booking, charge, subscription... id; part of the staff dedupe key. */
  entityId: string;
  /** Tenant events: the user notified (e-mail address and push subscriptions). */
  userId?: string;
  /** Explicit address: overrides the user's e-mail, or the staff recipient list. */
  to?: string;
  /** Template and push data (`when`, ids, names...). */
  data: Record<string, unknown>;
  /** The rendered e-mail of a tenant event (the owning feature renders it). */
  email?: NotificationEmail;
}

export interface EmitResult {
  outboxIds: string[];
  pushIntents: PushIntent[];
}

export interface NotificationDeps {
  db: Db;
  env: Env;
  fetch: typeof fetch;
  now: () => Date;
  webPush?: WebPushClient;
}

const empty = (): EmitResult => ({ outboxIds: [], pushIntents: [] });

async function staffToggleOn(tx: Tx, key: string): Promise<boolean> {
  const [row] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'notifications.events'));
  let events = settingDefaults()['notifications.events'];
  if (row !== undefined) {
    try {
      events = parseSetting('notifications.events', row.value);
    } catch {
      // An invalid stored value falls back to the factory default (all on).
    }
  }
  return (events as Record<string, boolean>)[key] === true;
}

async function emitTenant(tx: Tx, event: EmitEvent): Promise<EmitResult> {
  const def = notificationCatalog[event.name];
  const outboxIds: string[] = [];
  const pushIntents: PushIntent[] = [];
  if (event.email !== undefined) {
    let to = event.to;
    if (to === undefined && event.userId !== undefined) {
      const [user] = await tx
        .select({ email: users.email, status: users.status })
        .from(users)
        .where(eq(users.id, event.userId));
      if (user !== undefined && user.status !== 'deleted') to = user.email;
    }
    if (to !== undefined) {
      outboxIds.push(
        await queueEmail(tx, {
          to,
          template: def.template,
          subject: event.email.subject,
          html: event.email.html,
          text: event.email.text,
          ...(event.email.attachments !== undefined && { attachments: event.email.attachments }),
          ...(event.email.dedupeKey !== undefined && { dedupeKey: event.email.dedupeKey }),
        }),
      );
    }
  }
  if (def.push !== undefined && event.userId !== undefined) {
    pushIntents.push({
      userId: event.userId,
      payload: {
        title: def.push.title(event.data),
        body: def.push.body(event.data),
        url: def.push.url(event.data),
        tag: def.push.tag,
      },
    });
  }
  return { outboxIds, pushIntents };
}

async function emitStaff(tx: Tx, event: EmitEvent, env: Env): Promise<EmitResult> {
  const def = notificationCatalog[event.name];
  if (def.staffToggle !== undefined && !(await staffToggleOn(tx, def.staffToggle))) return empty();
  const recipients =
    event.to !== undefined
      ? [{ id: event.to.toLowerCase(), email: event.to }]
      : await tx
          .select({ id: notificationRecipients.id, email: notificationRecipients.email })
          .from(notificationRecipients)
          .where(eq(notificationRecipients.active, true));
  if (recipients.length === 0) return empty();
  const mail =
    event.email ??
    (event.name === 'system.test'
      ? systemTestTemplate({}, env)
      : renderStaffEmail(event.name as StaffTemplate, event.data, env));
  const key = event.name.replace(/^staff\./, '');
  const outboxIds: string[] = [];
  for (const recipient of recipients) {
    outboxIds.push(
      await queueEmail(tx, {
        to: recipient.email,
        template: def.template,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        dedupeKey: `staff:${key}:${event.entityId}:${recipient.id}`,
      }),
    );
  }
  return { outboxIds, pushIntents: [] };
}

/**
 * Queues the notification in the caller's transaction (AD-025). Tenant events queue the given
 * e-mail to the user (or `to`) and collect a push intent when the catalog defines one. Staff
 * events check their `notifications.events` toggle, then queue `staff.<event>` once per active
 * recipient with dedupe key `staff:<event>:<entityId>:<recipientId>`, so a repeat queues nothing.
 */
export async function emit(
  tx: Tx,
  _ctx: RequestContext,
  event: EmitEvent,
  deps: { env: Env },
): Promise<EmitResult> {
  const def = notificationCatalog[event.name];
  return def.audience === 'staff' ? emitStaff(tx, event, deps.env) : emitTenant(tx, event);
}

/** Sends what `emit` queued, after the transaction committed. Never throws. */
export async function afterCommit(result: EmitResult, deps: NotificationDeps): Promise<void> {
  try {
    await dispatchEmails(deps.db, result.outboxIds, { env: deps.env, fetch: deps.fetch });
    await sendPush(deps.db, result.pushIntents, deps);
  } catch (error) {
    logger.error('notification dispatch failed', {
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
}

/**
 * Runs `fn` in one transaction with an `emit` bound to it, then dispatches everything emitted once
 * the transaction committed. A rollback leaves no outbox row and sends no push.
 */
export async function withNotifications<T>(
  deps: NotificationDeps,
  ctx: RequestContext,
  fn: (tx: Tx, notify: (event: EmitEvent) => Promise<EmitResult>) => Promise<T>,
): Promise<T> {
  const collected: EmitResult = { outboxIds: [], pushIntents: [] };
  const value = await withTransaction(deps.db, (tx) =>
    fn(tx, async (event) => {
      const result = await emit(tx, ctx, event, deps);
      collected.outboxIds.push(...result.outboxIds);
      collected.pushIntents.push(...result.pushIntents);
      return result;
    }),
  );
  await afterCommit(collected, deps);
  return value;
}
