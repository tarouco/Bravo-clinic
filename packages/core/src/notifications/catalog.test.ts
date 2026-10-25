import { describe, expect, it } from 'vitest';
import { settingDefaults } from '../settings/catalog';
import {
  NOTIFICATION_EVENTS,
  notificationCatalog,
  STAFF_EVENT_KEYS,
  type NotificationEvent,
} from './catalog';

const entries = Object.entries(notificationCatalog) as [
  NotificationEvent,
  (typeof notificationCatalog)[NotificationEvent],
][];

function eventsOwnedBy(owner: 'nucleo' | 'receita' | 'gestao'): string[] {
  return entries
    .filter(([, def]) => def.owner === owner)
    .map(([event]) => event)
    .sort();
}

// Template lists of the producers: nucleo design (bookingMailer) and receita REC-159.
const NUCLEO_TEMPLATES = [
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
];
const RECEITA_TEMPLATES = [
  'subscription.activated',
  'subscription.renewal_charge',
  'subscription.renewal_reminder',
  'subscription.renewal_approved',
  'subscription.renewal_failed',
  'subscription.suspended',
  'subscription.ended',
  'subscription.cancelled',
  'subscription.switched',
  'subscription.period_ending',
  'subscription.price_change',
  'subscription.next_period_conflicts',
  'subscription.sale_link',
  'extra_hours.purchased',
  'credit.granted',
  'subscription.compensation',
  'payment.late_refund',
];
const GESTAO_EVENTS = [
  'subscription.card_reregister',
  'quote.received',
  'privacy.account_deleted',
  'staff.new_booking',
  'staff.payment_received',
  'staff.booking_cancelled',
  'staff.new_subscription',
  'staff.renewal_failed',
  'staff.pre_reservation_expired',
  'staff.new_quote_request',
  'staff.payment_issue',
  'staff.holiday_review',
  'staff.invite',
  'system.test',
];

describe('notification catalog (AD-025)', () => {
  it('maps every notifications.events toggle to exactly one staff.* entry (GES-66, GES-67)', () => {
    const toggles = Object.keys(settingDefaults()['notifications.events']);
    expect([...STAFF_EVENT_KEYS].sort()).toEqual([...toggles].sort());
    for (const key of toggles) {
      const matches = entries.filter(([, def]) => def.staffToggle === key);
      expect(
        matches.map(([event]) => event),
        key,
      ).toEqual([`staff.${key}`]);
      expect(matches[0]?.[1].audience).toBe('staff');
    }
  });

  it('sends staff.payment_issue without a toggle (always sent)', () => {
    expect(notificationCatalog['staff.payment_issue'].audience).toBe('staff');
    expect(notificationCatalog['staff.payment_issue'].staffToggle).toBeUndefined();
  });

  it('names each template after its event, owned as the producers list them', () => {
    for (const [event, def] of entries) expect(def.template, event).toBe(event);
    expect(eventsOwnedBy('nucleo')).toEqual([...NUCLEO_TEMPLATES].sort());
    expect(eventsOwnedBy('receita')).toEqual([...RECEITA_TEMPLATES].sort());
    expect(eventsOwnedBy('gestao')).toEqual([...GESTAO_EVENTS].sort());
    expect(NOTIFICATION_EVENTS).toHaveLength(
      NUCLEO_TEMPLATES.length + RECEITA_TEMPLATES.length + GESTAO_EVENTS.length,
    );
  });

  it('defines push only for tenant events marked with push in the design table (GES-78)', () => {
    const withoutPush = [
      'account.set_password',
      'quote.received',
      'privacy.account_deleted',
      ...GESTAO_EVENTS.filter((e) => e.startsWith('staff.') || e === 'system.test'),
    ];
    for (const [event, def] of entries) {
      if (withoutPush.includes(event)) {
        expect(def.push, event).toBeUndefined();
      } else {
        expect(def.audience, event).toBe('tenant');
        expect(def.push, event).toBeDefined();
      }
    }
  });

  it('uses the push titles of the design table', () => {
    const title = (event: NotificationEvent) => notificationCatalog[event].push?.title({});
    expect(title('booking.confirmed')).toBe('Reserva confirmada');
    for (const event of [
      'booking.balance_charge',
      'booking.balance_reminder',
      'booking.balance_charged',
      'booking.balance_card_failed',
    ] as const) {
      expect(title(event), event).toBe('Pagamento do saldo');
    }
    expect(title('booking.reminder_24h')).toBe('Sua reserva é amanhã');
    expect(title('booking.reminder_2h')).toBe('Sua reserva começa em 2h');
    expect(title('booking.cancelled')).toBe('Reserva cancelada');
    expect(title('booking.cancelled_nonpayment')).toBe('Reserva cancelada');
    expect(title('booking.rescheduled')).toBe('Reserva reagendada');
    expect(title('subscription.card_reregister')).toBe('Atualize seu cartão');
  });

  it('builds the booking push from the booking time and links to the booking (GES-78, GES-82)', () => {
    const push = notificationCatalog['booking.confirmed'].push;
    const data = { bookingId: 'b1', when: '27/10/2026 10:00' };
    expect(push?.body(data)).toBe('Sua reserva de 27/10/2026 10:00 está confirmada.');
    expect(push?.url(data)).toBe('/app/minhas-reservas/b1');
    expect(push?.tag).toBe('booking.confirmed');
  });
});
