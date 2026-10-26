import {
  compare,
  previousRange,
  summarize,
  type Entry,
  type Grouping,
  type LocalDate,
  type Regime,
} from '@bravo/core';
import { parseFixture } from '../../test/fixtures/parse';
import { financeSummarySchema, type FinanceSummary } from './contracts';

// Finance fixtures for the web tests: summaries computed by the core engine from a few recognized
// entries (so totals, buckets and deltas obey the real rules) and validated against the response
// contract (AD-035).

export const EXPENSE_CATEGORY_IDS = {
  rent: '11111111-1111-4111-8111-111111111111',
  energy: '22222222-2222-4222-8222-222222222222',
  marketing: '33333333-3333-4333-8333-333333333333',
} as const;

export const EXPENSE_CATEGORY_NAMES: Record<string, string> = {
  [EXPENSE_CATEGORY_IDS.rent]: 'Aluguel',
  [EXPENSE_CATEGORY_IDS.energy]: 'Energia elétrica',
  [EXPENSE_CATEGORY_IDS.marketing]: 'Marketing',
};

const gross = (date: string, category: string, cents: number): Entry => ({
  date: date as LocalDate,
  line: 'gross',
  category,
  cents,
});
const deduction = (date: string, line: 'discounts' | 'refunds' | 'fees', cents: number): Entry => ({
  date: date as LocalDate,
  line,
  category: 'rental_single',
  cents,
});
const expense = (date: string, categoryId: string, cents: number): Entry => ({
  date: date as LocalDate,
  line: 'expenses',
  category: categoryId,
  cents,
});

/** 2026-05-01..2026-10-26: gross 6.600,00, net 6.430,00, expenses 1.100,00, result 5.330,00. */
export const CURRENT_ENTRIES: Entry[] = [
  gross('2026-06-10', 'rental_single', 100000),
  gross('2026-07-15', 'subscription_initial', 200000),
  deduction('2026-07-15', 'fees', -2000),
  gross('2026-08-20', 'extra_hours', 50000),
  deduction('2026-08-20', 'discounts', -5000),
  gross('2026-09-05', 'rental_single', 150000),
  gross('2026-10-10', 'rental_single', 160000),
  deduction('2026-10-10', 'refunds', -10000),
  expense('2026-06-01', EXPENSE_CATEGORY_IDS.rent, -80000),
  expense('2026-09-01', EXPENSE_CATEGORY_IDS.energy, -30000),
];

/** The 179 days before 2026-05-01 (2025-11-03..2026-04-30): net 5.000,00, expenses 1.000,00. */
export const PREVIOUS_ENTRIES: Entry[] = [
  gross('2026-02-10', 'rental_single', 500000),
  expense('2026-03-01', EXPENSE_CATEGORY_IDS.rent, -100000),
];

export interface SummaryFixtureOptions {
  from?: string;
  to?: string;
  grouping?: Grouping;
  regime?: Regime;
  current?: Entry[];
  previous?: Entry[];
}

/** A `FinanceSummary` for the selection, computed from the entries with the core engine. */
export function buildSummary(options: SummaryFixtureOptions = {}): FinanceSummary {
  const from = (options.from ?? '2026-05-01') as LocalDate;
  const to = (options.to ?? '2026-10-26') as LocalDate;
  const grouping = options.grouping ?? 'month';
  const regime = options.regime ?? 'cash';
  const current = summarize(options.current ?? CURRENT_ENTRIES, from, to, grouping);
  const range = previousRange(from, to);
  const previous = summarize(options.previous ?? PREVIOUS_ENTRIES, range.from, range.to, grouping);

  return parseFixture(
    financeSummarySchema,
    {
      regime,
      grouping,
      from,
      to,
      buckets: current.buckets,
      totals: current.totals,
      previous: { ...range, ...previous.totals },
      comparison: compare(current.totals, previous.totals),
      byRevenueCategory: current.byRevenueCategory,
      byExpenseCategory: Object.entries(current.byExpenseCategory).map(([id, cents]) => ({
        id,
        name: EXPENSE_CATEGORY_NAMES[id] ?? id,
        cents,
      })),
    },
    'financeSummary',
  );
}

/** A summary of a period with no movement at all. */
export function buildEmptySummary(options: SummaryFixtureOptions = {}): FinanceSummary {
  return buildSummary({ ...options, current: [], previous: [] });
}
