import { describe, expect, it } from 'vitest';
import {
  chooseDiscount,
  couponDiscountCents,
  couponRejectMessage,
  discountNote,
  slotDiscountCents,
  validateCoupon,
  type CouponRow,
} from './discounts';
import type { PricedSegment } from './price';

const NBSP = ' ';

function segment(startMinute: number, endMinute: number, rateCentsPerHour: number): PricedSegment {
  const minutes = endMinute - startMinute;
  return {
    startMinute,
    endMinute,
    minutes,
    categoryId: 'cat',
    categoryName: '2 horas ou mais',
    dayType: 'weekday',
    rateCentsPerHour,
    amountCents: (rateCentsPerHour * minutes) / 60,
  };
}

describe('couponDiscountCents (REC-116)', () => {
  it('10% (1000 bp) on 21900 → 2190', () => {
    expect(couponDiscountCents(21900, { kind: 'percent', value: 1000 })).toBe(2190);
  });

  it('rounds a percent half up: 10% on 21905 → 2191', () => {
    expect(couponDiscountCents(21905, { kind: 'percent', value: 1000 })).toBe(2191);
  });

  it('fixed R$ 20,00 on 16000 → 2000', () => {
    expect(couponDiscountCents(16000, { kind: 'fixed', value: 2000 })).toBe(2000);
  });

  it('caps a fixed discount at the gross: R$ 500,00 on 16000 → 16000', () => {
    expect(couponDiscountCents(16000, { kind: 'fixed', value: 50000 })).toBe(16000);
  });
});

describe('slotDiscountCents (REC-142)', () => {
  const tuesday1416 = [segment(840, 960, 8000)];

  it('Tue 14:00–16:00 at 8000/h with 10% over all minutes → 1600', () => {
    expect(
      slotDiscountCents(tuesday1416, [{ startMinute: 840, endMinute: 960, percent: 10 }]),
    ).toBe(1600);
  });

  it('discounts only the overlapped minutes: 15:00–17:00 at 10% → 800', () => {
    expect(
      slotDiscountCents(tuesday1416, [{ startMinute: 900, endMinute: 1020, percent: 10 }]),
    ).toBe(800);
  });

  it('sums two discounts on one segment: 14:00–15:00 at 10% + 15:00–16:00 at 20% → 2400', () => {
    expect(
      slotDiscountCents(tuesday1416, [
        { startMinute: 840, endMinute: 900, percent: 10 },
        { startMinute: 900, endMinute: 960, percent: 20 },
      ]),
    ).toBe(2400);
  });

  it('applies each segment rate: Tue 17:30–20:00 with 15% on 19:00–20:00 → 1485', () => {
    const segments = [segment(1050, 1140, 8000), segment(1140, 1200, 9900)];
    expect(slotDiscountCents(segments, [{ startMinute: 1140, endMinute: 1200, percent: 15 }])).toBe(
      1485,
    );
  });

  it('rounds each part half up: 30 min at 9700/h with 15% → 727.5 → 728', () => {
    expect(
      slotDiscountCents(
        [segment(600, 630, 9700)],
        [{ startMinute: 600, endMinute: 630, percent: 15 }],
      ),
    ).toBe(728);
  });

  it('returns 0 when no discount overlaps (touching edges included)', () => {
    expect(
      slotDiscountCents(tuesday1416, [{ startMinute: 960, endMinute: 1020, percent: 50 }]),
    ).toBe(0);
    expect(slotDiscountCents(tuesday1416, [])).toBe(0);
  });
});

describe('chooseDiscount (REC-120)', () => {
  it('gross 16000, slot 1600, coupon 2000 → coupon, net 14000', () => {
    expect(chooseDiscount({ grossCents: 16000, slotCents: 1600, couponCents: 2000 })).toEqual({
      source: 'coupon',
      discountCents: 2000,
      netCents: 14000,
    });
  });

  it('keeps the slot discount when it is larger', () => {
    expect(chooseDiscount({ grossCents: 16000, slotCents: 2400, couponCents: 2000 })).toEqual({
      source: 'slot_discount',
      discountCents: 2400,
      netCents: 13600,
    });
  });

  it('keeps the slot discount on a tie', () => {
    expect(chooseDiscount({ grossCents: 16000, slotCents: 1600, couponCents: 1600 })).toEqual({
      source: 'slot_discount',
      discountCents: 1600,
      netCents: 14400,
    });
  });

  it('both zero → none, net = gross', () => {
    expect(chooseDiscount({ grossCents: 16000, slotCents: 0, couponCents: 0 })).toEqual({
      source: 'none',
      discountCents: 0,
      netCents: 16000,
    });
  });

  it('a coupon alone wins over no slot discount', () => {
    expect(chooseDiscount({ grossCents: 21900, slotCents: 0, couponCents: 2190 })).toEqual({
      source: 'coupon',
      discountCents: 2190,
      netCents: 19710,
    });
  });
});

