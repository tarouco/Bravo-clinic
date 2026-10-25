import { describe, expect, it } from 'vitest';
import {
  evaluateReschedule,
  rescheduleDifference,
  settleReschedule,
  type ReschedulePolicy,
} from './reschedule';

// Spec W-RS: factory policy (1 courtesy, 24 h, 60 days), now = 2026-10-20T12:00:00Z.
const NOW = new Date('2026-10-20T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FACTORY: ReschedulePolicy = { freeCount: 1, minHoursBefore: 24, windowDays: 60 };
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

const evaluate = (
  startsIn: number,
  newStartsIn: number,
  rescheduleCount: number,
  isStaffException: boolean,
) =>
  evaluateReschedule({
    startsAt: ahead(startsIn),
    newStartsAt: ahead(newStartsIn),
    now: NOW,
    rescheduleCount,
    isStaffException,
    policy: FACTORY,
  });

describe('evaluateReschedule with W-RS (NUC-27)', () => {
  it('RS-1: 30h before, new slot in 10 days, first reschedule -> allowed', () => {
    expect(evaluate(30 * HOUR, 10 * DAY, 0, false)).toEqual({ allowed: true });
  });

  it('RS-2: 23h59m before -> too_late', () => {
    expect(evaluate(23 * HOUR + 59 * 60_000, 10 * DAY, 0, false)).toEqual({
      allowed: false,
      reason: 'too_late',
    });
  });

  it('RS-3: courtesy already used -> limit_reached', () => {
    expect(evaluate(30 * HOUR, 10 * DAY, 1, false)).toEqual({
      allowed: false,
      reason: 'limit_reached',
    });
  });

  it('RS-4: new slot 61 days ahead -> beyond_window', () => {
    expect(evaluate(30 * HOUR, 61 * DAY, 0, false)).toEqual({
      allowed: false,
      reason: 'beyond_window',
    });
  });

  it('RS-5: a staff exception bypasses every rule', () => {
    expect(evaluate(23 * HOUR, 61 * DAY, 1, true)).toEqual({ allowed: true });
  });
});

describe('settleReschedule with W-ST (NUC-28)', () => {
  const rows: [
    string,
    Parameters<typeof settleReschedule>[0],
    ReturnType<typeof settleReschedule>,
  ][] = [
    [
      'ST-1',
      { oldNetCents: 24000, newNetCents: 9700, paidCents: 24000, depositCents: 12000 },
      {
        payNowCents: 0,
        creditCents: 14300,
        newTotalCents: 9700,
        newPaidCents: 9700,
        newBalanceCents: 0,
        newDepositCents: 9700,
      },
    ],
    [
      'ST-2',
      { oldNetCents: 24000, newNetCents: 9700, paidCents: 12000, depositCents: 12000 },
      {
        payNowCents: 0,
        creditCents: 2300,
        newTotalCents: 9700,
        newPaidCents: 9700,
        newBalanceCents: 0,
        newDepositCents: 9700,
      },
    ],
    [
      'ST-3',
      { oldNetCents: 9700, newNetCents: 24000, paidCents: 4851, depositCents: 4851 },
      {
        payNowCents: 14300,
        creditCents: 0,
        newTotalCents: 24000,
        newPaidCents: 19151,
        newBalanceCents: 4849,
        newDepositCents: 4851,
      },
    ],
    [
      'ST-4',
      { oldNetCents: 16000, newNetCents: 16000, paidCents: 16000, depositCents: 8000 },
      {
        payNowCents: 0,
        creditCents: 0,
        newTotalCents: 16000,
        newPaidCents: 16000,
        newBalanceCents: 0,
        newDepositCents: 8000,
      },
    ],
    [
      'ST-5',
      { oldNetCents: 16000, newNetCents: 12000, paidCents: 8000, depositCents: 8000 },
      {
        payNowCents: 0,
        creditCents: 0,
        newTotalCents: 12000,
        newPaidCents: 8000,
        newBalanceCents: 4000,
        newDepositCents: 8000,
      },
    ],
  ];

  it.each(rows)('%s', (_name, input, expected) => {
    expect(settleReschedule(input)).toEqual(expected);
  });
});

describe('rescheduleDifference (architecture 7.12)', () => {
  it('pays the difference for a more expensive slot and credits it for a cheaper one', () => {
    expect(rescheduleDifference(9700, 24000)).toEqual({ payCents: 14300, creditCents: 0 });
    expect(rescheduleDifference(24000, 9700)).toEqual({ payCents: 0, creditCents: 14300 });
    expect(rescheduleDifference(16000, 16000)).toEqual({ payCents: 0, creditCents: 0 });
  });
});
