import { formatBRL, formatDateBR, formatDateTimeBR, formatTimeBR } from '@bravo/core';
import { renderLayout, type Rendered } from './layout';

// The 14 pt-BR núcleo e-mails (design.md "Mail and ICS"). Template names are the notification
// catalog's event names (packages/core/src/notifications/catalog.ts).

export const BOOKING_TEMPLATES = [
  'booking.confirmed',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.cancelled_nonpayment',
  'booking.reminder_24h',
  'booking.reminder_2h',
  'booking.balance_charge',
  'booking.balance_reminder',
  'booking.balance_charged',
  'booking.balance_card_failed',
  'booking.pre_reservation_link',
  'booking.pre_reservation_expired',
  'booking.late_approval_refund',
  'account.set_password',
] as const;
export type BookingTemplate = (typeof BOOKING_TEMPLATES)[number];

export interface BookingEmailData {
  name: string;
  code: string;
  roomName: string;
  startsAt: Date;
  endsAt: Date;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  /** Absolute link of the button (booking detail, payment page or checkout). */
  link: string;
  /** Balance deadline (`booking.balance_*`). */
  balanceDueAt?: Date | null;
  /** End of the hold (`booking.pre_reservation_link`). */
  holdExpiresAt?: Date | null;
  /** Amount returned to the customer (`booking.cancelled`, `booking.late_approval_refund`). */
  refundCents?: number;
  /** Alternative free slots offered after a late approval refund. */
  suggestions?: { startsAt: Date; endsAt: Date }[];
}

const FOOTNOTE = 'Dúvidas? Responda este e-mail ou fale com a recepção da Bravô Clinic.';

const slot = (d: BookingEmailData) =>
  `${formatDateBR(d.startsAt)} das ${formatTimeBR(d.startsAt)} às ${formatTimeBR(d.endsAt)}`;

const summary = (d: BookingEmailData) => `Reserva ${d.code}: ${d.roomName}, ${slot(d)}.`;

const amounts = (d: BookingEmailData) =>
  `Valor total ${formatBRL(d.totalCents)}, pago ${formatBRL(d.paidCents)}, saldo ${formatBRL(d.balanceCents)}.`;

function render(
  subject: string,
  heading: string,
  paragraphs: string[],
  cta: string,
  d: Pick<BookingEmailData, 'link'>,
): Rendered {
  const { html, text } = renderLayout({
    heading,
    paragraphs,
    cta: { label: cta, href: d.link },
    footnote: FOOTNOTE,
  });
  return { subject, html, text };
}

export function bookingConfirmedTemplate(d: BookingEmailData): Rendered {
  return render(
    `Reserva confirmada — ${d.code}`,
    'Reserva confirmada',
    [
      `Olá, ${d.name}! Sua reserva está confirmada.`,
      summary(d),
      amounts(d),
      'O convite de calendário (.ics) segue em anexo.',
    ],
    'Ver reserva',
    d,
  );
}

export function bookingRescheduledTemplate(d: BookingEmailData): Rendered {
  return render(
    `Reserva reagendada — ${d.code}`,
    'Reserva reagendada',
    [
      `Olá, ${d.name}! Sua reserva foi reagendada.`,
      `Novo horário: ${summary(d)}`,
      amounts(d),
      'O convite de calendário atualizado segue em anexo.',
    ],
    'Ver reserva',
    d,
  );
}

export function bookingCancelledTemplate(d: BookingEmailData): Rendered {
  const refund =
    d.refundCents !== undefined && d.refundCents > 0
      ? `Valor a ser devolvido: ${formatBRL(d.refundCents)}.`
      : 'Não há valor a ser devolvido.';
  return render(
    `Reserva cancelada — ${d.code}`,
    'Reserva cancelada',
    [`Olá, ${d.name}! Sua reserva foi cancelada.`, summary(d), refund],
    'Ver reserva',
    d,
  );
}

export function bookingCancelledNonpaymentTemplate(d: BookingEmailData): Rendered {
  return render(
    `Reserva cancelada por falta de pagamento — ${d.code}`,
    'Reserva cancelada por falta de pagamento',
    [
      `Olá, ${d.name}! O saldo da reserva não foi pago no prazo e ela foi cancelada.`,
      summary(d),
      `Saldo em aberto: ${formatBRL(d.balanceCents)}.`,
    ],
    'Ver reserva',
    d,
  );
}

export function bookingReminder24hTemplate(d: BookingEmailData): Rendered {
  return render(
    `Lembrete: sua reserva é amanhã — ${d.code}`,
    'Sua reserva é amanhã',
    [
      `Olá, ${d.name}! Lembrete da sua reserva.`,
      summary(d),
      `Início às ${formatTimeBR(d.startsAt)}.`,
    ],
    'Ver reserva',
    d,
  );
}

