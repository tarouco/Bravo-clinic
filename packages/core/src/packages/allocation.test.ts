import { describe, expect, it } from 'vitest';
import { allocateCredits, allocateMinutes, allocateRefund, type MinuteLot } from './allocation';

const now = new Date('2026-11-10T15:00:00.000Z');
const bookingStartsAt = new Date('2026-11-18T22:00:00.000Z');
const day = (d: number) => new Date(`2027-01-${String(d).padStart(2, '0')}T15:00:00.000Z`);

describe('allocateMinutes (REC-25, REC-26)', () => {
  const lots: MinuteLot[] = [
    { id: 'late', remaining: 100, expiresAt: day(20) },
    { id: 'early', remaining: 20, expiresAt: day(10) },
  ];

  it('takes package minutes first, then lots by expiry ascending', () => {
    expect(
      allocateMinutes({
        debit: 78,
        packageAvailable: 50,
        lots,
        bookingStartsAt,
        now,
        usePackage: true,
      }),
    ).toEqual({
      fromPackage: 50,
      fromLots: [
        { lotId: 'early', minutes: 20 },
        { lotId: 'late', minutes: 8 },
      ],
      sufficient: true,
      available: 170,
    });
  });

  it('uses no lot when the package covers the debit', () => {
    expect(
      allocateMinutes({
        debit: 78,
        packageAvailable: 1200,
        lots,
        bookingStartsAt,
        now,
        usePackage: true,
      }),
    ).toEqual({ fromPackage: 78, fromLots: [], sufficient: true, available: 1320 });
  });

  it('skips lots expiring before (or at) the booking start, before now, or empty', () => {
    const result = allocateMinutes({
      debit: 30,
      packageAvailable: 0,
      lots: [
        { id: 'before-booking', remaining: 300, expiresAt: new Date('2026-11-15T15:00:00.000Z') },
        { id: 'at-booking', remaining: 300, expiresAt: bookingStartsAt },
        { id: 'expired', remaining: 300, expiresAt: new Date('2026-11-09T15:00:00.000Z') },
        { id: 'empty', remaining: 0, expiresAt: day(5) },
        { id: 'ok', remaining: 40, expiresAt: day(30) },
      ],
      bookingStartsAt,
      now,
      usePackage: true,
    });
    expect(result).toEqual({
      fromPackage: 0,
      fromLots: [{ lotId: 'ok', minutes: 30 }],
      sufficient: true,
      available: 40,
    });
  });

  it('usePackage: false (outside the period or suspended) uses lots only', () => {
    expect(
      allocateMinutes({
        debit: 78,
        packageAvailable: 1200,
        lots,
        bookingStartsAt,
        now,
        usePackage: false,
      }),
    ).toEqual({
      fromPackage: 0,
      fromLots: [
        { lotId: 'early', minutes: 20 },
        { lotId: 'late', minutes: 58 },
      ],
      sufficient: true,
      available: 120,
    });
  });

  it('insufficient → sufficient: false with available, nothing allocated', () => {
    expect(
      allocateMinutes({
        debit: 78,
        packageAvailable: 40,
        lots: [],
        bookingStartsAt,
        now,
        usePackage: true,
      }),
    ).toEqual({ fromPackage: 0, fromLots: [], sufficient: false, available: 40 });
    expect(
      allocateMinutes({
        debit: 200,
        packageAvailable: 1200,
        lots,
        bookingStartsAt,
        now,
        usePackage: false,
      }).sufficient,
    ).toBe(false);
  });

  it('breaks expiry ties by creation', () => {
    const tied: MinuteLot[] = [
      {
        id: 'newer',
        remaining: 50,
        expiresAt: day(10),
        createdAt: new Date('2026-10-12T00:00:00Z'),
      },
      {
        id: 'older',
        remaining: 50,
        expiresAt: day(10),
        createdAt: new Date('2026-10-11T00:00:00Z'),
      },
    ];
    expect(
      allocateMinutes({
        debit: 60,
        packageAvailable: 0,
        lots: tied,
        bookingStartsAt,
        now,
        usePackage: true,
      }).fromLots,
    ).toEqual([
      { lotId: 'older', minutes: 50 },
      { lotId: 'newer', minutes: 10 },
    ]);
  });
});

