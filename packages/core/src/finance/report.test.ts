import { describe, expect, it } from 'vitest';
import { weekdayOf } from '../time';
import type { Entry } from './recognition';
import {
  buckets,
  buildDre,
  compare,
  nextOccurrences,
  previousRange,
  summarize,
  type Totals,
} from './report';

const ZERO: Totals = {
  grossCents: 0,
  discountsCents: 0,
  refundsCents: 0,
  feesCents: 0,
  netCents: 0,
  expensesCents: 0,
  resultCents: 0,
};

function totals(partial: Partial<Totals>): Totals {
  return { ...ZERO, ...partial };
}

// Caixa entries of the tenant-cancel worked example plus a fee, a manual receipt and expenses.
const entries: Entry[] = [
  { date: '2026-10-05', line: 'gross', category: 'rental_single', cents: 8000 },
  { date: '2026-10-05', line: 'fees', category: 'rental_single', cents: -40 },
  { date: '2026-10-20', line: 'gross', category: 'rental_single', cents: 8000 },
  { date: '2026-10-20', line: 'discounts', category: 'rental_single', cents: -1000 },
  { date: '2026-11-10', line: 'refunds', category: 'rental_single', cents: -8000 },
  { date: '2026-11-12', line: 'gross', category: 'subscription_initial', cents: 50000 },
  { date: '2026-11-14', line: 'gross', category: 'other', cents: 7000 },
  { date: '2026-11-15', line: 'expenses', category: 'cat-energia', cents: -45000 },
  { date: '2026-10-10', line: 'expenses', category: 'cat-aluguel', cents: -200000 },
];

describe('buckets (GES-23)', () => {
  it('uses ISO weeks starting on Monday and clips the edge buckets', () => {
    const weeks = buckets('2026-11-04', '2026-11-20', 'week');
    expect(weeks).toEqual([
      { key: '2026-W45', label: '04/11 a 08/11', from: '2026-11-04', to: '2026-11-08' },
      { key: '2026-W46', label: '09/11 a 15/11', from: '2026-11-09', to: '2026-11-15' },
      { key: '2026-W47', label: '16/11 a 20/11', from: '2026-11-16', to: '2026-11-20' },
    ]);
    expect(weekdayOf(weeks[1]?.from ?? '2026-01-01')).toBe(1);
    expect(weekdayOf(weeks[1]?.to ?? '2026-01-01')).toBe(7);
  });

  it('keys the week of 2027-01-01 by its ISO week-year (2026-W53)', () => {
    expect(buckets('2026-12-30', '2027-01-04', 'week').map((b) => [b.key, b.from, b.to])).toEqual([
      ['2026-W53', '2026-12-30', '2027-01-03'],
      ['2027-W01', '2027-01-04', '2027-01-04'],
    ]);
  });

  it('uses calendar months labelled mmm/aaaa, clipped to the range', () => {
    expect(buckets('2026-11-15', '2027-01-10', 'month')).toEqual([
      { key: '2026-11', label: 'nov/2026', from: '2026-11-15', to: '2026-11-30' },
      { key: '2026-12', label: 'dez/2026', from: '2026-12-01', to: '2026-12-31' },
      { key: '2027-01', label: 'jan/2027', from: '2027-01-01', to: '2027-01-10' },
    ]);
  });

  it('uses calendar quarters starting in January, April, July and October', () => {
    expect(buckets('2026-02-10', '2026-11-05', 'quarter')).toEqual([
      { key: '2026-Q1', label: '1º tri/2026', from: '2026-02-10', to: '2026-03-31' },
      { key: '2026-Q2', label: '2º tri/2026', from: '2026-04-01', to: '2026-06-30' },
      { key: '2026-Q3', label: '3º tri/2026', from: '2026-07-01', to: '2026-09-30' },
      { key: '2026-Q4', label: '4º tri/2026', from: '2026-10-01', to: '2026-11-05' },
    ]);
  });
});

