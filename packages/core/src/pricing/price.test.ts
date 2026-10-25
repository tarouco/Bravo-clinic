import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../time';
import {
  categoryAverageHourlyCents,
  fromPriceCents,
  selectHourlyCategory,
  type BlockCategory,
  type HourlyCategory,
} from './categories';
import { coverageBands, priceBlockBooking, priceHourlyBooking, vSlotForInterval } from './price';

// Factory hourly categories (design.md Seeds, PRD 5.3).
const UMA_HORA: HourlyCategory = {
  id: 'c1',
  name: '1 hora',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  appliesOnHolidays: true,
  startMinute: 0,
  endMinute: 1140,
  weekdayRateCents: 9700,
  weekendRateCents: 12000,
  minDurationMinutes: 60,
  status: 'active',
  isReference: true,
  displayOrder: 1,
};
const DUAS_HORAS: HourlyCategory = {
  ...UMA_HORA,
  id: 'c2',
  name: '2 horas ou mais',
  weekdayRateCents: 8000,
  weekendRateCents: 9900,
  minDurationMinutes: 120,
  isReference: false,
  displayOrder: 2,
};
const UMA_HORA_NOITE: HourlyCategory = {
  ...UMA_HORA,
  id: 'c3',
  name: '1 hora — noite',
  startMinute: 1140,
  endMinute: 1440,
  weekdayRateCents: 12000,
  weekendRateCents: 12000,
  isReference: false,
  displayOrder: 3,
};
const DUAS_HORAS_NOITE: HourlyCategory = {
  ...UMA_HORA_NOITE,
  id: 'c4',
  name: '2 horas ou mais — noite',
  weekdayRateCents: 9900,
  weekendRateCents: 9900,
  minDurationMinutes: 120,
  displayOrder: 4,
};
const FACTORY = [UMA_HORA, DUAS_HORAS, UMA_HORA_NOITE, DUAS_HORAS_NOITE];
const NOITE_1H_OFF = FACTORY.map((c) =>
  c.id === 'c3' ? { ...c, status: 'inactive' as const } : c,
);

const TUE: LocalDate = '2026-10-27';
const WED: LocalDate = '2026-10-28';
const SAT: LocalDate = '2026-10-31';
const FINADOS: LocalDate = '2026-11-02';

const price = (
  date: LocalDate,
  startMinute: number,
  endMinute: number,
  categories = FACTORY,
  isHoliday = false,
) => priceHourlyBooking({ date, startMinute, endMinute, isHoliday, categories });

const segment = (
  startMinute: number,
  endMinute: number,
  cat: HourlyCategory,
  dayType: 'weekday' | 'weekend_holiday',
  rateCentsPerHour: number,
  amountCents: number,
) => ({
  startMinute,
  endMinute,
  minutes: endMinute - startMinute,
  categoryId: cat.id,
  categoryName: cat.name,
  dayType,
  rateCentsPerHour,
  amountCents,
});