describe('allocateCredits (REC-107)', () => {
  const created = new Date('2026-11-01T12:00:00.000Z');

  it('7000 over 5000 (expires day 10) + 5000 (day 20) → 5000 + 2000', () => {
    expect(
      allocateCredits(
        [
          { id: 'day20', remainingCents: 5000, expiresAt: day(20), createdAt: created },
          { id: 'day10', remainingCents: 5000, expiresAt: day(10), createdAt: created },
        ],
        7000,
        now,
      ),
    ).toEqual([
      { lotId: 'day10', cents: 5000 },
      { lotId: 'day20', cents: 2000 },
    ]);
  });

  it('breaks expiry ties by creation (FIFO)', () => {
    expect(
      allocateCredits(
        [
          {
            id: 'b',
            remainingCents: 3000,
            expiresAt: day(10),
            createdAt: new Date('2026-11-02T00:00:00Z'),
          },
          {
            id: 'a',
            remainingCents: 3000,
            expiresAt: day(10),
            createdAt: new Date('2026-11-01T00:00:00Z'),
          },
        ],
        4000,
        now,
      ),
    ).toEqual([
      { lotId: 'a', cents: 3000 },
      { lotId: 'b', cents: 1000 },
    ]);
  });

  it('never exceeds a lot, skips expired lots and uses min(available, amount)', () => {
    expect(
      allocateCredits(
        [
          { id: 'expired', remainingCents: 9000, expiresAt: now, createdAt: created },
          { id: 'small', remainingCents: 1500, expiresAt: day(10), createdAt: created },
          { id: 'big', remainingCents: 2000, expiresAt: day(20), createdAt: created },
        ],
        10000,
        now,
      ),
    ).toEqual([
      { lotId: 'small', cents: 1500 },
      { lotId: 'big', cents: 2000 },
    ]);
  });

  it('amount 0 uses nothing', () => {
    expect(
      allocateCredits(
        [{ id: 'a', remainingCents: 3000, expiresAt: day(10), createdAt: created }],
        0,
        now,
      ),
    ).toEqual([]);
  });
});

describe('allocateRefund (REC-109)', () => {
  it('cash 8000 + credit 8000, refund 8000 → retained 8000 consumes the credit: credit 0, cash 8000', () => {
    expect(
      allocateRefund({ cashPaidCents: 8000, creditPaidCents: 8000, refundCents: 8000 }),
    ).toEqual({
      cashRefundCents: 8000,
      creditRefundCents: 0,
    });
  });

  it('credit 16000 only, refund 8000 → credit 8000', () => {
    expect(allocateRefund({ cashPaidCents: 0, creditPaidCents: 16000, refundCents: 8000 })).toEqual(
      {
        cashRefundCents: 0,
        creditRefundCents: 8000,
      },
    );
  });

  it('full refund returns both portions; no refund returns nothing', () => {
    expect(
      allocateRefund({ cashPaidCents: 8000, creditPaidCents: 8000, refundCents: 16000 }),
    ).toEqual({
      cashRefundCents: 8000,
      creditRefundCents: 8000,
    });
    expect(allocateRefund({ cashPaidCents: 8000, creditPaidCents: 8000, refundCents: 0 })).toEqual({
      cashRefundCents: 0,
      creditRefundCents: 0,
    });
  });

  it('rejects a refund above the amount paid', () => {
    expect(() =>
      allocateRefund({ cashPaidCents: 8000, creditPaidCents: 0, refundCents: 8001 }),
    ).toThrow('Refund 8001 outside 0..8000');
  });
});
