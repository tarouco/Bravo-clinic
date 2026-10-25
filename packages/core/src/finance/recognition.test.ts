import { describe, expect, it } from 'vitest';
import { localToUtc, type LocalDate } from '../time';
import {
  chargeCategory,
  recognize,
  splitExtras,
  spreadOverDays,
  type ChargeFact,
  type Entry,
  type Line,
  type Regime,
  type RefundFact,
} from './recognition';
import { summarize } from './report';

/** Instant of a clinic local date and time (default 12:00). */
function at(date: LocalDate, hhmm = '12:00'): Date {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return localToUtc(date, h * 60 + m);
}

type BookingFact = NonNullable<ChargeFact['booking']>;

function booking(overrides: Partial<BookingFact> = {}): BookingFact {
  return {
    id: 'bk1',
    startsAt: at('2026-12-02', '10:00'),
    status: 'paid',
    paymentMode: 'deposit_balance',
    totalCents: 21900,
    discountCents: 0,
    extrasCents: 0,
    firstApprovedChargeId: 'c1',
    ...overrides,
  };
}

function charge(
  fact: Pick<ChargeFact, 'id' | 'purpose' | 'amountCents' | 'approvedAt'> & Partial<ChargeFact>,
): ChargeFact {
  return { method: 'pix', feeCents: 0, status: 'approved', ...fact };
}

function run(
  regime: Regime,
  charges: ChargeFact[],
  refunds: RefundFact[] = [],
  extra: Partial<Parameters<typeof recognize>[0]> = {},
): Entry[] {
  return recognize({ regime, charges, refunds, receipts: [], expenses: [], ...extra });
}

/** Non-zero line sums per `YYYY-MM`, so a whole result is compared with one `toEqual`. */
function monthly(entries: Entry[]): Record<string, Partial<Record<Line, number>>> {
  const out: Record<string, Partial<Record<Line, number>>> = {};
  for (const e of entries) {
    const month = (out[e.date.slice(0, 7)] ??= {});
    month[e.line] = (month[e.line] ?? 0) + e.cents;
  }
  for (const month of Object.values(out)) {
    for (const line of Object.keys(month) as Line[]) if (month[line] === 0) delete month[line];
  }
  return out;
}

/** Sum of the entries of one line and category. */
function sumOf(entries: Entry[], line: Line, category?: string): number {
  return entries
    .filter((e) => e.line === line && (category === undefined || e.category === category))
    .reduce((s, e) => s + e.cents, 0);
}

describe('chargeCategory (GES-01)', () => {
  it('maps every charge purpose to its revenue category', () => {
    expect(chargeCategory('booking_deposit')).toBe('rental_single');
    expect(chargeCategory('booking_balance')).toBe('rental_single');
    expect(chargeCategory('booking_full')).toBe('rental_single');
    expect(chargeCategory('booking_difference')).toBe('rental_single');
    expect(chargeCategory('subscription_initial')).toBe('subscription_initial');
    expect(chargeCategory('subscription_renewal')).toBe('subscription_renewal');
    expect(chargeCategory('extra_hours')).toBe('extra_hours');
    expect(chargeCategory('extra_service')).toBe('extra_services');
  });
});

describe('spreadOverDays (GES-04)', () => {
  it('splits 616000 over the 30 days of [2026-11-02, 2026-12-02) leftover-first', () => {
    const parts = spreadOverDays(616000, '2026-11-02', '2026-12-02');
    expect(parts).toHaveLength(30);
    expect(parts.slice(0, 10).every((p) => p.cents === 20534)).toBe(true);
    expect(parts.slice(10).every((p) => p.cents === 20533)).toBe(true);
    expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(616000);
    expect(parts[0]?.date).toBe('2026-11-02');
    expect(parts[29]?.date).toBe('2026-12-01');
  });
});

describe('splitExtras (GES-08)', () => {
  it('gives extras the half-up share amount × extras / total and rental the rest', () => {
    expect(splitExtras(30000, 8000, 30000)).toEqual({ extras: 8000, rental: 22000 });
    expect(splitExtras(15000, 8000, 30000)).toEqual({ extras: 4000, rental: 11000 });
    expect(splitExtras(15, 1, 2)).toEqual({ extras: 8, rental: 7 });
  });
});

