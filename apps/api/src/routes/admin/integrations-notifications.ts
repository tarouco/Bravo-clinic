import { randomUUID } from 'node:crypto';
import {
  emailSchema,
  idSchema,
  notificationEventsSchema,
  notificationRecipientSchema,
} from '@bravo/core';
import { and, asc, count, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { emailOutbox, notificationRecipients } from '../../db/schema';
import { audit } from '../../lib/audit';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { AppError, conflict, notFound, tooManyRequests } from '../../lib/errors';
import { actorContext } from '../../lib/request-meta';
import { consumeRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import { validate } from '../../middleware/validate';
import { withNotifications } from '../../modules/notifications/notifications.service';
import { loadSettings, saveSetting } from '../../modules/settings/settings.repo';
import type { AppEnv } from '../../types';

// E-mails tab (GES-65, GES-66, GES-70, GES-71, GES-74); `adminRoutes` limits it to admins.

/** At most 10 notification recipients (GES-65). */
export const MAX_RECIPIENTS = 10;
/** Test e-mails per admin per hour (GES-70). */
export const TEST_EMAILS_PER_HOUR = 5;
const OUTBOX_DAYS = 30;
const OUTBOX_PAGE = 50;
const DAY_MS = 86_400_000;

const idParam = z.object({ id: idSchema });
const recipientPatchSchema = z.object({ active: z.boolean({ error: 'Informe se está ativo' }) });
const testEmailSchema = z.object({ to: emailSchema.optional() });
const outboxQuerySchema = z.object({
  status: z
    .enum(['pending', 'sent', 'failed', 'not_sent'], { error: 'Status inválido' })
    .optional(),
  cursor: z.string().max(200).optional(),
});

type RecipientRow = typeof notificationRecipients.$inferSelect;
const recipientView = (r: RecipientRow) => ({ id: r.id, email: r.email, active: r.active });

export function adminIntegrationsNotificationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const base = '/integrations/notifications';

  app.get(base, async (c) => {
    const { db, env } = c.var.deps;
    const recipients = await db
      .select()
      .from(notificationRecipients)
      .orderBy(asc(notificationRecipients.createdAt), asc(notificationRecipients.email));
    return c.json({
      providerConfigured: env.RESEND_API_KEY !== undefined,
      recipients: recipients.map(recipientView),
      events: (await loadSettings(db))['notifications.events'],
    });
  });

  app.post(`${base}/recipients`, validate('json', notificationRecipientSchema), async (c) => {
    const ctx = actorContext(c);
    const email = c.req.valid('json').email.trim().toLowerCase();
    const row = await withTransaction(c.var.deps.db, async (tx) => {
      // Serializes concurrent additions so the limit of 10 holds.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('notification_recipients'))`);
      const [existing] = await tx
        .select({ id: notificationRecipients.id })
        .from(notificationRecipients)
        .where(eq(notificationRecipients.email, email));
      if (existing !== undefined) throw conflict('CONFLICT', 'Este e-mail já está na lista');
      const [total] = await tx.select({ n: count() }).from(notificationRecipients);
      if ((total?.n ?? 0) >= MAX_RECIPIENTS) {
        throw new AppError(
          422,
          'POLICY_VIOLATION',
          `Cadastre no máximo ${String(MAX_RECIPIENTS)} destinatários`,
        );
      }
      const [inserted] = await tx.insert(notificationRecipients).values({ email }).returning();
      if (inserted === undefined) throw new Error('recipient insert returned no row');
      await audit(tx, ctx, {
        action: 'notification_recipient.create',
        entityType: 'notification_recipient',
        entityId: inserted.id,
        after: recipientView(inserted),
      });
      return inserted;
    });
    return c.json(recipientView(row), 201);
  });

  app.patch(
    `${base}/recipients/:id`,
    validate('param', idParam),
    validate('json', recipientPatchSchema),
    async (c) => {
      const ctx = actorContext(c);
      const { id } = c.req.valid('param');
      const { active } = c.req.valid('json');
      const row = await withTransaction(c.var.deps.db, async (tx) => {
        const [before] = await tx
          .select()
          .from(notificationRecipients)
          .where(eq(notificationRecipients.id, id))
          .for('update');
        if (before === undefined) throw notFound();
        const [after] = await tx
          .update(notificationRecipients)
          .set({ active })
          .where(eq(notificationRecipients.id, id))
          .returning();
        if (after === undefined) throw notFound();
        await audit(tx, ctx, {
          action: 'notification_recipient.update',
          entityType: 'notification_recipient',
          entityId: id,
          before: recipientView(before),
          after: recipientView(after),
        });
        return after;
      });
      return c.json(recipientView(row));
    },
  );

  app.delete(`${base}/recipients/:id`, validate('param', idParam), async (c) => {
    const ctx = actorContext(c);
    const { id } = c.req.valid('param');
    await withTransaction(c.var.deps.db, async (tx) => {
      const [removed] = await tx
        .delete(notificationRecipients)
        .where(eq(notificationRecipients.id, id))
        .returning();
      if (removed === undefined) throw notFound();
      await audit(tx, ctx, {
        action: 'notification_recipient.delete',
        entityType: 'notification_recipient',
        entityId: id,
        before: recipientView(removed),
      });
    });
    return c.body(null, 204);
  });

  app.put(`${base}/events`, validate('json', notificationEventsSchema), async (c) => {
    const ctx = actorContext(c);
    const events = c.req.valid('json');
    await withTransaction(c.var.deps.db, async (tx) => {
      const before = (await loadSettings(tx))['notifications.events'];
      await saveSetting(tx, 'notifications.events', events, ctx.actorUserId);
      await audit(tx, ctx, {
        action: 'notification_events.update',
        entityType: 'setting',
        entityId: 'notifications.events',
        before,
        after: events,
      });
    });
    return c.json(events);
  });

  app.post(`${base}/test`, validate('json', testEmailSchema), async (c) => {
    const deps = c.var.deps;
    const ctx = actorContext(c);
    const limit = await consumeRateLimit(
      deps.db,
      rateLimitKey('email_test', c.get('auth').userId),
      { limit: TEST_EMAILS_PER_HOUR, windowSeconds: 3600, now: deps.now() },
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);
    const { to } = c.req.valid('json');
    const ids = await withNotifications(deps, ctx, async (_tx, notify) => {
      const result = await notify({
        name: 'system.test',
        entityId: randomUUID(),
        data: {},
        ...(to !== undefined && { to: to.toLowerCase() }),
      });
      return result.outboxIds;
    });
    const rows =
      ids.length === 0
        ? []
        : await deps.db
            .select({ id: emailOutbox.id, to: emailOutbox.toAddress, status: emailOutbox.status })
            .from(emailOutbox)
            .where(inArray(emailOutbox.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return c.json({
      results: ids.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined ? [] : [{ to: row.to, status: row.status }];
      }),
    });
  });

  app.get('/integrations/outbox', validate('query', outboxQuerySchema), async (c) => {
    const { db, now } = c.var.deps;
    const { status, cursor } = c.req.valid('query');
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    const since = new Date(now().getTime() - OUTBOX_DAYS * DAY_MS);
    const conditions = [gte(emailOutbox.createdAt, since)];
    if (status !== undefined) conditions.push(eq(emailOutbox.status, status));
    if (after !== undefined) {
      const older = or(
        lt(emailOutbox.createdAt, after.at),
        and(eq(emailOutbox.createdAt, after.at), lt(emailOutbox.id, after.id)),
      );
      if (older !== undefined) conditions.push(older);
    }
    const rows = await db
      .select({
        id: emailOutbox.id,
        to: emailOutbox.toAddress,
        template: emailOutbox.template,
        subject: emailOutbox.subject,
        status: emailOutbox.status,
        attempts: emailOutbox.attempts,
        lastError: emailOutbox.lastError,
        createdAt: emailOutbox.createdAt,
        sentAt: emailOutbox.sentAt,
      })
      .from(emailOutbox)
      .where(and(...conditions))
      .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
      .limit(OUTBOX_PAGE + 1);
    const page = rows.slice(0, OUTBOX_PAGE);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
      nextCursor:
        rows.length > OUTBOX_PAGE && last !== undefined
          ? encodeCursor({ at: last.createdAt, id: last.id })
          : null,
    });
  });
  return app;
}
