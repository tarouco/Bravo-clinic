import type { HourlyCategory } from '@bravo/core';
import { describe, expect, it } from 'vitest';
import { hoursLabel, simulateWith, type SimulateOptions } from './simulator';

const everyDay = [1, 2, 3, 4, 5, 6, 7];
const category = (
  name: string,
  window: [number, number],
  rates: [number, number],
  minDurationMinutes: number,
  displayOrder: number,
): HourlyCategory => ({
  id: name,
  name,
  weekdays: everyDay,
  appliesOnHolidays: true,
  startMinute: window[0],
  endMinute: window[1],
  weekdayRateCents: rates[0],
  weekendRateCents: rates[1],
  minDurationMinutes,
  status: 'active',
  isReference: displayOrder === 1,
  displayOrder,
});

/** A catalog shaped like the seeded one (the admin can change every number). */
const categories: HourlyCategory[] = [
  category('1 hora', [0, 1140], [9700, 12000], 60, 1),
  category('2 horas ou mais', [0, 1140], [8000, 9900], 120, 2),
  category('1 hora — noite', [1140, 1440], [12000, 12000], 60, 3),
  category('2 horas ou mais — noite', [1140, 1440], [9900, 9900], 120, 4),
];

const run = (overrides: Partial<SimulateOptions>) => {
  const result = simulateWith({
    categories,
    period: 'util',
    hours: 2,
    depositPercent: 50,
    ...overrides,
  });
  // formatBRL separates "R$" with a no-break space; \s matches it.
  return result && { ...result, formula: result.formula.replace(/\s/g, ' ') };
};

describe('simulateWith', () => {
  it('util 2h: the 2-hour rate on every hour, sinal and saldo split by the deposit percent', () => {
    const result = run({});

    expect(result?.totalCents).toBe(16000);
    expect(result?.sinalCents).toBe(8000);
    expect(result?.saldoCents).toBe(8000);
    expect(result?.rateCents).toBe(8000);
  });

  it('util 1.5h: half hours are prorated at the single-hour rate', () => {
    expect(run({ hours: 1.5 })?.totalCents).toBe(14550);
  });

  it('especial uses the weekend rates', () => {
    expect(run({ period: 'especial' })?.totalCents).toBe(19800);
    expect(run({ period: 'especial', hours: 1 })?.totalCents).toBe(12000);
  });

  it('follows the deposit percent configured in the admin', () => {
    const result = run({ depositPercent: 30 });

    expect(result?.sinalCents).toBe(4800);
    expect(result?.saldoCents).toBe(11200);
  });

  it('reflects a rate edited in the admin', () => {
    const edited = categories.map((c) =>
      c.name === '2 horas ou mais' ? { ...c, weekdayRateCents: 9000 } : c,
    );

    expect(run({ categories: edited })?.totalCents).toBe(18000);
  });

  it('names the applied category in the calculation memory', () => {
    expect(run({})?.formula).toBe('2.0h × R$ 80,00/h (2 horas ou mais)');
    expect(run({ hours: 1 })?.formula).toBe('1.0h × R$ 97,00/h (1 hora)');
  });

  it('starts at the opening time when the clinic opens after 10:00', () => {
    const lateOnly = [category('Tarde', [780, 1140], [5000, 5000], 60, 1)];

    expect(run({ categories: lateOnly })).toBeNull();
    expect(run({ categories: lateOnly, openMinute: 780 })?.totalCents).toBe(10000);
  });

  it('returns null when no category covers the session', () => {
    const nightOnly = categories.filter((c) => c.startMinute >= 1140);

    expect(run({ categories: nightOnly })).toBeNull();
  });
});

describe('hoursLabel', () => {
  it('formats the slider caption in pt-BR', () => {
    expect(hoursLabel(1)).toBe('1 Hora');
    expect(hoursLabel(2)).toBe('2 Horas');
    expect(hoursLabel(1.5)).toBe('1,5 Horas');
    expect(hoursLabel(6)).toBe('6 Horas');
  });
});
