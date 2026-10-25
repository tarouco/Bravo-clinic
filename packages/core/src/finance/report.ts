import type { z } from 'zod';
import { mulDivRoundHalfUp, type Cents } from '../money';
import { addDays, diffDays, weekdayOf, type LocalDate } from '../time';
import {
  REVENUE_CATEGORIES,
  type ExpenseRecurrence,
  type financeGroupingSchema,
} from '../validation/gestao-schemas';
import type { Entry, Line, RevenueCategory } from './recognition';

// Buckets, totals, comparison and the DRE matrix over recognized entries (GES-22..GES-24,
// GES-30..GES-32), plus the expense recurrence calendar (GES-14).

export type Grouping = z.infer<typeof financeGroupingSchema>;

export interface Bucket {
  key: string;
  label: string;
  from: LocalDate;
  to: LocalDate;
}

/** Discounts, refunds, fees and expenses are negative; net = 1+2+3+4, result = net + expenses. */
export interface Totals {
  grossCents: Cents;
  discountsCents: Cents;
  refundsCents: Cents;
  feesCents: Cents;
  netCents: Cents;
  expensesCents: Cents;
  resultCents: Cents;
}

const TOTAL_KEYS = [
  'grossCents',
  'discountsCents',
  'refundsCents',
  'feesCents',
  'netCents',
  'expensesCents',
  'resultCents',
] as const satisfies readonly (keyof Totals)[];

