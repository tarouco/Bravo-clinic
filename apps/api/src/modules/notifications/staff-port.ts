import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { bookingCategories, bookings, charges, rooms, subscriptions, users } from '../../db/schema';
import type { NotificationPort, StaffEvent } from '../../extensions/registry';
import { SYSTEM_CONTEXT, withNotifications, type NotificationDeps } from './notifications.service';

// Gestao's `NotificationPort` (R8, T43): núcleo and receita call `notifyStaff(event, { entityId })`
// after their commit; the port emits `staff.<event>` in its own transaction and dispatches it
// after that commit. The staff dedupe key carries `entityId`, so a repeated notice (a replayed
// webhook, a retried job) queues nothing new. `payment_issue` has no toggle and is always sent.

type Details = Record<string, unknown>;

const BOOKING_EVENTS: readonly StaffEvent[] = [
  'new_booking',
  'booking_cancelled',
  'pre_reservation_expired',
];
const SUBSCRIPTION_EVENTS: readonly StaffEvent[] = ['new_subscription', 'renewal_failed'];

/** What the staff templates show and the callers' thin payloads lack (customer, room, date). */
async function detailsOf(tx: Tx, event: StaffEvent, payload: Details & { entityId: string }) {
  const details: Details = {};
  if (BOOKING_EVENTS.includes(event)) {
    const [row] = await tx
      .select({
        customerName: users.name,
        roomName: rooms.name,
        startsAt: bookings.startsAt,
        code: bookings.code,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .innerJoin(rooms, eq(rooms.id, bookings.roomId))
      .where(eq(bookings.id, payload.entityId));
    if (row !== undefined) Object.assign(details, row);
  }
  if (SUBSCRIPTION_EVENTS.includes(event)) {
    const [row] = await tx
      .select({ customerName: users.name, categoryName: bookingCategories.name })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .innerJoin(bookingCategories, eq(bookingCategories.id, subscriptions.categoryId))
      .where(eq(subscriptions.id, payload.entityId));
    if (row !== undefined) Object.assign(details, row);
  }
  const chargeId =
    event === 'payment_received'
      ? payload.entityId
      : typeof payload['chargeId'] === 'string'
        ? payload['chargeId']
        : undefined;
  if (chargeId !== undefined && event !== 'payment_issue') {
    const [row] = await tx
      .select({ customerName: users.name, amountCents: charges.amountCents })
      .from(charges)
      .innerJoin(users, eq(users.id, charges.userId))
      .where(eq(charges.id, chargeId));
    if (row !== undefined) Object.assign(details, row);
  }
  return details;
}

export function staffNotificationPort(deps: NotificationDeps): NotificationPort {
  return {
    async notifyStaff(event, payload) {
      await withNotifications(deps, SYSTEM_CONTEXT, async (tx, notify) => {
        const data = { ...payload, ...(await detailsOf(tx, event, payload)) };
        await notify({ name: `staff.${event}`, entityId: payload.entityId, data });
      });
    },
  };
}