describe('design worked examples (exact cents per month)', () => {
  // Booking 2026-12-02 total 21900; deposit 10950 approved 2026-11-20 (fee 109), balance 10950
  // approved 2026-11-30 (fee 110).
  const depositBalance = [
    charge({
      id: 'c1',
      purpose: 'booking_deposit',
      amountCents: 10950,
      feeCents: 109,
      approvedAt: at('2026-11-20'),
      booking: booking(),
    }),
    charge({
      id: 'c2',
      purpose: 'booking_balance',
      amountCents: 10950,
      feeCents: 110,
      approvedAt: at('2026-11-30'),
      booking: booking(),
    }),
  ];

  it('deposit + balance: Caixa in the approval month, Competência in the usage month', () => {
    expect(monthly(run('cash', depositBalance))).toEqual({
      '2026-11': { gross: 21900, fees: -219 },
    });
    expect(monthly(run('accrual', depositBalance))).toEqual({
      '2026-12': { gross: 21900, fees: -219 },
    });
  });

  it('coupon 2000 (total 19900): gross 21900 and discounts −2000 in both regimes', () => {
    const coupon = booking({ totalCents: 19900, discountCents: 2000 });
    const charges = [
      charge({
        id: 'c1',
        purpose: 'booking_deposit',
        amountCents: 9950,
        feeCents: 50,
        approvedAt: at('2026-11-20'),
        booking: coupon,
      }),
      charge({
        id: 'c2',
        purpose: 'booking_balance',
        amountCents: 9950,
        feeCents: 50,
        approvedAt: at('2026-11-30'),
        booking: coupon,
      }),
    ];
    expect(monthly(run('cash', charges))).toEqual({
      '2026-11': { gross: 21900, discounts: -2000, fees: -100 },
    });
    expect(monthly(run('accrual', charges))).toEqual({
      '2026-12': { gross: 21900, discounts: -2000, fees: -100 },
    });
  });

  it('fixed-schedule period 2026-11-02..2026-12-02 paid 2026-10-31: Oct vs Nov/Dec spread', () => {
    const period = [
      charge({
        id: 'p1',
        purpose: 'subscription_initial',
        method: 'card',
        amountCents: 616000,
        approvedAt: at('2026-10-31'),
        period: {
          id: 'per1',
          startsOn: '2026-11-02',
          endsOn: '2026-12-02',
          discountCents: 0,
          firstApprovedChargeId: 'p1',
        },
      }),
    ];
    expect(monthly(run('cash', period))).toEqual({ '2026-10': { gross: 616000 } });
    // Nov 2..Nov 30 = 29 days: 10 × 20534 + 19 × 20533 = 595467; Dec 1 = 20533.
    expect(monthly(run('accrual', period))).toEqual({
      '2026-11': { gross: 595467 },
      '2026-12': { gross: 20533 },
    });
    // A range ending inside the period counts only its own days (spec edge case, GES-04).
    expect(summarize(run('accrual', period), '2026-11-01', '2026-11-30', 'month').totals).toEqual(
      expect.objectContaining({ grossCents: 595467, netCents: 595467 }),
    );
  });

  it('booking total 30000 incl. 8000 extras: rental 22000 and extras 8000 in both regimes', () => {
    const charges = [
      charge({
        id: 'c1',
        purpose: 'booking_full',
        amountCents: 30000,
        approvedAt: at('2026-11-20'),
        booking: booking({
          startsAt: at('2026-12-05', '09:00'),
          totalCents: 30000,
          extrasCents: 8000,
        }),
      }),
    ];
    expect(run('cash', charges)).toEqual([
      { date: '2026-11-20', line: 'gross', category: 'rental_single', cents: 22000 },
      { date: '2026-11-20', line: 'gross', category: 'extra_services', cents: 8000 },
    ]);
    expect(run('accrual', charges)).toEqual([
      { date: '2026-12-05', line: 'gross', category: 'rental_single', cents: 22000 },
      { date: '2026-12-05', line: 'gross', category: 'extra_services', cents: 8000 },
    ]);
  });

  it('tenant cancel ≥ 24h: deposit kept, balance refunded 2026-11-10', () => {
    const cancelled = booking({
      startsAt: at('2026-11-20', '10:00'),
      status: 'cancelled_by_tenant',
      cancelledAt: at('2026-10-30', '15:00'),
      totalCents: 16000,
    });
    const charges = [
      charge({
        id: 'c1',
        purpose: 'booking_deposit',
        amountCents: 8000,
        approvedAt: at('2026-10-05'),
        booking: cancelled,
      }),
      charge({
        id: 'c2',
        purpose: 'booking_balance',
        amountCents: 8000,
        status: 'refunded',
        approvedAt: at('2026-10-20'),
        booking: cancelled,
      }),
    ];
    const refunds = [{ chargeId: 'c2', amountCents: 8000, completedAt: at('2026-11-10') }];

    const cash = run('cash', charges, refunds);
    expect(monthly(cash)).toEqual({ '2026-10': { gross: 16000 }, '2026-11': { refunds: -8000 } });
    expect(cash.find((e) => e.line === 'refunds')?.date).toBe('2026-11-10');

    const accrual = run('accrual', charges, refunds);
    expect(monthly(accrual)).toEqual({ '2026-10': { gross: 16000, refunds: -8000 } });
    expect(accrual.every((e) => e.date === '2026-10-30')).toBe(true);
  });

  it('package- or subscription-paid booking: nothing in either regime (GES-09)', () => {
    for (const paymentMode of ['package', 'subscription']) {
      const charges = [
        charge({
          id: 'c1',
          purpose: 'booking_difference',
          amountCents: 3000,
          feeCents: 15,
          approvedAt: at('2026-11-20'),
          booking: booking({ paymentMode, totalCents: 3000 }),
        }),
      ];
      const refunds = [{ chargeId: 'c1', amountCents: 3000, completedAt: at('2026-11-21') }];
      expect(run('cash', charges, refunds), paymentMode).toEqual([]);
      expect(run('accrual', charges, refunds), paymentMode).toEqual([]);
    }
  });
});

