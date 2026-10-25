import {
  formatBRL,
  percentOfCents,
  priceHourlyBooking,
  type Cents,
  type HourlyCategory,
  type LocalDate,
} from '@bravo/core';
import { FACTORY_HOURLY_CATEGORIES } from './factory-categories';

/** "util" = weekday business hours; "especial" = night, weekend and holiday. */
export type SimulatorPeriod = 'util' | 'especial';

export interface Simulation {
  /** Hourly rate applied to the first segment, in cents. */
  rateCents: Cents;
  totalCents: Cents;
  /** 50% paid at checkout. */
  sinalCents: Cents;
  /** The remaining 50%, charged 48h before the date. */
  saldoCents: Cents;
  /** Calculation memory, e.g. "2.0h × R$ 80,00/h (Tarifa Desconto)". */
  formula: string;
}

/**
 * Reference days and start for the two periods: a Tuesday and a Saturday at 10:00, which sit in the
 * daytime window of the factory categories (weekday rates and weekend/holiday rates).
 */
const REFERENCE: Record<SimulatorPeriod, { date: LocalDate; label: string }> = {
  util: { date: '2026-10-27', label: 'Tarifa Desconto' },
  especial: { date: '2026-10-31', label: 'Tarifa Noite/Fim de semana' },
};
const START_MINUTE = 600;

/** From this many hours on, the discounted tariff applies to every hour. */
const DISCOUNT_FROM_HOURS = 2;

/**
 * Price of a booking of `hours` (multiples of 0.5) in the given period, computed by the core
 * pricing engine over `categories` (the live catalog): the category rates apply as they would at
 * checkout; sinal and saldo are 50% each. Null when the categories cannot price the interval.
 */
export function simulateWith(
  categories: HourlyCategory[],
  period: SimulatorPeriod,
  hours: number,
): Simulation | null {
  const { date, label } = REFERENCE[period];
  const priced = priceHourlyBooking({
    date,
    startMinute: START_MINUTE,
    endMinute: START_MINUTE + Math.round(hours * 60),
    isHoliday: false,
    categories,
  });
  const first = priced.ok ? priced.segments[0] : undefined;
  if (!priced.ok || !first) return null;

  const totalCents = priced.grossCents;
  const sinalCents = percentOfCents(totalCents, 50);
  const suffix = hours >= DISCOUNT_FROM_HOURS ? ` (${label})` : '';
  return {
    rateCents: first.rateCentsPerHour,
    totalCents,
    sinalCents,
    saldoCents: totalCents - sinalCents,
    formula: `${hours.toFixed(1)}h × ${formatBRL(first.rateCentsPerHour)}/h${suffix}`,
  };
}

/** The simulation with the factory categories (PRD 5.3), which always price a 1-6 hour session. */
export function simulate(period: SimulatorPeriod, hours: number): Simulation {
  const result = simulateWith(FACTORY_HOURLY_CATEGORIES, period, hours);
  if (!result) throw new Error('Factory categories must price every simulator session');
  return result;
}

/** Slider caption: "1 Hora", "2 Horas", "1,5 Horas". */
export function hoursLabel(hours: number): string {
  if (hours === 1) return '1 Hora';
  return `${String(hours).replace('.', ',')} Horas`;
}