describe('priceHourlyBooking with W-PR (NUC-19, NUC-20)', () => {
  it('PR-1: Tue 14:00-17:00 is "2 horas ou mais", 180 min x 8000 = 24000', () => {
    expect(price(TUE, 840, 1020)).toEqual({
      ok: true,
      segments: [segment(840, 1020, DUAS_HORAS, 'weekday', 8000, 24000)],
      grossCents: 24000,
    });
  });

  it('PR-2: Tue 14:00-15:00 is "1 hora", 60 min x 9700 = 9700', () => {
    expect(price(TUE, 840, 900)).toEqual({
      ok: true,
      segments: [segment(840, 900, UMA_HORA, 'weekday', 9700, 9700)],
      grossCents: 9700,
    });
  });

  it('PR-3: Tue 17:30-20:00 is 12000 + 9900 = 21900 in two segments', () => {
    expect(price(TUE, 1050, 1200)).toEqual({
      ok: true,
      segments: [
        segment(1050, 1140, DUAS_HORAS, 'weekday', 8000, 12000),
        segment(1140, 1200, DUAS_HORAS_NOITE, 'weekday', 9900, 9900),
      ],
      grossCents: 21900,
    });
  });

  it('PR-4: Sat 10:00-13:00 is "2 horas ou mais" at the weekend rate, 9900 x 3 = 29700', () => {
    expect(price(SAT, 600, 780)).toEqual({
      ok: true,
      segments: [segment(600, 780, DUAS_HORAS, 'weekend_holiday', 9900, 29700)],
      grossCents: 29700,
    });
  });

  it('PR-5: Wed 19:00-20:00 is "1 hora — noite", 12000', () => {
    expect(price(WED, 1140, 1200)).toEqual({
      ok: true,
      segments: [segment(1140, 1200, UMA_HORA_NOITE, 'weekday', 12000, 12000)],
      grossCents: 12000,
    });
  });

  it('PR-6: holiday Mon 2026-11-02 10:00-11:00 is "1 hora" at the weekend rate, 12000', () => {
    expect(price(FINADOS, 600, 660, FACTORY, true)).toEqual({
      ok: true,
      segments: [segment(600, 660, UMA_HORA, 'weekend_holiday', 12000, 12000)],
      grossCents: 12000,
    });
  });

  it('PR-7: Tue 18:00-19:30 is 9700 + 6000 = 15700', () => {
    expect(price(TUE, 1080, 1170)).toEqual({
      ok: true,
      segments: [
        segment(1080, 1140, UMA_HORA, 'weekday', 9700, 9700),
        segment(1140, 1170, UMA_HORA_NOITE, 'weekday', 12000, 6000),
      ],
      grossCents: 15700,
    });
  });

  it('PR-8: with "1 hora — noite" inactive, Tue 19:00-20:00 has no category', () => {
    expect(price(TUE, 1140, 1200, NOITE_1H_OFF)).toEqual({
      ok: false,
      reason: 'no_category',
      uncovered: { startMinute: 1140, endMinute: 1200 },
    });
  });

  it('reports the first uncovered range when only part of the interval lacks a category', () => {
    expect(
      price(
        TUE,
        1080,
        1260,
        NOITE_1H_OFF.filter((c) => c.id !== 'c4'),
      ),
    ).toEqual({
      ok: false,
      reason: 'no_category',
      uncovered: { startMinute: 1140, endMinute: 1260 },
    });
  });

  it('rounds each segment half up: 9701 x 90 min = 14552 (NUC-21)', () => {
    const cat = { ...UMA_HORA, weekdayRateCents: 9701 };
    expect(price(TUE, 600, 690, [cat])).toEqual({
      ok: true,
      segments: [segment(600, 690, cat, 'weekday', 9701, 14552)],
      grossCents: 14552,
    });
  });
});

describe('selectHourlyCategory (NUC-18)', () => {
  const tuesday = { weekday: 2, isHoliday: false, minuteFrom: 840, minuteTo: 1020 };

  it('picks the largest minimum duration met by the whole booking', () => {
    expect(selectHourlyCategory(FACTORY, { ...tuesday, bookingDurationMinutes: 180 })?.name).toBe(
      '2 horas ou mais',
    );
    expect(selectHourlyCategory(FACTORY, { ...tuesday, bookingDurationMinutes: 60 })?.name).toBe(
      '1 hora',
    );
  });

  it('breaks ties by the lowest display order, whatever the list order', () => {
    const twin = { ...DUAS_HORAS, id: 'twin', name: 'Gêmea', displayOrder: 9 };
    const first = { ...DUAS_HORAS, displayOrder: 2 };
    expect(
      selectHourlyCategory([twin, first], { ...tuesday, bookingDurationMinutes: 180 })?.id,
    ).toBe('c2');
    expect(
      selectHourlyCategory([first, { ...twin, displayOrder: 1 }], {
        ...tuesday,
        bookingDurationMinutes: 180,
      })?.id,
    ).toBe('twin');
  });

  it('ignores inactive categories', () => {
    const off = FACTORY.map((c) => (c.id === 'c2' ? { ...c, status: 'inactive' as const } : c));
    expect(selectHourlyCategory(off, { ...tuesday, bookingDurationMinutes: 180 })?.name).toBe(
      '1 hora',
    );
    expect(price(TUE, 840, 1020, off)).toMatchObject({ ok: true, grossCents: 29100 });
  });
});

