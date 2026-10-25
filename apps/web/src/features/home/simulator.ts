import { formatBRL, mulDivRoundHalfUp, percentOfCents, type Cents } from '@bravo/core';

/** "util" = weekday business hours; "especial" = night, weekend and holiday. */
export type SimulatorPeriod = 'util' | 'especial';

export interface Simulation {
  /** Hourly rate applied to every hour, in cents. */
  rateCents: Cents;
  totalCents: Cents;
  /** 50% paid at checkout. */
  sinalCents: Cents;
  /** The remaining 50%, charged 48h before the date. */
  saldoCents: Cents;
  /** Calculation memory, e.g. "2.0h × R$ 80,00/h (Tarifa Desconto)". */
  formula: string;
}

/** Factory-default tariff (docs/prd.md section 5.3). `nucleo` replaces this with `@bravo/core` pricing. */
const TARIFF: Record<
  SimulatorPeriod,
  { singleHourCents: Cents; discountCents: Cents; label: string }
> = {
  util: { singleHourCents: 9700, discountCents: 8000, label: 'Tarifa Desconto' },
  especial: { singleHourCents: 12000, discountCents: 9900, label: 'Tarifa Noite/Fim de semana' },
};

/** From this many hours on, the discounted rate applies to every hour. */
const DISCOUNT_FROM_HOURS = 2;

/**
 * Price of a booking of `hours` (multiples of 0.5) in the given period: under 2h the single-hour
 * rate, from 2h the discounted rate on all hours; sinal and saldo are 50% each.
 */
export function simulate(period: SimulatorPeriod, hours: number): Simulation {
  const tariff = TARIFF[period];
  const discounted = hours >= DISCOUNT_FROM_HOURS;
  const rateCents = discounted ? tariff.discountCents : tariff.singleHourCents;
  const totalCents = mulDivRoundHalfUp(rateCents, Math.round(hours * 2), 2);
  const sinalCents = percentOfCents(totalCents, 50);
  const suffix = discounted ? ` (${tariff.label})` : '';

  return {
    rateCents,
    totalCents,
    sinalCents,
    saldoCents: totalCents - sinalCents,
    formula: `${hours.toFixed(1)}h × ${formatBRL(rateCents)}/h${suffix}`,
  };
}

/** Slider caption: "1 Hora", "2 Horas", "1,5 Horas". */
export function hoursLabel(hours: number): string {
  if (hours === 1) return '1 Hora';
  return `${String(hours).replace('.', ',')} Horas`;
}