const MONTH_LABELS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateParts(date: LocalDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

function makeDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}` as LocalDate;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayMonth(date: LocalDate): string {
  const { month, day } = dateParts(date);
  return `${pad2(day)}/${pad2(month)}`;
}

/** First day of the (unclipped) bucket holding `date`. */
function bucketStart(date: LocalDate, grouping: Grouping): LocalDate {
  const { year, month } = dateParts(date);
  if (grouping === 'week') return addDays(date, 1 - weekdayOf(date));
  if (grouping === 'month') return makeDate(year, month, 1);
  return makeDate(year, Math.floor((month - 1) / 3) * 3 + 1, 1);
}

function bucketEnd(start: LocalDate, grouping: Grouping): LocalDate {
  if (grouping === 'week') return addDays(start, 6);
  const { year, month } = dateParts(start);
  const lastMonth = grouping === 'month' ? month : month + 2;
  return makeDate(year, lastMonth, daysInMonth(year, lastMonth));
}

/** `2026-W45` (ISO 8601 week-year), `2026-11` or `2026-Q4`. */
function bucketKey(start: LocalDate, grouping: Grouping): string {
  const { year, month } = dateParts(start);
  if (grouping === 'month') return `${String(year)}-${pad2(month)}`;
  if (grouping === 'quarter') return `${String(year)}-Q${String(Math.ceil(month / 3))}`;
  const thursday = addDays(start, 3);
  const weekYear = dateParts(thursday).year;
  const week = Math.floor(diffDays(makeDate(weekYear, 1, 1), thursday) / 7) + 1;
  return `${String(weekYear)}-W${pad2(week)}`;
}

function bucketLabel(start: LocalDate, from: LocalDate, to: LocalDate, grouping: Grouping) {
  const { year, month } = dateParts(start);
  if (grouping === 'week') return `${dayMonth(from)} a ${dayMonth(to)}`;
  if (grouping === 'month') return `${MONTH_LABELS[month - 1] ?? ''}/${String(year)}`;
  return `${String(Math.ceil(month / 3))}º tri/${String(year)}`;
}

/**
 * ISO weeks (Monday..Sunday), calendar months or calendar quarters intersecting `[from, to]`,
 * with the first and last bucket clipped to the range (GES-23).
 */
export function buckets(from: LocalDate, to: LocalDate, grouping: Grouping): Bucket[] {
  const out: Bucket[] = [];
  for (let start = bucketStart(from, grouping); start <= to;) {
    const end = bucketEnd(start, grouping);
    const clippedFrom = start < from ? from : start;
    const clippedTo = end > to ? to : end;
    out.push({
      key: bucketKey(start, grouping),
      label: bucketLabel(start, clippedFrom, clippedTo, grouping),
      from: clippedFrom,
      to: clippedTo,
    });
    start = addDays(end, 1);
  }
  return out;
}

type LineSums = Record<Line, Cents>;

function emptyLines(): LineSums {
  return { gross: 0, discounts: 0, refunds: 0, fees: 0, expenses: 0 };
}

function toTotals(s: LineSums): Totals {
  const netCents = s.gross + s.discounts + s.refunds + s.fees;
  return {
    grossCents: s.gross,
    discountsCents: s.discounts,
    refundsCents: s.refunds,
    feesCents: s.fees,
    netCents,
    expensesCents: s.expenses,
    resultCents: netCents + s.expenses,
  };
}

function inRange(entry: Entry, from: LocalDate, to: LocalDate): boolean {
  return entry.date >= from && entry.date <= to;
}

/** Totals per bucket and for the range, gross per revenue category, expenses per category. */
export function summarize(
  entries: Entry[],
  from: LocalDate,
  to: LocalDate,
  grouping: Grouping,
): {
  buckets: (Bucket & Totals)[];
  totals: Totals;
  byRevenueCategory: Record<RevenueCategory, Cents>;
  byExpenseCategory: Record<string, Cents>;
} {
  const list = buckets(from, to, grouping);
  const sums = new Map(list.map((b) => [b.key, emptyLines()]));
  const total = emptyLines();
  const byRevenueCategory = Object.fromEntries(REVENUE_CATEGORIES.map((c) => [c, 0])) as Record<
    RevenueCategory,
    Cents
  >;
  const byExpenseCategory: Record<string, Cents> = {};

  for (const entry of entries) {
    if (!inRange(entry, from, to)) continue;
    const bucket = sums.get(bucketKey(bucketStart(entry.date, grouping), grouping));
    if (bucket) bucket[entry.line] += entry.cents;
    total[entry.line] += entry.cents;
    if (entry.line === 'gross') byRevenueCategory[entry.category as RevenueCategory] += entry.cents;
    if (entry.line === 'expenses') {
      byExpenseCategory[entry.category] = (byExpenseCategory[entry.category] ?? 0) + entry.cents;
    }
  }

  return {
    buckets: list.map((b) => ({ ...b, ...toTotals(sums.get(b.key) ?? emptyLines()) })),
    totals: toTotals(total),
    byRevenueCategory,
    byExpenseCategory,
  };
}

/** The range of equal length ending the day before `from` (GES-24). */
export function previousRange(from: LocalDate, to: LocalDate): { from: LocalDate; to: LocalDate } {
  const days = diffDays(from, to) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/**
 * Absolute and percentage change per total. The percentage is the delta over the magnitude of
 * the previous value (its sign follows the delta), half up to one decimal; `null` when the
 * previous value is 0 (GES-24).
 */
export function compare(
  current: Totals,
  previous: Totals,
): Record<keyof Totals, { deltaCents: Cents; deltaPercent: number | null }> {
  const out = {} as Record<keyof Totals, { deltaCents: Cents; deltaPercent: number | null }>;
  for (const key of TOTAL_KEYS) {
    const deltaCents = current[key] - previous[key];
    const base = Math.abs(previous[key]);
    out[key] = {
      deltaCents,
      deltaPercent: base === 0 ? null : mulDivRoundHalfUp(deltaCents, 1000, base) / 10,
    };
  }
  return out;
}

export interface DreRow {
  code: string;
  label: string;
  level: 0 | 1;
  bold: boolean;
  values: Cents[];
  total: Cents;
}

export interface DreMatrix {
  months: { key: string; label: string }[];
  rows: DreRow[];
}

/**
 * The 7-line DRE with one column per calendar month intersecting the range (GES-30..GES-32).
 * "Outras receitas" and the expense sub-rows appear only when non-zero in the range.
 */
export function buildDre(
  entries: Entry[],
  from: LocalDate,
  to: LocalDate,
  expenseCategories: { id: string; name: string; displayOrder: number }[],
): DreMatrix {
  const months = buckets(from, to, 'month');
  const column = new Map(months.map((m, i) => [m.key, i]));
  const zeros = (): Cents[] => months.map(() => 0);
  const sums = new Map<string, Cents[]>();
  const add = (key: string, i: number, cents: Cents) => {
    const values = sums.get(key) ?? zeros();
    values[i] = (values[i] ?? 0) + cents;
    sums.set(key, values);
  };

  for (const entry of entries) {
    if (!inRange(entry, from, to)) continue;
    const i = column.get(entry.date.slice(0, 7));
    if (i === undefined) continue;
    add(entry.line, i, entry.cents);
    add(`${entry.line}:${entry.category}`, i, entry.cents);
  }

  const get = (key: string) => sums.get(key) ?? zeros();
  const plus = (...cols: Cents[][]) =>
    zeros().map((_, i) => cols.reduce((sum, col) => sum + (col[i] ?? 0), 0));
  const row = (code: string, label: string, values: Cents[], level: 0 | 1 = 0): DreRow => ({
    code,
    label,
    level,
    bold: code === 'net' || code === 'result',
    values,
    total: values.reduce((sum, v) => sum + v, 0),
  });

  const net = plus(get('gross'), get('discounts'), get('refunds'), get('fees'));
  const other = row('gross.other', 'Outras receitas', get('gross:other'), 1);
  const expenseRows = [...expenseCategories]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((c) => row(`expenses.${c.id}`, c.name, get(`expenses:${c.id}`), 1))
    .filter((r) => r.total !== 0);

  const rows = [
    row('gross', '1. Receita bruta', get('gross')),
    row('gross.rental_single', 'Locação avulsa', get('gross:rental_single'), 1),
    row(
      'gross.subscriptions',
      'Assinaturas',
      plus(get('gross:subscription_initial'), get('gross:subscription_renewal')),
      1,
    ),
    row('gross.extra_hours', 'Horas extras', get('gross:extra_hours'), 1),
    row('gross.extra_services', 'Serviços extras', get('gross:extra_services'), 1),
    ...(other.total !== 0 ? [other] : []),
    row('discounts', '2. (−) Descontos, cupons e créditos concedidos', get('discounts')),
    row('refunds', '3. (−) Estornos e reembolsos', get('refunds')),
    row('fees', '4. (−) Taxas do gateway de pagamento', get('fees')),
    row('net', '5. = Receita líquida', net),
    row('expenses', '6. (−) Despesas operacionais', get('expenses')),
    ...expenseRows,
    row('result', '7. = Resultado do período', plus(net, get('expenses'))),
  ];

  return { months: months.map(({ key, label }) => ({ key, label })), rows };
}

const MONTHS_PER_STEP: Record<Exclude<ExpenseRecurrence, 'none'>, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** `date` plus whole months, the day clamped to the target month's last day. */
function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = dateParts(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)));
}

/**
 * Due child dates of a recurring expense: occurrence k of the parent's day-of-month anchor
 * (clamped to month end), after `lastChildDate` (or the parent) and on or before `today` (GES-14).
 */
export function nextOccurrences(
  parentDate: LocalDate,
  recurrence: ExpenseRecurrence,
  lastChildDate: LocalDate | null,
  today: LocalDate,
): LocalDate[] {
  if (recurrence === 'none') return [];
  const step = MONTHS_PER_STEP[recurrence];
  const after = lastChildDate ?? parentDate;
  const out: LocalDate[] = [];
  for (let k = 1; ; k += 1) {
    const date = addMonthsClamped(parentDate, k * step);
    if (date > today) return out;
    if (date > after) out.push(date);
  }
}