describe('priceBlockBooking (NUC-23)', () => {
  const manha: BlockCategory = {
    id: 'b1',
    name: 'Manhã',
    weekdays: [1, 2, 3, 4, 5],
    appliesOnHolidays: false,
    startMinute: 420,
    endMinute: 720,
    fixedPriceCents: 28000,
  };
  const fimDeSemana: BlockCategory = {
    ...manha,
    id: 'b2',
    name: 'Meio turno fim de semana',
    weekdays: [6, 7],
    appliesOnHolidays: true,
    fixedPriceCents: 40000,
  };

  it('returns the fixed price and window on an applicable weekday', () => {
    expect(priceBlockBooking(manha, { date: TUE, isHoliday: false })).toEqual({
      grossCents: 28000,
      startMinute: 420,
      endMinute: 720,
    });
  });

  it('returns null on a weekday outside its days', () => {
    expect(priceBlockBooking(manha, { date: SAT, isHoliday: false })).toBeNull();
  });

  it('follows the holiday flag on a holiday', () => {
    expect(priceBlockBooking(manha, { date: FINADOS, isHoliday: true })).toBeNull();
    expect(priceBlockBooking(fimDeSemana, { date: FINADOS, isHoliday: true })).toEqual({
      grossCents: 40000,
      startMinute: 420,
      endMinute: 720,
    });
  });
});

describe('categoryAverageHourlyCents with W-AV (NUC-22)', () => {
  it('AV-1: Pacote 20h mensal, 160000 / 1200 min = 8000', () => {
    expect(
      categoryAverageHourlyCents({
        type: 'hour_package',
        id: 'p1',
        name: 'Pacote 20h mensal',
        fixedPriceCents: 160000,
        includedMinutes: 1200,
      }),
    ).toBe(8000);
  });

  it('AV-2: Meio turno mensal, 28000 per occurrence over 07:00-09:30 = 11200', () => {
    expect(
      categoryAverageHourlyCents({
        type: 'fixed_schedule',
        id: 'f1',
        name: 'Meio turno mensal',
        startMinute: 420,
        endMinute: 570,
        pricePerOccurrenceCents: 28000,
      }),
    ).toBe(11200);
  });

  it('AV-3: Bloco "Manhã" 07:00-12:00 at 28000 = 5600', () => {
    expect(
      categoryAverageHourlyCents({
        type: 'block',
        id: 'b1',
        name: 'Manhã',
        weekdays: [1, 2, 3, 4, 5],
        appliesOnHolidays: false,
        startMinute: 420,
        endMinute: 720,
        fixedPriceCents: 28000,
      }),
    ).toBe(5600);
  });

  it('AV-4: hourly "1 hora" is its weekday rate, 9700', () => {
    expect(categoryAverageHourlyCents({ type: 'hourly', ...UMA_HORA })).toBe(9700);
  });
});

