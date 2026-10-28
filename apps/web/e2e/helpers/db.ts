import { Pool } from 'pg';
import { e2eDatabaseUrl } from '../../../api/test/e2e-seed';

// Database lookups of the gestao e2e specs (T45, T46) on DATABASE_URL_TEST, the database the e2e
// harness (`apps/api/test/e2e-seed.ts`) resets and serves; never production (AD-018).

let lookupPool: Pool | undefined;
function pool(): Pool {
  lookupPool ??= new Pool({ connectionString: e2eDatabaseUrl(), max: 2 });
  return lookupPool;
}

export async function closeHelpersDb(): Promise<void> {
  await lookupPool?.end();
  lookupPool = undefined;
}

export async function query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool().query<T>(sql, params);
  return rows;
}

export interface OutboxAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface OutboxEmail {
  id: string;
  template: string;
  attachments: OutboxAttachment[];
}

/** Outbox rows of one template for an address, oldest first (the API has no Resend key under e2e). */
export async function outboxEmails(to: string, template: string): Promise<OutboxEmail[]> {
  return query<OutboxEmail>(
    `select id, template, attachments from email_outbox where to_address = $1 and template = $2
      order by created_at`,
    [to, template],
  );
}

/** The decoded text of the e-mail's `.ics` attachment; throws when it has none. */
export function icsAttachmentOf(email: OutboxEmail): string {
  const ics = email.attachments.find((a) => a.filename.endsWith('.ics'));
  if (ics === undefined) throw new Error(`outbox ${email.id} has no .ics attachment`);
  return Buffer.from(ics.contentBase64, 'base64').toString('utf8');
}

export interface BookingCalendarRow {
  status: string;
  ics_uid: string;
  ics_sequence: number;
  starts_at: Date;
  ends_at: Date;
}

/** Status, calendar identity and times of a booking. */
export async function bookingCalendar(bookingId: string): Promise<BookingCalendarRow> {
  const [row] = await query<BookingCalendarRow>(
    `select status, ics_uid, ics_sequence, starts_at, ends_at from bookings where id = $1`,
    [bookingId],
  );
  if (row === undefined) throw new Error(`booking ${bookingId} missing`);
  return row;
}
