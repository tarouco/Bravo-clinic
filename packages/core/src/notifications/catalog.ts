import { settingsCatalog, type SettingValue } from '../settings/catalog';

// Notification event catalog (AD-025, gestao design "Notification catalog"). Every tenant and
// staff notice is one event here; `template` is the e-mail template name, equal to the event
// name, rendered by the owning feature.

/** Keys of the `notifications.events` setting: one admin toggle per staff event (GES-66). */
export type StaffEventKey = keyof SettingValue<'notifications.events'>;

export const STAFF_EVENT_KEYS = Object.keys(
  settingsCatalog['notifications.events'].default,
) as StaffEventKey[];

/** Data passed to `emit()`; push texts read only `when` (local date/time), ids and `url`. */
export type NotificationData = Record<string, unknown>;

export interface PushTemplate {
  title: (d: NotificationData) => string;
  body: (d: NotificationData) => string;
  url: (d: NotificationData) => string;
  tag: string;
}

export interface NotificationDefinition {
  audience: 'tenant' | 'staff';
  template: string;
  owner: 'nucleo' | 'receita' | 'gestao';
  push?: PushTemplate;
  staffToggle?: StaffEventKey;
}

function text(d: NotificationData, key: string): string {
  const value = d[key];
  return typeof value === 'string' ? value : '';
}

/** " de 27/10/2026 10:00" when `when` is given, otherwise "". */
function ofWhen(d: NotificationData): string {
  const when = text(d, 'when');
  return when === '' ? '' : ` de ${when}`;
}

function bookingUrl(d: NotificationData): string {
  const id = text(d, 'bookingId');
  return id === '' ? '/app/minhas-reservas' : `/app/minhas-reservas/${id}`;
}

/** A site-relative `url` from the data, else `fallback`. */
function linkOr(fallback: (d: NotificationData) => string) {
  return (d: NotificationData) => {
    const url = text(d, 'url');
    return url.startsWith('/') ? url : fallback(d);
  };
}

function bookingPush(
  tag: string,
  title: string,
  body: (d: NotificationData) => string,
  url: (d: NotificationData) => string = bookingUrl,
): PushTemplate {
  return { title: () => title, body, url, tag };
}

function startsAt(d: NotificationData): string {
  const when = text(d, 'when');
  return when === '' ? 'Confira os detalhes no app.' : `Início: ${when}.`;
}

function fixedPush(tag: string, title: string, body: string, url: string): PushTemplate {
  return { title: () => title, body: () => body, url: () => url, tag };
}

const PURCHASES = '/app/compras';

function nucleo(push?: PushTemplate) {
  return { audience: 'tenant', owner: 'nucleo', ...(push ? { push } : {}) } as const;
}

function receita(tag: string, title: string, body: string, url: string = PURCHASES) {
  return { audience: 'tenant', owner: 'receita', push: fixedPush(tag, title, body, url) } as const;
}

function staff(staffToggle?: StaffEventKey) {
  return { audience: 'staff', owner: 'gestao', ...(staffToggle ? { staffToggle } : {}) } as const;
}

