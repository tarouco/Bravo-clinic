import { describe, expect, it } from 'vitest';
import { buildSummary } from './fixtures';
import {
  defaultRange,
  formatRange,
  readFinanceParams,
  todayLocal,
  validateFinanceParams,
} from './period';

describe('defaultRange', () => {
  it('starts on the first day of the month five months back and ends today', () => {
    expect(defaultRange('2026-10-26')).toEqual({ from: '2026-05-01', to: '2026-10-26' });
  });

  it('crosses the year boundary', () => {
    expect(defaultRange('2026-02-10')).toEqual({ from: '2025-09-01', to: '2026-02-10' });
    expect(defaultRange('2026-06-01')).toEqual({ from: '2026-01-01', to: '2026-06-01' });
  });
});

describe('todayLocal', () => {
  it('uses the clinic calendar date, not the UTC one', () => {
    // 01:30 UTC on 27/10 is still the evening of the 26th in São Paulo.
    expect(todayLocal(new Date('2026-10-27T01:30:00.000Z'))).toBe('2026-10-26');
  });
});

describe('readFinanceParams', () => {
  const today = '2026-10-26' as const;

  it('falls back to Caixa, month and the last 6 months', () => {
    expect(readFinanceParams(new URLSearchParams(), today)).toEqual({
      from: '2026-05-01',
      to: '2026-10-26',
      grouping: 'month',
      regime: 'cash',
    });
  });

  it('keeps valid params and ignores unreadable ones', () => {
    const params = new URLSearchParams('regime=accrual&grouping=decade&from=ontem&to=2026-09-30');
    expect(readFinanceParams(params, today)).toEqual({
      from: '2026-05-01',
      to: '2026-09-30',
      grouping: 'month',
      regime: 'accrual',
    });
  });
});

describe('validateFinanceParams', () => {
  const base = { grouping: 'month', regime: 'cash' } as const;

  it('accepts a range of 731 days and refuses 732 and an inverted one with the core messages', () => {
    expect(validateFinanceParams({ ...base, from: '2024-10-26', to: '2026-10-26' }).ok).toBe(true);
    expect(validateFinanceParams({ ...base, from: '2024-10-25', to: '2026-10-26' })).toEqual({
      ok: false,
      message: 'O período pode ter no máximo 731 dias',
    });
    expect(validateFinanceParams({ ...base, from: '2026-10-26', to: '2026-10-25' })).toEqual({
      ok: false,
      message: 'A data final precisa ser igual ou posterior à data inicial',
    });
  });
});

describe('formatRange', () => {
  it('writes both ends in pt-BR', () => {
    expect(formatRange('2025-11-03', '2026-04-30')).toBe('03/11/2025–30/04/2026');
  });
});

describe('finance fixture', () => {
  it('is computed by the core engine: totals add up and the previous range has equal length', () => {
    const summary = buildSummary();

    expect(summary.totals.netCents).toBe(643000);
    expect(summary.totals.resultCents).toBe(533000);
    expect(summary.previous).toMatchObject({
      from: '2025-11-03',
      to: '2026-04-30',
      netCents: 500000,
    });
    expect(summary.comparison.netCents.deltaPercent).toBe(28.6);
    expect(summary.buckets.map((b) => b.key)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });
});
