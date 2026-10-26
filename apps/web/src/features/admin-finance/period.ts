import {
  financeGroupingSchema,
  financeRegimeSchema,
  financeQuerySchema,
  localDateSchema,
  utcToLocal,
  type FinanceQuery,
  type Grouping,
  type LocalDate,
  type Regime,
} from '@bravo/core';
import { formatLocalDateBR } from '../../lib/format';

/** Today in the clinic's time zone. */
export function todayLocal(now: Date = new Date()): LocalDate {
  return utcToLocal(now).date;
}

/** First day of the month five months before `today`'s, through `today` (GES-26: last 6 months). */
export function defaultRange(today: LocalDate): { from: LocalDate; to: LocalDate } {
  const [year = 0, month = 1] = today.split('-').map(Number);
  const index = year * 12 + (month - 1) - 5;
  const fromYear = Math.floor(index / 12);
  const fromMonth = (index % 12) + 1;
  const from = `${String(fromYear).padStart(4, '0')}-${String(fromMonth).padStart(2, '0')}-01`;
  return { from: from as LocalDate, to: today };
}

export interface RawFinanceParams {
  from: string;
  to: string;
  grouping: Grouping;
  regime: Regime;
}

/**
 * The finance selection kept in the URL search params (`from`, `to`, `grouping`, `regime`; GES-28).
 * A missing or unreadable param falls back to its default: Caixa, month, last 6 months.
 */
export function readFinanceParams(params: URLSearchParams, today: LocalDate): RawFinanceParams {
  const range = defaultRange(today);
  const date = (value: string | null, fallback: LocalDate): string =>
    value !== null && localDateSchema.safeParse(value).success ? value : fallback;
  const grouping = financeGroupingSchema.safeParse(params.get('grouping'));
  const regime = financeRegimeSchema.safeParse(params.get('regime'));
  return {
    from: date(params.get('from'), range.from),
    to: date(params.get('to'), range.to),
    grouping: grouping.success ? grouping.data : 'month',
    regime: regime.success ? regime.data : 'cash',
  };
}

/** The validated query, or the message for the range field when the selection is refused (GES-25). */
export function validateFinanceParams(
  raw: RawFinanceParams,
): { ok: true; query: FinanceQuery } | { ok: false; message: string } {
  const parsed = financeQuerySchema.safeParse(raw);
  if (parsed.success) return { ok: true, query: parsed.data };
  return { ok: false, message: parsed.error.issues[0]?.message ?? 'Período inválido' };
}

/** "03/11/2025–30/04/2026" */
export function formatRange(from: string, to: string): string {
  return `${formatLocalDateBR(from)}–${formatLocalDateBR(to)}`;
}
