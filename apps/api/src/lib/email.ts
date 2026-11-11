import { eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { emailOutbox } from '../db/schema';
import type { Env } from '../env';
import { logger } from './logger';

const RESEND_URL = 'https://api.resend.com/emails';
const SENDKIT_URL = 'https://api.sendkit.dev/emails';
/** Display name in front of `EMAIL_FROM` on SendKit messages. */
const SENDER_NAME = 'Bravô Clinic';
const SEND_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 500;

/** A file sent with the message, e.g. the booking `.ics` (docs/architecture.md section 5.2). */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface QueuedEmail {
  to: string;
  template: string;
  subject: string;
  html: string;
  text: string;
  dedupeKey?: string;
  attachments?: EmailAttachment[];
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
    attachments: msg.attachments ?? [],
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

export interface EmailProvider {
  name: 'sendkit' | 'resend';
  apiKey: string;
}

/**
 * The provider that delivers the outbox (AD-046): SendKit when `SENDKIT_API_KEY` is set, else
 * Resend when `RESEND_API_KEY` is set, else none (messages stay in the outbox as `not_sent`).
 */
export function emailProvider(
  env: Pick<Env, 'SENDKIT_API_KEY' | 'RESEND_API_KEY'>,
): EmailProvider | null {
  if (env.SENDKIT_API_KEY !== undefined) return { name: 'sendkit', apiKey: env.SENDKIT_API_KEY };
  if (env.RESEND_API_KEY !== undefined) return { name: 'resend', apiKey: env.RESEND_API_KEY };
  return null;
}

const PROVIDER_LABEL = { sendkit: 'SendKit', resend: 'Resend' } as const;

/** Both providers take the same JSON shape; only the URL, `from` and `to` forms differ. */
async function send(
  row: Row,
  deps: { env: Env; fetch: typeof fetch; provider: EmailProvider },
): Promise<string | null> {
  const attachments = row.attachments as EmailAttachment[];
  const sendkit = deps.provider.name === 'sendkit';
  const response = await deps.fetch(sendkit ? SENDKIT_URL : RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sendkit ? `${SENDER_NAME} <${deps.env.EMAIL_FROM}>` : deps.env.EMAIL_FROM,
      to: sendkit ? row.toAddress : [row.toAddress],
      subject: row.subject,
      html: row.html,
      text: row.textBody,
      ...(attachments.length > 0 && {
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.contentBase64,
          content_type: a.contentType,
        })),
      }),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(
      `${PROVIDER_LABEL[deps.provider.name]} responded ${response.status}${detail === '' ? '' : `: ${detail}`}`,
    );
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
      const provider = emailProvider(deps.env);
      if (provider === null) {
        await db.update(emailOutbox).set({ status: 'not_sent' }).where(eq(emailOutbox.id, row.id));
        continue;
      }
      try {
        const providerMessageId = await send(row, { ...deps, provider });
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