const definitions = {
  'booking.confirmed': nucleo(
    bookingPush('booking.confirmed', 'Reserva confirmada', (d) => {
      return `Sua reserva${ofWhen(d)} está confirmada.`;
    }),
  ),
  'booking.balance_charge': nucleo(
    bookingPush('booking.balance_charge', 'Pagamento do saldo', (d) => {
      return `O pagamento do saldo da sua reserva${ofWhen(d)} está disponível.`;
    }),
  ),
  'booking.balance_reminder': nucleo(
    bookingPush('booking.balance_reminder', 'Pagamento do saldo', (d) => {
      return `Lembrete: pague o saldo da sua reserva${ofWhen(d)}.`;
    }),
  ),
  'booking.balance_charged': nucleo(
    bookingPush('booking.balance_charged', 'Pagamento do saldo', (d) => {
      return `O saldo da sua reserva${ofWhen(d)} foi pago.`;
    }),
  ),
  'booking.balance_card_failed': nucleo(
    bookingPush('booking.balance_card_failed', 'Pagamento do saldo', (d) => {
      return `Não conseguimos cobrar o saldo da sua reserva${ofWhen(d)} no cartão.`;
    }),
  ),
  'booking.reminder_24h': nucleo(
    bookingPush('booking.reminder_24h', 'Sua reserva é amanhã', startsAt),
  ),
  'booking.reminder_2h': nucleo(
    bookingPush('booking.reminder_2h', 'Sua reserva começa em 2h', startsAt),
  ),
  'booking.cancelled': nucleo(
    bookingPush('booking.cancelled', 'Reserva cancelada', (d) => {
      return `Sua reserva${ofWhen(d)} foi cancelada.`;
    }),
  ),
  'booking.cancelled_nonpayment': nucleo(
    bookingPush('booking.cancelled_nonpayment', 'Reserva cancelada', (d) => {
      return `Sua reserva${ofWhen(d)} foi cancelada por falta de pagamento.`;
    }),
  ),
  'booking.rescheduled': nucleo(
    bookingPush('booking.rescheduled', 'Reserva reagendada', (d) => {
      const when = text(d, 'when');
      return when === ''
        ? 'Sua reserva foi reagendada.'
        : `Sua reserva foi reagendada para ${when}.`;
    }),
  ),
  'booking.pre_reservation_link': nucleo(
    bookingPush(
      'booking.pre_reservation_link',
      'Pré-reserva disponível',
      (d) => `Conclua o pagamento da sua pré-reserva${ofWhen(d)}.`,
      linkOr(bookingUrl),
    ),
  ),
  'booking.pre_reservation_expired': nucleo(
    bookingPush('booking.pre_reservation_expired', 'Pré-reserva expirada', (d) => {
      return `Sua pré-reserva${ofWhen(d)} expirou.`;
    }),
  ),
  'booking.late_approval_refund': nucleo(
    bookingPush('booking.late_approval_refund', 'Pagamento estornado', (d) => {
      return `O pagamento da sua reserva${ofWhen(d)} foi aprovado após o prazo e será estornado.`;
    }),
  ),
  'account.set_password': nucleo(),
  'subscription.activated': receita(
    'subscription.activated',
    'Assinatura ativada',
    'Sua assinatura está ativa.',
  ),
  'subscription.renewal_charge': receita(
    'subscription.renewal_charge',
    'Renovação da assinatura',
    'A cobrança da renovação da sua assinatura foi gerada.',
  ),
  'subscription.renewal_reminder': receita(
    'subscription.renewal_reminder',
    'Renovação da assinatura',
    'Lembrete: pague a renovação da sua assinatura.',
  ),
  'subscription.renewal_approved': receita(
    'subscription.renewal_approved',
    'Renovação aprovada',
    'A renovação da sua assinatura foi aprovada.',
  ),
  'subscription.renewal_failed': receita(
    'subscription.renewal_failed',
    'Falha na renovação',
    'Não conseguimos renovar sua assinatura.',
  ),
  'subscription.suspended': receita(
    'subscription.suspended',
    'Assinatura suspensa',
    'Sua assinatura foi suspensa.',
  ),
  'subscription.ended': receita(
    'subscription.ended',
    'Assinatura encerrada',
    'Sua assinatura foi encerrada.',
  ),
  'subscription.cancelled': receita(
    'subscription.cancelled',
    'Assinatura cancelada',
    'Sua assinatura foi cancelada.',
  ),
  'subscription.switched': receita(
    'subscription.switched',
    'Assinatura alterada',
    'Sua assinatura foi alterada.',
  ),
  'subscription.period_ending': receita(
    'subscription.period_ending',
    'Período terminando',
    'O período da sua assinatura está terminando.',
  ),
  'subscription.price_change': receita(
    'subscription.price_change',
    'Novo preço da assinatura',
    'O preço da sua assinatura vai mudar.',
  ),
  'subscription.next_period_conflicts': receita(
    'subscription.next_period_conflicts',
    'Horários em conflito',
    'Alguns horários do próximo período estão em conflito.',
  ),
  'subscription.sale_link': {
    audience: 'tenant',
    owner: 'receita',
    push: {
      title: () => 'Pagamento da assinatura',
      body: () => 'Conclua o pagamento da sua assinatura.',
      url: linkOr(() => PURCHASES),
      tag: 'subscription.sale_link',
    },
  },
  'subscription.compensation': receita(
    'subscription.compensation',
    'Compensação de dia fechado',
    'Você recebeu uma compensação por um dia fechado.',
  ),
  'extra_hours.purchased': receita(
    'extra_hours.purchased',
    'Horas extras compradas',
    'Suas horas extras estão disponíveis.',
    '/app/compras/horas-extras',
  ),
  'credit.granted': receita(
    'credit.granted',
    'Crédito concedido',
    'Você recebeu um crédito.',
    '/app/compras/creditos',
  ),
  'payment.late_refund': receita(
    'payment.late_refund',
    'Pagamento estornado',
    'Um pagamento aprovado após o prazo será estornado.',
    '/app/compras/historico',
  ),
  'subscription.card_reregister': {
    audience: 'tenant',
    owner: 'gestao',
    push: fixedPush(
      'subscription.card_reregister',
      'Atualize seu cartão',
      'Cadastre seu cartão novamente para manter a renovação automática.',
      '/app/perfil/cartoes',
    ),
  },
  'quote.received': { audience: 'tenant', owner: 'gestao' },
  'privacy.account_deleted': { audience: 'tenant', owner: 'gestao' },
  'staff.new_booking': staff('new_booking'),
  'staff.payment_received': staff('payment_received'),
  'staff.booking_cancelled': staff('booking_cancelled'),
  'staff.new_subscription': staff('new_subscription'),
  'staff.renewal_failed': staff('renewal_failed'),
  'staff.pre_reservation_expired': staff('pre_reservation_expired'),
  'staff.new_quote_request': staff('new_quote_request'),
  'staff.payment_issue': staff(),
  'staff.holiday_review': staff(),
  'staff.invite': staff(),
  'system.test': staff(),
} satisfies Record<string, Omit<NotificationDefinition, 'template'>>;

export type NotificationEvent = keyof typeof definitions;

export const NOTIFICATION_EVENTS = Object.keys(definitions) as NotificationEvent[];

export const notificationCatalog = Object.fromEntries(
  NOTIFICATION_EVENTS.map((event) => [event, { ...definitions[event], template: event }]),
) as Record<NotificationEvent, NotificationDefinition>;
