import {
  formatBRL,
  percentOfCents,
  priceHourlyBooking,
  type Cents,
  type HourlyCategory,
  type LocalDate,
} from '@bravo/core';

/** "util" = a weekday; "especial" = weekend and holiday. */
export type SimulatorPeriod = 'util' | 'especial';

export interface Simulation {
  /** Hourly rate applied to the first segment, in cents. */
  rateCents: Cents;
  totalCents: Cents;
  /** Deposit paid at checkout (`payment.deposit_percent` of the total). */
  sinalCents: Cents;
  /** The rest, charged before the date. */
  saldoCents: Cents;
  /** Calculation memory, e.g. "2.0h × R$ 80,00/h (2 horas ou mais)". */
  formula: string;
}

/**
 * Reference days for the two periods: a Tuesday and a Saturday. The session starts at 10:00, or
 * at the opening time when the clinic opens later that day.
 */
const REFERENCE_DATE: Record<SimulatorPeriod, LocalDate> = {
  util: '2026-10-27',
  especial: '2026-10-31',
};
const DEFAULT_START_MINUTE = 600;

export interface SimulateOptions {
  categories: HourlyCategory[];
  period: SimulatorPeriod;
  hours: number;
  /** `payment.deposit_percent` from the public policies. */
  depositPercent: number;
  /** Opening minute of the reference day, from the clinic business hours. */
  openMinute?: number;
}

/**
 * Price of a booking of `hours` in the given period, computed by the core pricing engine over the
 * live catalog categories exactly as at checkout. Null when the categories cannot price it.
 */
export function simulateWith({
  categories,
  period,
  hours,
  depositPercent,
  openMinute,
}: SimulateOptions): Simulation | null {
  const startMinute = Math.max(DEFAULT_START_MINUTE, openMinute ?? 0);
  const priced = priceHourlyBooking({
    date: REFERENCE_DATE[period],
    startMinute,
    endMinute: startMinute + Math.round(hours * 60),
    isHoliday: false,
    categories,
  });
  const first = priced.ok ? priced.segments[0] : undefined;
  if (!priced.ok || !first) return null;

  const totalCents = priced.grossCents;
  const sinalCents = percentOfCents(totalCents, depositPercent);
  return {
    rateCents: first.rateCentsPerHour,
    totalCents,
    sinalCents,
    saldoCents: totalCents - sinalCents,
    formula: `${hours.toFixed(1)}h × ${formatBRL(first.rateCentsPerHour)}/h (${first.categoryName})`,
  };
}

/** Slider caption: "1 Hora", "2 Horas", "1,5 Horas". */
export function hoursLabel(hours: number): string {
  if (hours === 1) return '1 Hora';
  return `${String(hours).replace('.', ',')} Horas`;
}
