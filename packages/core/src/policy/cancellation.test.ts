import { describe, expect, it } from 'vitest';
import type { PaymentMode } from '../status/booking';
import { evaluateCancellation, type CancelPolicy } from './cancellation';

// Spec W-CA: factory policy, now = 2026-10-20T12:00:00Z.
const NOW = new Date('2026-10-20T12:00:00Z');
const HOUR = 3_600_000;
const FACTORY: CancelPolicy = {
  cancelRefundMinHoursBefore: 24,
  packageCancelReturnMinHoursBefore: 24,
  depositRefundable: false,
  clinicCancelOptions: ['refund', 'minutes', 'credit'],
};

interface Row {
  actor: 'tenant' | 'clinic';
  hoursBefore: number;
  kind?: 'single' | 'fixed_occurrence';
  paymentMode: PaymentMode;
  depositCents: number;
  paidCents: number;
  packageMinutes?: number;
  extraMinutes?: number;
  withinCurrentPeriod?: boolean;
  depositRefundable?: boolean;
}

const evaluate = (row: Row) =>
  evaluateCancellation({
    actor: row.actor,
    startsAt: new Date(NOW.getTime() + row.hoursBefore * HOUR),
    now: NOW,
    kind: row.kind ?? 'single',
    paymentMode: row.paymentMode,
    depositCents: row.depositCents,
    paidCents: row.paidCents,
    packageMinutes: row.packageMinutes ?? 0,
    extraMinutes: row.extraMinutes ?? 0,
    withinCurrentPeriod: row.withinCurrentPeriod ?? true,
    policy: { ...FACTORY, depositRefundable: row.depositRefundable ?? false },
  });

const deposit: Row = {
  actor: 'tenant',
  hoursBefore: 30,
  paymentMode: 'deposit_balance',
  depositCents: 8000,
  paidCents: 16000,
};
const pkg: Row = {
  actor: 'tenant',
  hoursBefore: 30,
  paymentMode: 'package',
  depositCents: 0,
  paidCents: 0,
  packageMinutes: 120,
  extraMinutes: 18,
};

describe('evaluateCancellation with W-CA (NUC-26)', () => {
  const rows: [
    string,
    Row,
    { retainedCents: number; refundCents: number; minutesReturned: number },
  ][] = [
    ['CA-1', deposit, { retainedCents: 8000, refundCents: 8000, minutesReturned: 0 }],
    [
      'CA-2',
      { ...deposit, paidCents: 8000 },
      { retainedCents: 8000, refundCents: 0, minutesReturned: 0 },
    ],
    [
      'CA-3',
      { ...deposit, hoursBefore: 23 },
      { retainedCents: 16000, refundCents: 0, minutesReturned: 0 },
    ],
    [
      'CA-4',
      { ...deposit, hoursBefore: 24 },
      { retainedCents: 8000, refundCents: 8000, minutesReturned: 0 },
    ],
    ['CA-5', pkg, { retainedCents: 0, refundCents: 0, minutesReturned: 138 }],
    ['CA-6', { ...pkg, hoursBefore: 23 }, { retainedCents: 0, refundCents: 0, minutesReturned: 0 }],
    [
      'CA-7',
      { ...pkg, withinCurrentPeriod: false },
      { retainedCents: 0, refundCents: 0, minutesReturned: 0 },
    ],
    [
      'CA-8',
      {
        actor: 'tenant',
        hoursBefore: 30,
        kind: 'fixed_occurrence',
        paymentMode: 'subscription',
        depositCents: 0,
        paidCents: 0,
      },
      { retainedCents: 0, refundCents: 0, minutesReturned: 0 },
    ],
    [
      'CA-9',
      { ...deposit, actor: 'clinic', hoursBefore: 10 },
      { retainedCents: 0, refundCents: 16000, minutesReturned: 0 },
    ],
    [
      'CA-10',
      { ...deposit, depositRefundable: true },
      { retainedCents: 0, refundCents: 16000, minutesReturned: 0 },
    ],
  ];

  it.each(rows)('%s', (_name, row, expected) => {
    expect(evaluate(row)).toMatchObject(expected);
  });

  it('CA-9 also returns clinicOptions = policy.clinic_cancel_options', () => {
    expect(evaluate({ ...deposit, actor: 'clinic', hoursBefore: 10 }).clinicOptions).toEqual([
      'refund',
      'minutes',
      'credit',
    ]);
  });

  it('a clinic cancellation of a package booking returns the debited minutes', () => {
    expect(evaluate({ ...pkg, actor: 'clinic', hoursBefore: 2 })).toMatchObject({
      retainedCents: 0,
      refundCents: 0,
      minutesReturned: 138,
    });
  });
});