export function bookingReminder2hTemplate(d: BookingEmailData): Rendered {
  return render(
    `Lembrete: sua reserva começa em 2 horas — ${d.code}`,
    'Sua reserva começa em 2 horas',
    [`Olá, ${d.name}! Sua reserva começa em breve.`, summary(d)],
    'Ver reserva',
    d,
  );
}

function deadline(d: BookingEmailData): string {
  return d.balanceDueAt === undefined || d.balanceDueAt === null
    ? ''
    : ` Pague até ${formatDateTimeBR(d.balanceDueAt)} para manter a reserva.`;
}

export function bookingBalanceChargeTemplate(d: BookingEmailData): Rendered {
  return render(
    `Pague o saldo da reserva ${d.code}`,
    'Pagamento do saldo',
    [
      `Olá, ${d.name}! O saldo da sua reserva está disponível para pagamento.`,
      summary(d),
      `Saldo: ${formatBRL(d.balanceCents)}.${deadline(d)}`,
    ],
    'Pagar saldo',
    d,
  );
}

export function bookingBalanceReminderTemplate(d: BookingEmailData): Rendered {
  return render(
    `Lembrete: saldo da reserva ${d.code}`,
    'Lembrete do saldo',
    [
      `Olá, ${d.name}! O saldo da sua reserva ainda não foi pago.`,
      summary(d),
      `Saldo: ${formatBRL(d.balanceCents)}.${deadline(d)}`,
    ],
    'Pagar saldo',
    d,
  );
}

export function bookingBalanceChargedTemplate(d: BookingEmailData): Rendered {
  return render(
    `Saldo da reserva ${d.code} pago`,
    'Saldo pago',
    [`Olá, ${d.name}! Recebemos o pagamento do saldo da sua reserva.`, summary(d), amounts(d)],
    'Ver reserva',
    d,
  );
}

export function bookingBalanceCardFailedTemplate(d: BookingEmailData): Rendered {
  return render(
    `Não conseguimos cobrar o saldo da reserva ${d.code}`,
    'Falha na cobrança do saldo',
    [
      `Olá, ${d.name}! Não conseguimos cobrar o saldo no cartão salvo.`,
      summary(d),
      `Saldo: ${formatBRL(d.balanceCents)}.${deadline(d)}`,
    ],
    'Pagar saldo',
    d,
  );
}

export function bookingPreReservationLinkTemplate(d: BookingEmailData): Rendered {
  const hold =
    d.holdExpiresAt === undefined || d.holdExpiresAt === null
      ? ''
      : ` O horário fica reservado até ${formatDateTimeBR(d.holdExpiresAt)}.`;
  return render(
    `Sua pré-reserva ${d.code}: conclua o pagamento`,
    'Pré-reserva disponível',
    [
      `Olá, ${d.name}! A recepção reservou um horário para você.`,
      summary(d),
      `Valor total: ${formatBRL(d.totalCents)}.${hold}`,
    ],
    'Concluir pagamento',
    d,
  );
}

export function bookingPreReservationExpiredTemplate(d: BookingEmailData): Rendered {
  return render(
    `Pré-reserva ${d.code} expirada`,
    'Pré-reserva expirada',
    [
      `Olá, ${d.name}! O prazo de pagamento da sua pré-reserva terminou e o horário foi liberado.`,
      summary(d),
    ],
    'Reservar novamente',
    d,
  );
}

export function bookingLateApprovalRefundTemplate(d: BookingEmailData): Rendered {
  const refunded = d.refundCents ?? d.paidCents;
  const alternatives = (d.suggestions ?? []).map(
    (s) =>
      `${formatDateBR(s.startsAt)} das ${formatTimeBR(s.startsAt)} às ${formatTimeBR(s.endsAt)}`,
  );
  return render(
    `Pagamento estornado — reserva ${d.code}`,
    'Pagamento estornado',
    [
      `Olá, ${d.name}! Seu pagamento foi aprovado depois do prazo e o horário já havia sido reservado por outra pessoa.`,
      summary(d),
      `Estornamos ${formatBRL(refunded)} integralmente.`,
      alternatives.length > 0
        ? `Horários livres com a mesma duração: ${alternatives.join('; ')}.`
        : 'Veja outros horários livres no site.',
    ],
    'Escolher novo horário',
    d,
  );
}

export function setPasswordTemplate(input: { name: string; link: string }): Rendered {
  const { html, text } = renderLayout({
    heading: 'Defina sua senha',
    paragraphs: [
      `Olá, ${input.name}!`,
      'A recepção da Bravô Clinic criou sua conta. Defina uma senha pelo botão abaixo para acessar suas reservas. O link vale por 24 horas.',
    ],
    cta: { label: 'Definir senha', href: input.link },
    footnote: 'Se você não esperava este e-mail, ignore esta mensagem.',
  });
  return { subject: 'Defina sua senha na Bravô Clinic', html, text };
}
