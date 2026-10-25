import { eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { emailOutbox } from '../db/schema';
import type { Env } from '../env';
import { logger } from './logger';

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 500;

export interface QueuedEmail {
  to: string;
  template: string;
  subject: string;
  html: string;
  text: string;
  dedupeKey?: string;
}

/** Records the message as `pending` in the caller's transaction and returns the outbox id. */
export async function queueEmail(tx: Tx, msg: QueuedEmail): Promise<string> {
  const values = {
    toAddress: msg.to,
    template: msg.template,
    subject: msg.subject,
    html: msg.html,
    textBody: msg.text,
    dedupeKey: msg.dedupeKey ?? null,
  };
  const [inserted] = await tx
    .insert(emailOutbox)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: emailOutbox.id });
  if (inserted !== undefined) return inserted.id;
  // Only a repeated dedupeKey can conflict: hand back the message already queued under it.
  const [existing] = await tx
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(eq(emailOutbox.dedupeKey, values.dedupeKey ?? ''));
  if (existing === undefined) throw new Error('queueEmail: insert returned no row');
  return existing.id;
}

type Row = typeof emailOutbox.$inferSelect;

async function send(
  row: Row,
  deps: { env: Env; fetch: typeof fetch; apiKey: string },
): Promise<string | null> {
  const response = await deps.fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: deps.env.EMAIL_FROM,
      to: [row.toAddress],
      subject: row.subject,
      html: row.html,
      text: row.textBody,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Resend responded ${response.status}${detail === '' ? '' : `: ${detail}`}`);
  }
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return typeof body?.id === 'string' ? body.id : null;
}

/**
 * Sends the pending messages after their transaction committed. Never throws: the originating
 * request must succeed whatever the provider does (FND-79, FND-80).
 */
export async function dispatchEmails(
  db: Db,
  ids: string[],
  deps: { env: Env; fetch: typeof fetch },
): Promise<void> {
  if (ids.length === 0) return;
  try {
    const rows = await db.select().from(emailOutbox).where(inArray(emailOutbox.id, ids));
    for (const row of rows) {
      if (row.status !== 'pending') continue;
      const apiKey = deps.env.RESEND_API_KEY;
      if (apiKey === undefined) {
        await db.update(emailOutbox).set({ status: 'not_sent' }).where(eq(emailOutbox.id, row.id));
        continue;
      }
      try {
        const providerMessageId = await send(row, { ...deps, apiKey });
        await db
          .update(emailOutbox)
          .set({ status: 'sent', providerMessageId, sentAt: sql`now()` })
          .where(eq(emailOutbox.id, row.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(emailOutbox)
          .set({
            status: 'failed',
            attempts: sql`${emailOutbox.attempts} + 1`,
            lastError: message.slice(0, MAX_ERROR_LENGTH),
          })
          .where(eq(emailOutbox.id, row.id));
      }
    }
  } catch (error) {
    logger.error('email dispatch failed', {
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
}
