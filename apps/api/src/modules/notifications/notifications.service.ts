import {
  notificationCatalog,
  parseSetting,
  settingDefaults,
  type NotificationEvent,
} from '@bravo/core';
import { and, eq, inArray } from 'drizzle-orm';
import { withTransaction, type Db, type Tx } from '../../db/client';
import { emailOutbox, notificationRecipients, settings, users } from '../../db/schema';
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

async function emitStaff(
  tx: Tx,
  event: EmitEvent,
  env: Pick<Env, 'APP_BASE_URL'>,
): Promise<EmitResult> {
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
 * Staff templates build links on `APP_BASE_URL`, so staff events need `deps.env`.
 */
export async function emit(
  tx: Tx,
  _ctx: RequestContext,
  event: EmitEvent,
  deps?: { env: Pick<Env, 'APP_BASE_URL'> },
): Promise<EmitResult> {
  const def = notificationCatalog[event.name];
  if (def.audience === 'tenant') return emitTenant(tx, event);
  if (deps === undefined) throw new Error(`emit: staff event ${event.name} needs the env`);
  return emitStaff(tx, event, deps.env);
}

/** Context of notices raised without a request of their own (feature mailers, staff port). */
export const SYSTEM_CONTEXT: RequestContext = {
  actorUserId: null,
  actorRole: null,
  origin: 'system',
  ip: null,
  requestId: null,
};

// Pushes of the e-mails queued by the feature mailers (gestao T43, R7), held by outbox id until
// the caller dispatches those e-mails after commit (`dispatchNotifications`). The mailers return
// only the outbox id, so this is how their push reaches the after-commit step. Bounded, so the
// entries of rolled-back transactions cannot pile up.
const heldPushes = new Map<string, PushIntent[]>();
const MAX_HELD_PUSHES = 1_000;

function holdPushes(outboxId: string, intents: PushIntent[]): void {
  if (intents.length === 0) return;
  // A repeat (same dedupe key, same row) replaces the held push instead of adding a second one.
  heldPushes.delete(outboxId);
  heldPushes.set(outboxId, intents);
  for (const oldest of heldPushes.keys()) {
    if (heldPushes.size <= MAX_HELD_PUSHES) break;
    heldPushes.delete(oldest);
  }
}

/**
 * The tenant e-mail of a feature mailer (`bookingMailer`, `revenueMailer`): emits the event in the
 * caller's transaction, holds its push for `dispatchNotifications` and returns the outbox id.
 */
export async function emitTenantMail(
  tx: Tx,
  event: EmitEvent & { to: string; email: NotificationEmail },
): Promise<string> {
  const result = await emit(tx, SYSTEM_CONTEXT, event);
  const [outboxId] = result.outboxIds;
  if (outboxId === undefined) throw new Error(`emit queued no e-mail for ${event.name}`);
  holdPushes(outboxId, result.pushIntents);
  return outboxId;
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
 * After-commit dispatch of outbox ids collected from the feature mailers: sends the e-mails and the
 * pushes held for them. A push goes out only with an e-mail still `pending`, so a repeated notice
 * (deduplicated to an e-mail already sent) pushes nothing. Never throws.
 */
export async function dispatchNotifications(
  deps: NotificationDeps,
  outboxIds: string[],
): Promise<void> {
  const ids = [...new Set(outboxIds)];
  const pushIntents: PushIntent[] = [];
  try {
    const held = ids.filter((id) => heldPushes.has(id));
    if (held.length > 0) {
      const pending = await deps.db
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .where(and(inArray(emailOutbox.id, held), eq(emailOutbox.status, 'pending')));
      const pendingIds = new Set(pending.map((row) => row.id));
      for (const id of held) {
        if (pendingIds.has(id)) pushIntents.push(...(heldPushes.get(id) ?? []));
        heldPushes.delete(id);
      }
    }
  } catch (error) {
    logger.error('held push lookup failed', {
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
  await afterCommit({ outboxIds: ids, pushIntents }, deps);
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
