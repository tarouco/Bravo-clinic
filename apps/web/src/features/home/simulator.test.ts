import { describe, expect, it } from 'vitest';
import { FACTORY_HOURLY_CATEGORIES } from './factory-categories';
import { hoursLabel, simulate, simulateWith } from './simulator';

describe('simulate', () => {
  it('util 2h: R$ 80/h on every hour, sinal and saldo 50% each', () => {
    const result = simulate('util', 2);

    expect(result.totalCents).toBe(16000);
    expect(result.sinalCents).toBe(8000);
    expect(result.saldoCents).toBe(8000);
    expect(result.rateCents).toBe(8000);
  });

  it('util 1h: single-hour rate R$ 97,00', () => {
    expect(simulate('util', 1).totalCents).toBe(9700);
  });

  it('util 1.5h: half hours are prorated at the single-hour rate', () => {
    const result = simulate('util', 1.5);

    expect(result.totalCents).toBe(14550);
    expect(result.sinalCents).toBe(7275);
    expect(result.saldoCents).toBe(7275);
  });

  it('especial 2h: R$ 99/h -> R$ 198,00', () => {
    expect(simulate('especial', 2).totalCents).toBe(19800);
  });

  it('especial 1h: R$ 120,00', () => {
    expect(simulate('especial', 1).totalCents).toBe(12000);
  });

  it('builds the calculation memory like the reference', () => {
    expect(simulate('util', 2).formula).toBe('2.0h × R$ 80,00/h (Tarifa Desconto)');
    expect(simulate('util', 1).formula).toBe('1.0h × R$ 97,00/h');
    expect(simulate('especial', 2.5).formula).toBe(
      '2.5h × R$ 99,00/h (Tarifa Noite/Fim de semana)',
    );
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

describe('simulateWith', () => {
  it('prices 2 weekday hours from the given categories (rate 9000 -> R$ 180,00)', () => {
    const categories = FACTORY_HOURLY_CATEGORIES.map((c) =>
      c.name === '2 horas ou mais' ? { ...c, weekdayRateCents: 9000 } : c,
    );

    const result = simulateWith(categories, 'util', 2);

    expect(result?.totalCents).toBe(18000);
    expect(result?.sinalCents).toBe(9000);
    expect(result?.rateCents).toBe(9000);
  });

  it('returns null when no category covers the session', () => {
    const nightOnly = FACTORY_HOURLY_CATEGORIES.filter((c) => c.startMinute >= 1140);

    expect(simulateWith(nightOnly, 'util', 2)).toBeNull();
  });
});