describe('validateCoupon and couponRejectMessage (REC-117..REC-119, REC-126)', () => {
  const now = new Date('2026-11-10T15:00:00.000Z');
  const coupon: CouponRow = {
    type: 'discount',
    discountKind: 'percent',
    discountValue: 1000,
    appliesTo: 'both',
    maxUses: 100,
    usesCount: 3,
    perCustomerLimit: 1,
    validFrom: new Date('2026-11-01T03:00:00.000Z'),
    validUntil: new Date('2026-12-01T03:00:00.000Z'),
    enabled: true,
  };
  const ok = {
    coupon,
    now,
    target: 'booking' as const,
    customerPriorUses: 0,
    docHasPriorBooking: false,
  };

  it('accepts a valid coupon for a booking and for a package', () => {
    expect(validateCoupon(ok)).toEqual({ ok: true });
    expect(validateCoupon({ ...ok, target: 'package' })).toEqual({ ok: true });
  });

  it.each([
    ['not_found', { coupon: null }],
    ['disabled', { coupon: { ...coupon, enabled: false } }],
    ['exhausted', { coupon: { ...coupon, maxUses: 3, usesCount: 3 } }],
    ['expired', { now: new Date('2026-12-01T03:00:00.000Z') }],
    ['not_yet_valid', { now: new Date('2026-11-01T02:59:59.999Z') }],
    [
      'first_booking_only',
      {
        coupon: { ...coupon, type: 'first_booking', appliesTo: 'bookings' },
        docHasPriorBooking: true,
      },
    ],
    ['not_applicable', { coupon: { ...coupon, appliesTo: 'packages' } }],
    ['not_applicable', { coupon: { ...coupon, appliesTo: 'bookings' }, target: 'package' }],
    ['customer_limit', { customerPriorUses: 1 }],
  ] as const)('returns %s in its triggering case', (reason, patch) => {
    expect(validateCoupon({ ...ok, ...patch })).toEqual({
      ok: false,
      reason,
    });
  });

  it('accepts the bounds: validFrom = now, uses below max, unlimited uses and limit', () => {
    expect(validateCoupon({ ...ok, now: coupon.validFrom as Date })).toEqual({ ok: true });
    expect(validateCoupon({ ...ok, coupon: { ...coupon, usesCount: 99 } })).toEqual({ ok: true });
    expect(
      validateCoupon({
        ...ok,
        coupon: {
          ...coupon,
          maxUses: null,
          perCustomerLimit: null,
          validFrom: null,
          validUntil: null,
        },
        customerPriorUses: 50,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts a first-booking coupon for a document without prior booking', () => {
    expect(
      validateCoupon({
        ...ok,
        coupon: { ...coupon, type: 'first_booking', appliesTo: 'bookings' },
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    ['not_found', 'Cupom inexistente'],
    ['disabled', 'Cupom desabilitado'],
    ['exhausted', 'Cupom esgotado'],
    ['expired', 'Cupom expirado'],
    ['not_yet_valid', 'Cupom ainda não está válido'],
    ['first_booking_only', 'Válido só na primeira reserva'],
    ['not_applicable', 'Cupom não se aplica a esta compra'],
    ['customer_limit', 'Você já usou este cupom o número máximo de vezes'],
  ] as const)('message of %s is "%s"', (reason, message) => {
    expect(couponRejectMessage(reason)).toBe(message);
  });
});

describe('discountNote (REC-121)', () => {
  it('coupon R$ 20,00 over slot R$ 16,00', () => {
    expect(discountNote({ source: 'coupon', slotCents: 1600, couponCents: 2000 })).toBe(
      `Aplicamos o maior desconto: cupom R$${NBSP}20,00 (o desconto do horário era R$${NBSP}16,00).`,
    );
  });

  it('symmetric slot text when the slot discount wins or ties', () => {
    expect(discountNote({ source: 'slot_discount', slotCents: 2400, couponCents: 2000 })).toBe(
      `Aplicamos o maior desconto: desconto do horário R$${NBSP}24,00 (o cupom era R$${NBSP}20,00).`,
    );
    expect(discountNote({ source: 'slot_discount', slotCents: 1600, couponCents: 1600 })).toBe(
      `Aplicamos o maior desconto: desconto do horário R$${NBSP}16,00 (o cupom era R$${NBSP}16,00).`,
    );
  });

  it('no note when only one discount applied', () => {
    expect(discountNote({ source: 'coupon', slotCents: 0, couponCents: 2000 })).toBeNull();
    expect(discountNote({ source: 'slot_discount', slotCents: 1600, couponCents: 0 })).toBeNull();
    expect(discountNote({ source: 'none', slotCents: 0, couponCents: 0 })).toBeNull();
  });
});
