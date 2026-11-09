import { describe, expect, it } from 'vitest';
import { businessHours, catalog } from '../../test/fixtures/nucleo';
import { businessHoursSummary } from './business-hours';
import { buildTariffGroups as build, discountFromMinutes, hoursPhrase } from './tariffs';

/** The groups with formatBRL's no-break spaces as plain spaces (`\s` matches them). */
const buildTariffGroups = (...args: Parameters<typeof build>) =>
  JSON.parse(JSON.stringify(build(...args)).replace(/\s/g, ' ')) as ReturnType<typeof build>;

describe('buildTariffGroups', () => {
  it('groups the catalog by day kind and window, clipped to the business hours', () => {
    const groups = buildTariffGroups(catalog, [...businessHours]);

    expect(groups.map((g) => g.title)).toEqual([
      'Dias úteis (07:00 às 19:00)',
      'Todos os dias (19:00 às 00:00)',
      'Sábados, domingos e feriados (09:00 às 19:00)',
    ]);
    expect(groups[0]?.rows).toEqual([
      { label: '1 hora', price: 'R$ 97,00/h', highlight: false },
      { label: '2 horas ou mais', price: 'R$ 80,00/h', highlight: true },
      { label: 'Meio turno comercial (07:00–09:30)', price: 'R$ 280,00', highlight: false },
      { label: 'Turno completo comercial (07:00–12:00)', price: 'R$ 500,00', highlight: false },
    ]);
    expect(groups[1]?.rows.map((r) => r.price)).toEqual(['R$ 120,00/h', 'R$ 99,00/h']);
    expect(groups[2]?.rows.map((r) => r.price)).toEqual(['R$ 120,00/h', 'R$ 99,00/h']);
  });

  it('shows a rate, a name and a new category edited in the admin', () => {
    const edited = {
      ...catalog,
      hourly: [
        ...catalog.hourly.map((c) =>
          c.name === '2 horas ou mais' ? { ...c, name: 'Pacote 2h+', weekdayRateCents: 8500 } : c,
        ),
        {
          ...catalog.hourly[0]!,
          id: 'x',
          name: '3 horas ou mais',
          minDurationMinutes: 180,
          weekdayRateCents: 7000,
          displayOrder: 9,
        },
      ],
    };

    const rows = buildTariffGroups(edited, [...businessHours])[0]?.rows ?? [];

    expect(rows.find((r) => r.label === 'Pacote 2h+')?.price).toBe('R$ 85,00/h');
    expect(rows.find((r) => r.label === '3 horas ou mais')).toEqual({
      label: '3 horas ou mais',
      price: 'R$ 70,00/h',
      highlight: true,
    });
  });

  it('leaves out windows when the clinic is closed', () => {
    const closedWeekend = businessHours.map((h) =>
      ['sat', 'sun', 'holiday'].includes(h.dayType) ? { ...h, isClosed: true } : h,
    );

    const titles = buildTariffGroups(catalog, closedWeekend).map((g) => g.title);

    expect(titles.some((t) => t.startsWith('Sábados'))).toBe(false);
  });
});

describe('discountFromMinutes', () => {
  it('is the duration from which a cheaper rate applies', () => {
    expect(discountFromMinutes(catalog.hourly)).toBe(120);
    expect(hoursPhrase(120)).toBe('2 horas');
    expect(hoursPhrase(90)).toBe('1h30');
  });

  it('is null without a progressive discount', () => {
    expect(discountFromMinutes(catalog.hourly.filter((c) => c.minDurationMinutes === 60))).toBe(
      null,
    );
  });
});

describe('businessHoursSummary', () => {
  it('groups days with the same hours', () => {
    expect(businessHoursSummary(businessHours)).toBe(
      'Seg a sex 07:00–00:00 · Sáb e feriados 09:00–00:00 · Dom fechado',
    );
  });
});
