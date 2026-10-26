import { formatBRL } from '@bravo/core';
import { describe, expect, it } from 'vitest';
import {
  BOOKING_TEMPLATES,
  bookingBalanceCardFailedTemplate,
  bookingBalanceChargeTemplate,
  bookingBalanceChargedTemplate,
  bookingBalanceReminderTemplate,
  bookingCancelledNonpaymentTemplate,
  bookingCancelledTemplate,
  bookingConfirmedTemplate,
  bookingLateApprovalRefundTemplate,
  bookingPreReservationExpiredTemplate,
  bookingPreReservationLinkTemplate,
  bookingReminder24hTemplate,
  bookingReminder2hTemplate,
  bookingRescheduledTemplate,
  setPasswordTemplate,
  type BookingEmailData,
} from './booking';

// 2026-10-27 13:00Z is 10:00 in São Paulo (UTC-3), so the e-mail shows local time.
const data: BookingEmailData = {
  name: 'Ana',
  code: 'BRV-ABC123',
  roomName: 'Sala Bravô',
  startsAt: new Date('2026-10-27T13:00:00.000Z'),
  endsAt: new Date('2026-10-27T15:00:00.000Z'),
  totalCents: 21900,
  paidCents: 10950,
  balanceCents: 10950,
  link: 'https://bravoclinic.test/app/minhas-reservas/abc',
  balanceDueAt: new Date('2026-10-26T13:00:00.000Z'),
  holdExpiresAt: new Date('2026-10-20T15:30:00.000Z'),
  refundCents: 10950,
  suggestions: [
    {
      startsAt: new Date('2026-10-28T13:00:00.000Z'),
      endsAt: new Date('2026-10-28T15:00:00.000Z'),
    },
    {
      startsAt: new Date('2026-10-29T17:00:00.000Z'),
      endsAt: new Date('2026-10-29T19:00:00.000Z'),
    },
    {
      startsAt: new Date('2026-10-30T13:00:00.000Z'),
      endsAt: new Date('2026-10-30T15:00:00.000Z'),
    },
  ],
};

const SUBJECTS: [
  string,
  (d: BookingEmailData) => { subject: string; html: string; text: string },
  string,
][] = [
  ['booking.confirmed', bookingConfirmedTemplate, 'Reserva confirmada — BRV-ABC123'],
  ['booking.rescheduled', bookingRescheduledTemplate, 'Reserva reagendada — BRV-ABC123'],
  ['booking.cancelled', bookingCancelledTemplate, 'Reserva cancelada — BRV-ABC123'],
  [
    'booking.cancelled_nonpayment',
    bookingCancelledNonpaymentTemplate,
    'Reserva cancelada por falta de pagamento — BRV-ABC123',
  ],
  [
    'booking.reminder_24h',
    bookingReminder24hTemplate,
    'Lembrete: sua reserva é amanhã — BRV-ABC123',
  ],
  [
    'booking.reminder_2h',
    bookingReminder2hTemplate,
    'Lembrete: sua reserva começa em 2 horas — BRV-ABC123',
  ],
  ['booking.balance_charge', bookingBalanceChargeTemplate, 'Pague o saldo da reserva BRV-ABC123'],
  [
    'booking.balance_reminder',
    bookingBalanceReminderTemplate,
    'Lembrete: saldo da reserva BRV-ABC123',
  ],
  ['booking.balance_charged', bookingBalanceChargedTemplate, 'Saldo da reserva BRV-ABC123 pago'],
  [
    'booking.balance_card_failed',
    bookingBalanceCardFailedTemplate,
    'Não conseguimos cobrar o saldo da reserva BRV-ABC123',
  ],
  [
    'booking.pre_reservation_link',
    bookingPreReservationLinkTemplate,
    'Sua pré-reserva BRV-ABC123: conclua o pagamento',
  ],
  [
    'booking.pre_reservation_expired',
    bookingPreReservationExpiredTemplate,
    'Pré-reserva BRV-ABC123 expirada',
  ],
  [
    'booking.late_approval_refund',
    bookingLateApprovalRefundTemplate,
    'Pagamento estornado — reserva BRV-ABC123',
  ],
];

describe('booking e-mail templates (NUC-136)', () => {
  it.each(SUBJECTS)('%s has the subject of the notification catalog', (_name, render, subject) => {
    expect(render(data).subject).toBe(subject);
  });

  it('confirmed: subject "Reserva confirmada — <código>"', () => {
    expect(bookingConfirmedTemplate(data).subject).toBe('Reserva confirmada — BRV-ABC123');
  });

  it.each(SUBJECTS)(
    '%s html and text carry code, room, local date/time and the link',
    (_n, render) => {
      const { html, text } = render(data);

      for (const part of ['BRV-ABC123', 'Sala Bravô', '27/10/2026', '10:00', '12:00', data.link]) {
        expect(html).toContain(part);
        expect(text).toContain(part);
      }
    },
  );

  it('confirmed: html shows total, paid and balance amounts', () => {
    const { html } = bookingConfirmedTemplate(data);

    expect(html).toContain(formatBRL(21900));
    expect(html).toContain(formatBRL(10950));
    expect(html).toContain('Valor total R$');
  });

  it('balance charge: shows the balance and the local deadline', () => {
    const { html } = bookingBalanceChargeTemplate(data);

    expect(html).toContain(`Saldo: ${formatBRL(10950)}`);
    expect(html).toContain('Pague até 26/10/2026 10:00');
  });

  it('cancelled: shows the refund amount, or says there is none', () => {
    expect(bookingCancelledTemplate(data).html).toContain(
      `Valor a ser devolvido: ${formatBRL(10950)}`,
    );
    expect(bookingCancelledTemplate({ ...data, refundCents: 0 }).html).toContain(
      'Não há valor a ser devolvido',
    );
  });

  it('pre-reservation link: shows the hold deadline in local time', () => {
    expect(bookingPreReservationLinkTemplate(data).html).toContain(
      'reservado até 20/10/2026 12:30',
    );
  });

  it('late approval refund: lists the 3 suggested slots in local time', () => {
    const { html } = bookingLateApprovalRefundTemplate(data);

    expect(html).toContain('28/10/2026 das 10:00 às 12:00');
    expect(html).toContain('29/10/2026 das 14:00 às 16:00');
    expect(html).toContain('30/10/2026 das 10:00 às 12:00');
    expect(html).toContain(`Estornamos ${formatBRL(10950)}`);
  });

  it('escapes the customer-controlled name in html but not in text', () => {
    const { html, text } = bookingConfirmedTemplate({ ...data, name: '<b>Ana</b>' });

    expect(html).not.toContain('<b>Ana</b>');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(text).toContain('<b>Ana</b>');
  });
});

describe('account.set_password template', () => {
  it('carries the set-password link and a subject', () => {
    const { subject, html } = setPasswordTemplate({ name: 'Ana', link: 'https://x.test/?token=t' });

    expect(subject).toBe('Defina sua senha na Bravô Clinic');
    expect(html).toContain('https://x.test/?token=t');
  });
});

describe('BOOKING_TEMPLATES', () => {
  it('names the 14 núcleo templates of the notification catalog', () => {
    expect(BOOKING_TEMPLATES).toHaveLength(14);
    expect(new Set(BOOKING_TEMPLATES).size).toBe(14);
  });
});