describe('summarize (GES-22)', () => {
  it('totals each bucket and the range with net = 1+2+3+4 and result = net + expenses', () => {
    const summary = summarize(entries, '2026-10-01', '2026-11-30', 'month');
    expect(summary.buckets).toEqual([
      {
        key: '2026-10',
        label: 'out/2026',
        from: '2026-10-01',
        to: '2026-10-31',
        ...totals({
          grossCents: 16000,
          discountsCents: -1000,
          feesCents: -40,
          netCents: 14960,
          expensesCents: -200000,
          resultCents: -185040,
        }),
      },
      {
        key: '2026-11',
        label: 'nov/2026',
        from: '2026-11-01',
        to: '2026-11-30',
        ...totals({
          grossCents: 57000,
          refundsCents: -8000,
          netCents: 49000,
          expensesCents: -45000,
          resultCents: 4000,
        }),
      },
    ]);
    expect(summary.totals).toEqual(
      totals({
        grossCents: 73000,
        discountsCents: -1000,
        refundsCents: -8000,
        feesCents: -40,
        netCents: 63960,
        expensesCents: -245000,
        resultCents: -181040,
      }),
    );
    expect(summary.byRevenueCategory).toEqual({
      rental_single: 16000,
      subscription_initial: 50000,
      subscription_renewal: 0,
      extra_hours: 0,
      extra_services: 0,
      other: 7000,
    });
    expect(summary.byExpenseCategory).toEqual({ 'cat-aluguel': -200000, 'cat-energia': -45000 });
  });

  it('counts only entries inside the range, e.g. a refund whose charge predates it', () => {
    const november = summarize(entries, '2026-11-01', '2026-11-12', 'week');
    expect(november.totals).toEqual(
      totals({ grossCents: 50000, refundsCents: -8000, netCents: 42000, resultCents: 42000 }),
    );
    expect(november.buckets.map((b) => b.key)).toEqual(['2026-W44', '2026-W45', '2026-W46']);
  });

  it('returns every bucket with zeros when the range has no data', () => {
    const empty = summarize([], '2026-01-01', '2026-03-31', 'month');
    expect(empty.buckets.map((b) => [b.key, b.netCents, b.resultCents])).toEqual([
      ['2026-01', 0, 0],
      ['2026-02', 0, 0],
      ['2026-03', 0, 0],
    ]);
    expect(empty.totals).toEqual(ZERO);
    expect(Object.values(compare(empty.totals, ZERO)).map((c) => c.deltaPercent)).toEqual(
      Array(7).fill(null),
    );
  });
});

describe('previousRange and compare (GES-24)', () => {
  it('returns the range of equal length ending the day before from', () => {
    expect(previousRange('2026-11-01', '2026-11-30')).toEqual({
      from: '2026-10-02',
      to: '2026-10-31',
    });
    expect(previousRange('2026-03-01', '2026-03-01')).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    });
  });

  it('returns deltaPercent null when the previous value is 0', () => {
    const result = compare(totals({ grossCents: 5000 }), ZERO);
    expect(result.grossCents).toEqual({ deltaCents: 5000, deltaPercent: null });
    expect(result.netCents).toEqual({ deltaCents: 0, deltaPercent: null });
  });

  it('rounds the percentage half up to one decimal', () => {
    const result = compare(
      totals({ netCents: 160000, grossCents: 17, expensesCents: -120000 }),
      totals({ netCents: 142200, grossCents: 16, expensesCents: -100000 }),
    );
    expect(result.netCents).toEqual({ deltaCents: 17800, deltaPercent: 12.5 });
    // 1 / 16 = 6.25 % -> 6.3 %.
    expect(result.grossCents).toEqual({ deltaCents: 1, deltaPercent: 6.3 });
    // Expenses grew from -1000.00 to -1200.00: the delta and its percentage are negative.
    expect(result.expensesCents).toEqual({ deltaCents: -20000, deltaPercent: -20 });
  });
});