describe('coverageBands (NUC-24)', () => {
  const tuesday = { weekday: 2, isHoliday: false };
  const weekdayWindow = { openMinute: 420, closeMinute: 1440 };
  const weekendWindow = { openMinute: 540, closeMinute: 1440 };

  it('draws one band per applicable category with its rate, clipped to the window', () => {
    expect(coverageBands(FACTORY, tuesday, weekdayWindow, 60).bands).toEqual([
      { categoryId: 'c1', name: '1 hora', startMinute: 420, endMinute: 1140, rateCents: 9700 },
      {
        categoryId: 'c2',
        name: '2 horas ou mais',
        startMinute: 420,
        endMinute: 1140,
        rateCents: 8000,
      },
      {
        categoryId: 'c3',
        name: '1 hora — noite',
        startMinute: 1140,
        endMinute: 1440,
        rateCents: 12000,
      },
      {
        categoryId: 'c4',
        name: '2 horas ou mais — noite',
        startMinute: 1140,
        endMinute: 1440,
        rateCents: 9900,
      },
    ]);
  });

  it.each([
    ['Monday', { weekday: 1, isHoliday: false }, weekdayWindow],
    ['Tuesday', { weekday: 2, isHoliday: false }, weekdayWindow],
    ['Wednesday', { weekday: 3, isHoliday: false }, weekdayWindow],
    ['Thursday', { weekday: 4, isHoliday: false }, weekdayWindow],
    ['Friday', { weekday: 5, isHoliday: false }, weekdayWindow],
    ['Saturday', { weekday: 6, isHoliday: false }, weekendWindow],
    ['Sunday', { weekday: 7, isHoliday: false }, weekendWindow],
    ['holiday', { weekday: 1, isHoliday: true }, weekendWindow],
  ])('factory categories leave nothing uncovered for 60 minutes on %s', (_name, day, window) => {
    expect(coverageBands(FACTORY, day, window, 60).uncovered).toEqual([]);
  });

  it('with "1 hora — noite" inactive, Tuesday reports 19:00-00:00 uncovered', () => {
    const result = coverageBands(NOITE_1H_OFF, tuesday, weekdayWindow, 60);
    expect(result.uncovered).toEqual([{ startMinute: 1140, endMinute: 1440 }]);
    expect(result.bands.map((b) => b.categoryId)).toEqual(['c1', 'c2', 'c4']);
  });

  it('weekend bands carry the weekend rate', () => {
    expect(
      coverageBands(FACTORY, { weekday: 6, isHoliday: false }, weekendWindow, 60).bands[0],
    ).toEqual({
      categoryId: 'c1',
      name: '1 hora',
      startMinute: 540,
      endMinute: 1140,
      rateCents: 12000,
    });
  });
});

describe('fromPriceCents', () => {
  it('is the lowest weekday or weekend rate of the active categories: 8000 (NUC-74)', () => {
    expect(fromPriceCents(FACTORY)).toBe(8000);
    const off = FACTORY.map((c) => (c.id === 'c2' ? { ...c, status: 'inactive' as const } : c));
    expect(fromPriceCents(off)).toBe(9700);
    expect(fromPriceCents([])).toBeNull();
  });
});

describe('vSlotForInterval (architecture 7.8 V_slot)', () => {
  const v = (date: LocalDate, from: number, to: number, duration: number, isHoliday = false) =>
    vSlotForInterval({
      date,
      isHoliday,
      minuteFrom: from,
      minuteTo: to,
      bookingDurationMinutes: duration,
      categories: FACTORY,
    });

  it('uses the category chosen for the whole booking duration', () => {
    expect(v(TUE, 600, 720, 120)).toBe(8000);
    expect(v(WED, 1140, 1200, 60)).toBe(12000);
    expect(v(SAT, 600, 780, 180)).toBe(9900);
    expect(v(TUE, 1050, 1140, 150)).toBe(8000);
    expect(v(TUE, 1140, 1200, 150)).toBe(9900);
  });

  it('is null when no category applies', () => {
    expect(
      vSlotForInterval({
        date: TUE,
        isHoliday: false,
        minuteFrom: 1140,
        minuteTo: 1200,
        bookingDurationMinutes: 60,
        categories: NOITE_1H_OFF,
      }),
    ).toBeNull();
  });
});
