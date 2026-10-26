import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createBooking, createUser } from '../../../test/factories';
import { testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createDb, withTransaction } from '../../db/client';
import { emailOutbox, rooms } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { dispatchEmails } from '../../lib/email';
import { bookingMailer, loadBookingMailContext } from './booking-mailer';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const STARTS = new Date('2026-10-27T13:00:00.000Z');
const ENDS = new Date('2026-10-27T15:00:00.000Z');

let roomId = '';

beforeEach(async () => {
  await runSeed(db);
  const [room] = await db.select().from(rooms).limit(1);
  roomId = room?.id ?? '';
});

async function setup() {
  const user = await createUser(db, { name: 'Ana', email: 'ana@bravoclinic.test' });
  const booking = await createBooking(db, {
    userId: user.id,
    roomId,
    startsAt: STARTS,
    endsAt: ENDS,
    cleanupMinutes: 30,
  });
  const ctx = await loadBookingMailContext(db, booking, testEnv());
  return { booking, ctx };
}

interface StoredAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

const icsOf = (attachment: StoredAttachment | undefined) =>
  Buffer.from(attachment?.contentBase64 ?? '', 'base64').toString('utf8');

describe('bookingMailer (NUC-136, NUC-137, NUC-139)', () => {
  it('confirmed queues "Reserva confirmada — <código>" with a REQUEST .ics attachment', async () => {
    const { booking, ctx } = await setup();

    const id = await withTransaction(db, (tx) => bookingMailer.confirmed(tx, booking, ctx));

    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
    expect(row).toMatchObject({
      toAddress: 'ana@bravoclinic.test',
      template: 'booking.confirmed',
      subject: `Reserva confirmada — ${booking.code}`,
      status: 'pending',
    });
    const attachments = row?.attachments as StoredAttachment[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.filename).toBe(`reserva-${booking.code}.ics`);
    const ics = icsOf(attachments[0]);
    expect(ics).toContain('METHOD:REQUEST\r\n');
    expect(ics).toContain(`UID:${booking.icsUid}\r\n`);
    // The booking's own times: the 30 minutes of cleanup are not part of the event.
    expect(ics).toContain('DTSTART:20261027T130000Z\r\n');
    expect(ics).toContain('DTEND:20261027T150000Z\r\n');
  });

  it('queues confirmed once per booking (first confirmation only)', async () => {
    const { booking, ctx } = await setup();

    const first = await withTransaction(db, (tx) => bookingMailer.confirmed(tx, booking, ctx));
    const second = await withTransaction(db, (tx) => bookingMailer.confirmed(tx, booking, ctx));

    expect(second).toBe(first);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
  });

  it('cancelled attaches METHOD:CANCEL with the same UID and the bumped SEQUENCE', async () => {
    const { booking, ctx } = await setup();

    const id = await withTransaction(db, (tx) =>
      bookingMailer.cancelled(tx, { ...booking, icsSequence: 1 }, ctx, { refundCents: 4850 }),
    );

    const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
    const ics = icsOf((row?.attachments as StoredAttachment[])[0]);
    expect(ics).toContain('METHOD:CANCEL\r\n');
    expect(ics).toContain(`UID:${booking.icsUid}\r\n`);
    expect(ics).toContain('SEQUENCE:1\r\n');
  });

  it('reminders dedupe on booking_reminder:<id>:24 and :2', async () => {
    const { booking, ctx } = await setup();

    await withTransaction(db, async (tx) => {
      await bookingMailer.reminder24h(tx, booking, ctx);
      await bookingMailer.reminder24h(tx, booking, ctx);
      await bookingMailer.reminder2h(tx, booking, ctx);
    });

    const rows = await db.select().from(emailOutbox);
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual([
      `booking_reminder:${booking.id}:2`,
      `booking_reminder:${booking.id}:24`,
    ]);
  });

  it('dispatch sends the attachment to the provider as base64 content', async () => {
    const { booking, ctx } = await setup();
    const id = await withTransaction(db, (tx) => bookingMailer.confirmed(tx, booking, ctx));
    const sent: {
      attachments?: { filename: string; content: string; content_type: string }[];
    }[] = [];
    const fetchStub: typeof fetch = (_url, init) => {
      sent.push(JSON.parse(init?.body as string) as (typeof sent)[number]);
      return Promise.resolve(new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    };

    await dispatchEmails(db, [id], {
      env: testEnv({ RESEND_API_KEY: 're_test_key' }),
      fetch: fetchStub,
    });

    const attachment = sent[0]?.attachments?.[0];
    expect(attachment?.filename).toBe(`reserva-${booking.code}.ics`);
    expect(attachment?.content_type).toContain('text/calendar');
    expect(Buffer.from(attachment?.content ?? '', 'base64').toString('utf8')).toContain(
      'BEGIN:VCALENDAR',
    );
  });

  it('every other helper queues its catalog template; only rescheduled carries an .ics', async () => {
    const { booking, ctx } = await setup();

    await withTransaction(db, async (tx) => {
      await bookingMailer.rescheduled(tx, { ...booking, icsSequence: 1 }, ctx);
      await bookingMailer.cancelledNonpayment(tx, booking, ctx);
      await bookingMailer.balanceCharge(tx, booking, ctx);
      await bookingMailer.balanceReminder(tx, booking, ctx, { hoursBefore: 36 });
      await bookingMailer.balanceCharged(tx, booking, ctx, { chargeId: 'c1' });
      await bookingMailer.balanceCardFailed(tx, booking, ctx, { chargeId: 'c1' });
      await bookingMailer.preReservationLink(tx, booking, ctx, { link: 'https://x.test/p/t' });
      await bookingMailer.preReservationExpired(tx, booking, ctx);
      await bookingMailer.lateApprovalRefund(tx, booking, ctx, {
        chargeId: 'c2',
        refundCents: 4850,
        suggestions: [],
      });
      await bookingMailer.setPassword(
        tx,
        { name: 'Bia', email: 'bia@bravoclinic.test' },
        { link: 'https://x.test/?token=t' },
      );
    });

    const rows = await db.select().from(emailOutbox);
    expect(rows.map((r) => r.template).sort()).toEqual([
      'account.set_password',
      'booking.balance_card_failed',
      'booking.balance_charge',
      'booking.balance_charged',
      'booking.balance_reminder',
      'booking.cancelled_nonpayment',
      'booking.late_approval_refund',
      'booking.pre_reservation_expired',
      'booking.pre_reservation_link',
      'booking.rescheduled',
    ]);
    expect(rows.find((r) => r.template === 'booking.balance_reminder')?.dedupeKey).toBe(
      `balance_reminder:${booking.id}:36`,
    );
    const withIcs = rows.filter((r) => (r.attachments as unknown[]).length > 0);
    expect(withIcs.map((r) => r.template).sort()).toEqual([
      'booking.cancelled_nonpayment',
      'booking.rescheduled',
    ]);
  });
});