describe('buildDre (GES-30, GES-31, GES-32)', () => {
  const categories = [
    { id: 'cat-energia', name: 'Energia', displayOrder: 3 },
    { id: 'cat-aluguel', name: 'Aluguel', displayOrder: 1 },
    { id: 'cat-internet', name: 'Internet', displayOrder: 5 },
  ];

  it('lists the 7 lines in order with month columns and non-zero sub-rows only', () => {
    const dre = buildDre(entries, '2026-10-01', '2026-11-30', categories);
    expect(dre.months).toEqual([
      { key: '2026-10', label: 'out/2026' },
      { key: '2026-11', label: 'nov/2026' },
    ]);
    expect(dre.rows.map((r) => [r.label, r.level, r.bold])).toEqual([
      ['1. Receita bruta', 0, false],
      ['Locação avulsa', 1, false],
      ['Assinaturas', 1, false],
      ['Horas extras', 1, false],
      ['Serviços extras', 1, false],
      ['Outras receitas', 1, false],
      ['2. (−) Descontos, cupons e créditos concedidos', 0, false],
      ['3. (−) Estornos e reembolsos', 0, false],
      ['4. (−) Taxas do gateway de pagamento', 0, false],
      ['5. = Receita líquida', 0, true],
      ['6. (−) Despesas operacionais', 0, false],
      ['Aluguel', 1, false],
      ['Energia', 1, false],
      ['7. = Resultado do período', 0, true],
    ]);
    const byCode = new Map(dre.rows.map((r) => [r.code, r]));
    expect(byCode.get('gross')?.values).toEqual([16000, 57000]);
    expect(byCode.get('gross.subscriptions')?.values).toEqual([0, 50000]);
    expect(byCode.get('discounts')?.values).toEqual([-1000, 0]);
    expect(byCode.get('refunds')?.values).toEqual([0, -8000]);
    expect(byCode.get('fees')?.values).toEqual([-40, 0]);
    expect(byCode.get('expenses.cat-aluguel')?.values).toEqual([-200000, 0]);
    expect(byCode.get('result')?.total).toBe(-181040);
  });

  it('omits "Outras receitas" when it is zero in the range', () => {
    const withoutOther = entries.filter((e) => e.category !== 'other');
    const labels = buildDre(withoutOther, '2026-10-01', '2026-11-30', categories).rows.map(
      (r) => r.label,
    );
    expect(labels).not.toContain('Outras receitas');
    expect(labels.slice(0, 6)).toEqual([
      '1. Receita bruta',
      'Locação avulsa',
      'Assinaturas',
      'Horas extras',
      'Serviços extras',
      '2. (−) Descontos, cupons e créditos concedidos',
    ]);
  });

  it('keeps line 5 = 1+2+3+4 and line 7 = 5+6 in every column and in the total', () => {
    const dre = buildDre(entries, '2026-10-01', '2026-11-30', categories);
    const line = (code: string) => dre.rows.find((r) => r.code === code);
    const columns = [...dre.months.keys(), 'total'] as const;
    for (const column of columns) {
      const value = (code: string) =>
        column === 'total' ? (line(code)?.total ?? NaN) : (line(code)?.values[column] ?? NaN);
      expect(value('net'), String(column)).toBe(
        value('gross') + value('discounts') + value('refunds') + value('fees'),
      );
      expect(value('result'), String(column)).toBe(value('net') + value('expenses'));
    }
    expect(line('net')?.values).toEqual([14960, 49000]);
    expect(line('result')?.values).toEqual([-185040, 4000]);
  });

  it('starts a mid-month range with a partial first month', () => {
    const dre = buildDre(entries, '2026-10-15', '2026-11-30', categories);
    expect(dre.months.map((m) => m.label)).toEqual(['out/2026', 'nov/2026']);
    expect(dre.rows.find((r) => r.code === 'gross')?.values).toEqual([8000, 57000]);
    expect(dre.rows.find((r) => r.code === 'expenses.cat-aluguel')).toBeUndefined();
  });
});

describe('nextOccurrences (GES-14, GES-15)', () => {
  it('clamps a monthly Jan 31 parent to the month end and creates nothing in the future', () => {
    expect(nextOccurrences('2026-01-31', 'monthly', null, '2026-03-31')).toEqual([
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(nextOccurrences('2026-01-31', 'monthly', null, '2026-03-30')).toEqual(['2026-02-28']);
    expect(nextOccurrences('2028-01-31', 'monthly', null, '2028-02-29')).toEqual(['2028-02-29']);
  });

  it('continues after the last child already created', () => {
    expect(nextOccurrences('2026-01-31', 'monthly', '2026-02-28', '2026-04-30')).toEqual([
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(nextOccurrences('2026-01-31', 'monthly', '2026-03-31', '2026-03-31')).toEqual([]);
  });

  it('follows quarterly and yearly cadence', () => {
    expect(nextOccurrences('2026-01-31', 'quarterly', null, '2026-12-31')).toEqual([
      '2026-04-30',
      '2026-07-31',
      '2026-10-31',
    ]);
    expect(nextOccurrences('2028-02-29', 'yearly', null, '2030-03-01')).toEqual([
      '2029-02-28',
      '2030-02-28',
    ]);
  });

  it('returns nothing when the recurrence is none', () => {
    expect(nextOccurrences('2026-01-31', 'none', null, '2027-01-31')).toEqual([]);
  });
});