describe('recognition rules', () => {
  it('dates a booking discount with the first approved charge in Caixa (GES-06)', () => {
    const coupon = booking({ totalCents: 19900, discountCents: 2000 });
    const charges = [
      charge({
        id: 'c1',
        purpose: 'booking_deposit',
        amountCents: 9950,
        approvedAt: at('2026-10-28'),
        booking: coupon,
      }),
      charge({
        id: 'c2',
        purpose: 'booking_balance',
        amountCents: 9950,
        approvedAt: at('2026-11-30'),
        booking: coupon,
      }),
    ];
    expect(monthly(run('cash', charges))).toEqual({
      '2026-10': { gross: 11950, discounts: -2000 },
      '2026-11': { gross: 9950 },
    });
  });

  it('adds credit charges to gross and line 2, with no fee (GES-06, GES-07)', () => {
    const credit = booking({ totalCents: 15000 });
    const charges = [
      charge({
        id: 'c1',
        purpose: 'booking_full',
        method: 'credit',
        amountCents: 5000,
        feeCents: 10,
        approvedAt: at('2026-11-20', '09:00'),
        booking: credit,
      }),
      charge({
        id: 'c2',
        purpose: 'booking_full',
        amountCents: 10000,
        feeCents: 99,
        approvedAt: at('2026-11-20', '09:01'),
        booking: credit,
      }),
    ];
    expect(run('cash', charges)).toEqual([
      { date: '2026-11-20', line: 'gross', category: 'rental_single', cents: 5000 },
      { date: '2026-11-20', line: 'discounts', category: 'rental_single', cents: -5000 },
      { date: '2026-11-20', line: 'gross', category: 'rental_single', cents: 10000 },
      { date: '2026-11-20', line: 'fees', category: 'rental_single', cents: -99 },
    ]);
  });

  it('spreads a period discount with its receipt in Competência (GES-04, GES-06)', () => {
    const charges = [
      charge({
        id: 'p1',
        purpose: 'subscription_renewal',
        amountCents: 586000,
        approvedAt: at('2026-10-31'),
        period: {
          id: 'per1',
          startsOn: '2026-11-02',
          endsOn: '2026-12-02',
          discountCents: 30000,
          firstApprovedChargeId: 'p1',
        },
      }),
    ];
    const accrual = run('accrual', charges);
    // Gross 616000 spread as above; the 30000 discount is 1000 per day.
    expect(monthly(accrual)).toEqual({
      '2026-11': { gross: 595467, discounts: -29000 },
      '2026-12': { gross: 20533, discounts: -1000 },
    });
    expect(sumOf(accrual, 'gross', 'subscription_renewal')).toBe(616000);
    expect(monthly(run('cash', charges))).toEqual({
      '2026-10': { gross: 616000, discounts: -30000 },
    });
  });

  it('reports chargebacks and refunds on line 3 under the original category (GES-07)', () => {
    const chargedBack = charge({
      id: 'c1',
      purpose: 'booking_full',
      status: 'charged_back',
      amountCents: 15000,
      feeCents: 75,
      approvedAt: at('2026-11-03'),
      chargedBackAt: at('2026-12-15'),
      booking: booking({ startsAt: at('2026-11-10'), totalCents: 15000 }),
    });
    const renewal = charge({
      id: 'r1',
      purpose: 'subscription_renewal',
      status: 'partially_refunded',
      amountCents: 40000,
      approvedAt: at('2026-12-01'),
    });
    const refunds = [{ chargeId: 'r1', amountCents: 5000, completedAt: at('2026-12-20') }];

    const cash = run('cash', [chargedBack, renewal], refunds);
    expect(cash.filter((e) => e.line === 'refunds')).toEqual([
      { date: '2026-12-15', line: 'refunds', category: 'rental_single', cents: -15000 },
      { date: '2026-12-20', line: 'refunds', category: 'subscription_renewal', cents: -5000 },
    ]);
    expect(monthly(run('accrual', [chargedBack]))).toEqual({
      '2026-11': { gross: 15000, fees: -75, refunds: -15000 },
    });
  });

  it('dates cancelled_nonpayment and expired bookings on cancelledAt in Competência (GES-03)', () => {
    const nonpayment = charge({
      id: 'c1',
      purpose: 'booking_deposit',
      amountCents: 5000,
      approvedAt: at('2026-11-02'),
      booking: booking({
        startsAt: at('2026-12-10'),
        status: 'cancelled_nonpayment',
        cancelledAt: at('2026-12-08', '10:00'),
      }),
    });
    const expired = charge({
      id: 'c2',
      purpose: 'booking_deposit',
      amountCents: 6000,
      approvedAt: at('2026-12-20'),
      booking: booking({
        id: 'bk2',
        startsAt: at('2027-01-05'),
        status: 'expired',
        cancelledAt: at('2026-12-31', '23:30'),
        firstApprovedChargeId: 'c2',
      }),
    });
    expect(run('accrual', [nonpayment, expired]).map((e) => e.date)).toEqual([
      '2026-12-08',
      '2026-12-31',
    ]);
  });

  it('dates extra hours on the payment date in both regimes (GES-05)', () => {
    const extraHours = [
      charge({
        id: 'x1',
        purpose: 'extra_hours',
        amountCents: 12000,
        feeCents: 60,
        approvedAt: at('2026-11-25'),
      }),
    ];
    const expected = [
      { date: '2026-11-25', line: 'gross', category: 'extra_hours', cents: 12000 },
      { date: '2026-11-25', line: 'fees', category: 'extra_hours', cents: -60 },
    ];
    expect(run('cash', extraHours)).toEqual(expected);
    expect(run('accrual', extraHours)).toEqual(expected);
  });

  it('dates manual receipts by date, or by the linked booking start in Competência (GES-02, GES-03)', () => {
    const receipts = [
      { date: '2026-11-05' as const, category: 'other' as const, amountCents: 7000 },
      {
        date: '2026-11-06' as const,
        category: 'rental_single' as const,
        amountCents: 9000,
        booking: { startsAt: at('2026-12-01') },
      },
    ];
    expect(run('cash', [], [], { receipts }).map((e) => [e.date, e.category, e.cents])).toEqual([
      ['2026-11-05', 'other', 7000],
      ['2026-11-06', 'rental_single', 9000],
    ]);
    expect(run('accrual', [], [], { receipts }).map((e) => [e.date, e.category, e.cents])).toEqual([
      ['2026-11-05', 'other', 7000],
      ['2026-12-01', 'rental_single', 9000],
    ]);
  });

  it('reports expenses negative on their date and category in both regimes', () => {
    const expenses = [
      { date: '2026-11-10' as const, categoryId: 'cat-energia', amountCents: 45000 },
    ];
    const expected = [
      { date: '2026-11-10', line: 'expenses', category: 'cat-energia', cents: -45000 },
    ];
    expect(run('cash', [], [], { expenses })).toEqual(expected);
    expect(run('accrual', [], [], { expenses })).toEqual(expected);
  });

  it('is a pure function of its facts (GES-10)', () => {
    const facts = {
      regime: 'accrual' as const,
      charges: [
        charge({
          id: 'c1',
          purpose: 'booking_full',
          amountCents: 21900,
          feeCents: 219,
          approvedAt: at('2026-11-20'),
          booking: booking(),
        }),
      ],
      refunds: [],
      receipts: [],
      expenses: [],
    };
    const frozen = structuredClone(facts);
    const first = recognize(facts);
    expect(recognize(facts)).toEqual(first);
    expect(facts).toEqual(frozen);
  });
});
