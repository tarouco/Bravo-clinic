import { describe, expect, it } from 'vitest';
import {
  estimateFixedPeriod,
  findOccurrenceConflicts,
  fixedPeriodPriceCents,
  generateOccurrences,
  occurrenceConflictLabel,
  type Occurrence,
} from './occurrences';
import { localToUtc, weekdayOf, type LocalDate } from '../time';
import type { Occupied } from '../slots/grid';

// "Meio turno mensal": Mon–Fri 07:00–09:30, R$ 280,00 per occurrence (architecture 7.11).
const meioTurno = {
  baseOn: '2026-11-02' as LocalDate,
  periodDays: 30,
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 420,
  endMinute: 570,
};

describe('generateOccurrences (REC-83, REC-89, REC-90)', () => {
  const occ = generateOccurrences(meioTurno);

  it('returns 22 occurrences for Meio turno mensal from 2026-11-02 over 30 days', () => {
    expect(occ).toHaveLength(22);
    expect(occ[0]?.date).toBe('2026-11-02');
    expect(occ[0]?.startsAt.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(occ[0]?.endsAt.toISOString()).toBe('2026-11-02T12:30:00.000Z');
    expect(occ.at(-1)?.date).toBe('2026-12-01');
    expect(occ.every((o) => weekdayOf(o.date) <= 5)).toBe(true);
  });

  it('prices the period at 22 × R$ 280,00 = 616000', () => {
    expect(fixedPeriodPriceCents(28000, occ.length)).toBe(616000);
    expect(fixedPeriodPriceCents(28000, 22)).toBe(616000);
  });

  it('keeps the holidays 2026-11-02 (Finados) and 2026-11-20 (Consciência Negra)', () => {
    const dates = occ.map((o) => o.date);
    expect(dates).toContain('2026-11-02');
    expect(dates).toContain('2026-11-20');
  });

  it('drops occurrences starting before notBefore and keeps one starting exactly at it', () => {
    const later = generateOccurrences({
      ...meioTurno,
      notBefore: new Date('2026-11-04T10:00:01.000Z'),
    });
    expect(later).toHaveLength(19);
    expect(later[0]?.date).toBe('2026-11-05');
    const exact = generateOccurrences({
      ...meioTurno,
      notBefore: new Date('2026-11-04T10:00:00.000Z'),
    });
    expect(exact[0]?.date).toBe('2026-11-04');
  });

  it('ends a window closing at 1440 at 00:00 of the next local day', () => {
    const late = generateOccurrences({
      baseOn: '2026-11-06',
      periodDays: 7,
      weekdays: [5],
      startMinute: 1320,
      endMinute: 1440,
    });
    expect(late).toHaveLength(1);
    expect(late[0]?.startsAt.toISOString()).toBe('2026-11-07T01:00:00.000Z');
    expect(late[0]?.endsAt.toISOString()).toBe(localToUtc('2026-11-07', 0).toISOString());
    expect(late[0]?.endsAt.toISOString()).toBe('2026-11-07T03:00:00.000Z');
  });
});

describe('estimateFixedPeriod (REC-04)', () => {
  it('Mon–Fri, 30 days, R$ 280,00 → 20–22 occurrences, R$ 5.600,00 – R$ 6.160,00', () => {
    expect(
      estimateFixedPeriod({
        weekdays: [1, 2, 3, 4, 5],
        periodDays: 30,
        pricePerOccurrenceCents: 28000,
      }),
    ).toEqual({ minCount: 20, maxCount: 22, minCents: 560000, maxCents: 616000 });
  });

  it('counts over the 7 possible start weekdays: one weekday over 30 days → 4..5', () => {
    expect(
      estimateFixedPeriod({ weekdays: [3], periodDays: 30, pricePerOccurrenceCents: 10000 }),
    ).toEqual({ minCount: 4, maxCount: 5, minCents: 40000, maxCents: 50000 });
  });
});

describe('findOccurrenceConflicts and occurrenceConflictLabel (REC-84, REC-85)', () => {
  const room = 'room-principal';
  const dates: LocalDate[] = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const occ: Occurrence[] = generateOccurrences({ ...meioTurno, periodDays: 5 });
  const openWindows = () =>
    new Map<LocalDate, { openMinute: number; closeMinute: number } | null>(
      dates.map((d) => [d, { openMinute: 360, closeMinute: 1320 }]),
    );
  const at = (date: LocalDate, minute: number) => localToUtc(date, minute);
  const booking = (date: LocalDate, start: number, end: number, cleanup = 30): Occupied => ({
    start: at(date, start),
    end: at(date, end),
    occupiedUntil: at(date, end + cleanup),
    kind: 'booking',
  });
  const base = { closedDays: [], roomId: room, occupied: [], cleanupMinutes: 30 };

  it('reports nothing when every date is open and free (holiday 2026-11-02 included)', () => {
    expect(occ).toHaveLength(5);
    expect(findOccurrenceConflicts(occ, { ...base, windows: openWindows() })).toEqual([]);
  });

  it('reports a clinic closed day and a closed day of the same room, not of another room', () => {
    const conflicts = findOccurrenceConflicts(occ, {
      ...base,
      closedDays: [
        { date: '2026-11-03', roomId: null },
        { date: '2026-11-04', roomId: room },
        { date: '2026-11-05', roomId: 'room-secundaria' },
      ],
      windows: openWindows(),
    });
    expect(conflicts).toEqual([
      { date: '2026-11-03', reason: 'closed' },
      { date: '2026-11-04', reason: 'closed' },
    ]);
    expect(occurrenceConflictLabel('closed')).toBe('Dia fechado');
  });

  it('reports a date without business window as closed (null or missing)', () => {
    const windows = openWindows();
    windows.set('2026-11-05', null);
    windows.delete('2026-11-06');
    expect(findOccurrenceConflicts(occ, { ...base, windows })).toEqual([
      { date: '2026-11-05', reason: 'closed' },
      { date: '2026-11-06', reason: 'closed' },
    ]);
  });

  it('reports an occurrence outside the business window', () => {
    const windows = openWindows();
    windows.set('2026-11-04', { openMinute: 480, closeMinute: 1320 });
    windows.set('2026-11-05', { openMinute: 360, closeMinute: 540 });
    expect(findOccurrenceConflicts(occ, { ...base, windows })).toEqual([
      { date: '2026-11-04', reason: 'outside_hours' },
      { date: '2026-11-05', reason: 'outside_hours' },
    ]);
    expect(occurrenceConflictLabel('outside_hours')).toBe('Fora do horário de funcionamento');
  });

  it('reports a booking overlapping the occurrence', () => {
    const conflicts = findOccurrenceConflicts(occ, {
      ...base,
      occupied: [booking('2026-11-03', 480, 540)],
      windows: openWindows(),
    });
    expect(conflicts).toEqual([{ date: '2026-11-03', reason: 'overlaps_booking' }]);
    expect(occurrenceConflictLabel('overlaps_booking')).toBe('Já reservado');
  });

  it('applies the [S, E + c) rule: start in a cleanup, cleanup into the next booking', () => {
    const conflicts = findOccurrenceConflicts(occ, {
      ...base,
      occupied: [
        booking('2026-11-02', 360, 420), // ends 07:00, cleanup until 07:30 → in_cleanup
        booking('2026-11-03', 570, 630), // starts 09:30, our cleanup runs to 10:00
        booking('2026-11-04', 600, 660), // starts 10:00 = E + cleanup → free
      ],
      windows: openWindows(),
    });
    expect(conflicts).toEqual([
      { date: '2026-11-02', reason: 'in_cleanup' },
      { date: '2026-11-03', reason: 'no_cleanup_before_next' },
    ]);
    expect(occurrenceConflictLabel('in_cleanup')).toBe('Conflito com limpeza');
    expect(occurrenceConflictLabel('no_cleanup_before_next')).toBe('Conflito com limpeza');
  });

  it('reports a block overlapping the occurrence', () => {
    const conflicts = findOccurrenceConflicts(occ, {
      ...base,
      occupied: [
        {
          start: at('2026-11-06', 420),
          end: at('2026-11-06', 480),
          occupiedUntil: at('2026-11-06', 480),
          kind: 'block',
        },
      ],
      windows: openWindows(),
    });
    expect(conflicts).toEqual([{ date: '2026-11-06', reason: 'overlaps_block' }]);
    expect(occurrenceConflictLabel('overlaps_block')).toBe('Bloqueado');
  });
});
