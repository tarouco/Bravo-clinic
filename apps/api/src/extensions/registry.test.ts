import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRegistry, notifyStaffAfterCommit, STAFF_EVENTS, type CheckoutStep } from './registry';

afterEach(() => {
  vi.restoreAllMocks();
});

const step = (name: string, order: number): CheckoutStep => ({
  name,
  order,
  apply: (_ctx, draft) => Promise.resolve(draft),
});

describe('registry defaults (NUC-201)', () => {
  it('has no checkout steps, decorators, category handlers or charge handlers', () => {
    const registry = createRegistry();

    expect(registry.checkoutSteps).toEqual([]);
    expect(registry.availabilityDecorators).toEqual([]);
    expect(registry.categoryHandlers).toEqual([]);
    expect(registry.chargeHandlers).toEqual({});
  });

  it('registers payment-mode handlers for deposit_balance, full_upfront and manual only', () => {
    const modes = createRegistry().paymentModeHandlers.map((handler) => handler.mode);

    expect(modes).toEqual(['deposit_balance', 'full_upfront', 'manual']);
  });

  it('installs a deferred credit port with 0 available that grants no credit lot', async () => {
    const { credits } = createRegistry();

    const available = await credits.availableCents({} as never, 'user-1', new Date());
    const grant = await credits.grant({} as never, {
      userId: 'user-1',
      amountCents: 14300,
      source: 'reschedule_difference',
      refType: 'booking',
      refId: 'booking-1',
      ctx: { actorUserId: null, actorRole: null, origin: 'app', ip: null, requestId: null },
    });

    expect(credits.mode).toBe('deferred');
    expect(available).toBe(0);
    expect(grant).toEqual({ creditLotId: null });
  });

  it('returns zero closed-day compensation and applies nothing', async () => {
    const { closedDayCompensation } = createRegistry();

    const preview = await closedDayCompensation.preview({} as never, {
      date: '2026-10-27',
      roomIds: null,
    });

    expect(preview).toEqual({
      subscribers: 0,
      minutes: 0,
      creditCents: 0,
      fixedOccurrencesCancelled: 0,
    });
    await expect(closedDayCompensation.apply({} as never, ['id'], {} as never)).resolves.toBeUndefined();
  });

  it('accepts the 7 staff events in the no-op notifier and returns a null photo URL', async () => {
    const { notifications, roomMedia } = createRegistry();

    for (const event of STAFF_EVENTS) {
      await expect(notifications.notifyStaff(event, { entityId: 'x' })).resolves.toBeUndefined();
    }
    expect([...STAFF_EVENTS]).toEqual([
      'new_booking',
      'payment_received',
      'booking_cancelled',
      'pre_reservation_expired',
      'payment_issue',
      'new_subscription',
      'renewal_failed',
    ]);
    expect(roomMedia.photoUrl('rooms/a.webp')).toBeNull();
  });

  it('returns independent registries so a registration never leaks into another one', () => {
    const first = createRegistry();
    first.checkoutSteps.push(step('extras', 300));

    expect(createRegistry().checkoutSteps).toEqual([]);
  });
});

describe('createRegistry overrides', () => {
  it('sorts checkout steps by ascending order', () => {
    const registry = createRegistry({
      checkoutSteps: [step('credit', 400), step('discount', 100), step('extras', 300)],
    });

    expect(registry.checkoutSteps.map((s) => s.name)).toEqual(['discount', 'extras', 'credit']);
  });

  it('replaces a port with the override and keeps the other defaults', () => {
    const registry = createRegistry({ roomMedia: { photoUrl: (key) => `/media/${key}` } });

    expect(registry.roomMedia.photoUrl('a.webp')).toBe('/media/a.webp');
    expect(registry.credits.mode).toBe('deferred');
  });
});

describe('notifyStaffAfterCommit (NUC-205)', () => {
  it('logs a throwing notifier with the request id and never rethrows', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const registry = createRegistry({
      notifications: { notifyStaff: () => Promise.reject(new Error('push provider down')) },
    });

    await expect(
      notifyStaffAfterCommit(registry, 'new_booking', { entityId: 'booking-1' }, { requestId: 'req-123456' }),
    ).resolves.toBeUndefined();

    const lines = write.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      requestId: 'req-123456',
      event: 'new_booking',
      entityId: 'booking-1',
      error: { message: 'push provider down' },
    });
  });

  it('passes the event and payload to a working notifier', async () => {
    const notifyStaff = vi.fn(() => Promise.resolve());
    const registry = createRegistry({ notifications: { notifyStaff } });

    await notifyStaffAfterCommit(
      registry,
      'payment_received',
      { entityId: 'charge-1', amountCents: 10950 },
      { requestId: null },
    );

    expect(notifyStaff).toHaveBeenCalledWith('payment_received', {
      entityId: 'charge-1',
      amountCents: 10950,
    });
  });
});
