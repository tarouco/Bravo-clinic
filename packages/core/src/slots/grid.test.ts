import { describe, expect, it } from 'vitest';
import { localToUtc, type LocalDate } from '../time';
import {
  findCleanupConflicts,
  generateSlotGrid,
  occupiedFromBlock,
  occupiedFromBooking,
  rejectMessage,
  validateInterval,
  type GridSettings,
  type Occupied,
  type RejectReason,
} from './grid';

// Worked examples (spec W-CL): Sala Principal, Tuesday 2026-10-27, factory settings,
// now = 2026-10-20T12:00:00Z (09:00 in Sao Paulo).
const DATE: LocalDate = '2026-10-27';
const NOW = new Date('2026-10-20T12:00:00Z');
const TUESDAY = { openMinute: 420, closeMinute: 1440 };
const FACTORY: GridSettings = {
  slotMinutes: 30,
  minBookingMinutes: 60,
  cleanupMinutes: 30,
  minAdvanceMinutes: 0,
  maxAdvanceDays: 90,
};

const at = (minute: number, date: LocalDate = DATE) => localToUtc(date, minute);
const booking = (start: number, end: number, cleanupMinutes = 30): Occupied =>
  occupiedFromBooking({ start: at(start), end: at(end), cleanupMinutes });
const block = (start: number, end: number): Occupied =>
  occupiedFromBlock({ start: at(start), end: at(end), tag: 'Indisponível' });

function validate(
  startMinute: number,
  endMinute: number,
  occupied: Occupied[],
  overrides: {
    settings?: Partial<GridSettings>;
    date?: LocalDate;
    window?: typeof TUESDAY | null;
    now?: Date;
  } = {},
) {
  return validateInterval({
    date: overrides.date ?? DATE,
    startMinute,
    endMinute,
    window: overrides.window === undefined ? TUESDAY : overrides.window,
    occupied,
    settings: { ...FACTORY, ...overrides.settings },
    now: overrides.now ?? NOW,
  });
}

function grid(occupied: Occupied[], settings: Partial<GridSettings> = {}) {
  return generateSlotGrid({
    date: DATE,
    window: TUESDAY,
    occupied,
    settings: { ...FACTORY, ...settings },
    now: NOW,
  });
}

const rejected = (reason: RejectReason) => ({ ok: false, reason });
const accepted = { ok: true };

describe('validateInterval with W-CL (NUC-10)', () => {
  it('CL-1: 11:00-12:00 after 09:00-11:00 is in_cleanup ("Sala em limpeza")', () => {
    const result = validate(660, 720, [booking(540, 660)]);
    expect(result).toEqual(rejected('in_cleanup'));
    expect(rejectMessage('in_cleanup')).toBe('Sala em limpeza');
  });

  it('CL-2: 11:30-12:30 after 09:00-11:00 is accepted', () => {
    expect(validate(690, 750, [booking(540, 660)])).toEqual(accepted);
  });

  it('CL-3: 12:00-14:00 between 09:00-11:00 and 14:00-16:00 is no_cleanup_before_next', () => {
    expect(validate(720, 840, [booking(540, 660), booking(840, 960)])).toEqual(
      rejected('no_cleanup_before_next'),
    );
  });

  it('CL-4: 11:30-13:30 between 09:00-11:00 and 14:00-16:00 is accepted', () => {
    expect(validate(690, 810, [booking(540, 660), booking(840, 960)])).toEqual(accepted);
  });

  it('CL-5: after the 08:00-10:00 fixed occurrence, 10:00-11:00 is in_cleanup and 10:30-11:30 accepted', () => {
    const occurrence = [booking(480, 600)];
    expect(validate(600, 660, occurrence)).toEqual(rejected('in_cleanup'));
    expect(validate(630, 690, occurrence)).toEqual(accepted);
  });

  it('CL-6: cleanup 45 after 09:00-10:00 rejects 10:30, accepts 11:00 and 10:45 is misaligned', () => {
    const occupied = [booking(540, 600, 45)];
    const settings = { cleanupMinutes: 45 };
    expect(validate(630, 690, occupied, { settings })).toEqual(rejected('in_cleanup'));
    expect(validate(660, 720, occupied, { settings })).toEqual(accepted);
    expect(validate(645, 705, occupied, { settings })).toEqual(rejected('misaligned'));
  });

  it('CL-7: 07:00-08:00 with no bookings is accepted (no cleanup before the first booking)', () => {
    expect(validate(420, 480, [])).toEqual(accepted);
  });

  it('CL-8: 23:00-00:00 is accepted (cleanup may pass closing)', () => {
    expect(validate(1380, 1440, [])).toEqual(accepted);
  });

  it('CL-10: 14:00-15:00 before the block 15:00-16:00 is no_cleanup_before_next; 13:30-14:30 accepted', () => {
    const occupied = [block(900, 960)];
    expect(validate(840, 900, occupied)).toEqual(rejected('no_cleanup_before_next'));
    expect(validate(810, 870, occupied)).toEqual(accepted);
  });
});

describe('generateSlotGrid with W-CL (NUC-14, NUC-15)', () => {
  it('CL-9: cells 11:30 and 12:00 are leftover, 14:30 is available', () => {
    const cells = grid([booking(540, 660), booking(750, 840)]);
    const cell = (minute: number) => cells.find((c) => c.startMinute === minute);
    expect(cell(690)).toMatchObject({ state: 'unavailable', adminState: 'leftover' });
    expect(cell(720)).toMatchObject({ state: 'unavailable', adminState: 'leftover' });
    expect(cell(870)).toMatchObject({ state: 'available', adminState: 'free', startable: true });
    // The bookings and their cleanup periods keep their own admin states.
    expect(cell(540)?.adminState).toBe('booking');
    expect(cell(660)?.adminState).toBe('cleanup');
    expect(cell(750)?.adminState).toBe('booking');
    expect(cell(840)?.adminState).toBe('cleanup');
  });

  it('CL-4: the 11:30 cell is startable with maxEndMinute 810', () => {
    const cells = grid([booking(540, 660), booking(840, 960)]);
    expect(cells.find((c) => c.startMinute === 690)).toEqual({
      startMinute: 690,
      state: 'available',
      adminState: 'free',
      startable: true,
      maxEndMinute: 810,
    });
  });

  it('CL-4: a cell inside a valid interval is available even when it cannot start one', () => {
    const cells = grid([booking(540, 660), booking(840, 960)]);
    expect(cells.find((c) => c.startMinute === 780)).toEqual({
      startMinute: 780,
      state: 'available',
      adminState: 'free',
      startable: false,
      maxEndMinute: null,
    });
  });

  it('covers the window in slot steps and returns no cells for a closed day', () => {
    const cells = grid([]);
    expect(cells).toHaveLength(34);
    expect(cells[0]?.startMinute).toBe(420);
    expect(cells.at(-1)?.startMinute).toBe(1410);
    expect(cells.at(-1)?.maxEndMinute).toBeNull();
    expect(cells[0]?.maxEndMinute).toBe(1440);
    expect(
      generateSlotGrid({ date: DATE, window: null, occupied: [], settings: FACTORY, now: NOW }),
    ).toEqual([]);
  });
});

describe('validateInterval reject reasons (NUC-11, NUC-12)', () => {
  it('closed when the window is null', () => {
    expect(validate(600, 660, [], { window: null })).toEqual(rejected('closed'));
  });

  it('outside_hours before opening and across midnight', () => {
    expect(validate(390, 480, [])).toEqual(rejected('outside_hours'));
    expect(validate(1410, 1470, [])).toEqual(rejected('outside_hours'));
  });

  it('misaligned when the start or the end is off the slot grid', () => {
    expect(validate(615, 675, [])).toEqual(rejected('misaligned'));
    expect(validate(600, 675, [])).toEqual(rejected('misaligned'));
  });

  it('too_short below the minimum duration', () => {
    expect(validate(600, 630, [])).toEqual(rejected('too_short'));
  });

  it('in_past unless the start is later than now + minAdvanceMinutes', () => {
    const today: LocalDate = '2026-10-20';
    expect(validate(540, 600, [], { date: today })).toEqual(rejected('in_past'));
    expect(validate(570, 630, [], { date: today })).toEqual(accepted);
    const settings = { minAdvanceMinutes: 60 };
    expect(validate(600, 660, [], { date: today, settings })).toEqual(rejected('in_past'));
    expect(validate(630, 690, [], { date: today, settings })).toEqual(accepted);
  });

  it('too_far after today + maxAdvanceDays in Sao Paulo dates', () => {
    expect(validate(600, 660, [], { date: '2027-01-18' })).toEqual(accepted);
    expect(validate(600, 660, [], { date: '2027-01-19' })).toEqual(rejected('too_far'));
  });

  it('overlaps_booking and overlaps_block on direct overlap', () => {
    expect(validate(600, 720, [booking(660, 780)])).toEqual(rejected('overlaps_booking'));
    expect(validate(600, 720, [block(660, 780)])).toEqual(rejected('overlaps_block'));
  });

  it('a block adds no cleanup: a booking may start exactly at its end', () => {
    expect(validate(780, 840, [block(660, 780)])).toEqual(accepted);
    expect(block(660, 780).occupiedUntil).toEqual(at(780));
  });
});

describe('rejectMessage (NUC-17)', () => {
  const messages: [RejectReason, string][] = [
    ['closed', 'Sala fechada nesta data'],
    ['outside_hours', 'Fora do horário de funcionamento'],
    ['misaligned', 'Horário fora da grade de horários'],
    ['too_short', 'Duração abaixo do mínimo'],
    ['in_past', 'Horário indisponível para reserva'],
    ['too_far', 'Data além da antecedência máxima'],
    ['overlaps_booking', 'Horário já reservado'],
    ['in_cleanup', 'Sala em limpeza'],
    ['overlaps_block', 'Horário bloqueado'],
    ['no_cleanup_before_next', 'Termina sem o intervalo de limpeza antes da próxima reserva'],
  ];
  it.each(messages)('%s -> %s', (reason, text) => {
    expect(rejectMessage(reason)).toBe(text);
  });
});

describe('occupancy predicate equals the exclusion constraint (NUC-13)', () => {
  // Deterministic LCG so the table is the same on every run.
  let seed = 20261027;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const MS = 60_000;

  const rows = Array.from({ length: 200 }, () => {
    const start = 420 + 30 * next(32);
    const end = Math.min(1440, start + 60 + 30 * next(8));
    const cleanup = 15 * next(7);
    const oStart = 15 * next(96);
    const oEnd = Math.min(1440, oStart + 15 + 15 * next(16));
    const isBlock = next(3) === 0;
    const o = isBlock
      ? occupiedFromBlock({ start: at(oStart), end: at(oEnd) })
      : occupiedFromBooking({ start: at(oStart), end: at(oEnd), cleanupMinutes: 15 * next(7) });
    return { start, end, cleanup, o };
  });

  it('builds 200 intervals with both conflicting and free cases', () => {
    const conflicts = rows.filter(
      (r) =>
        at(r.start) < r.o.occupiedUntil &&
        at(r.end).getTime() + r.cleanup * MS > r.o.start.getTime(),
    );
    expect(rows).toHaveLength(200);
    expect(conflicts.length).toBeGreaterThan(20);
    expect(conflicts.length).toBeLessThan(180);
  });

  it.each(rows.map((r, i) => [i, r] as const))('row %i', (_i, r) => {
    const predicate =
      at(r.start).getTime() < r.o.occupiedUntil.getTime() &&
      at(r.end).getTime() + r.cleanup * MS > r.o.start.getTime();
    const result = validate(r.start, r.end, [r.o], { settings: { cleanupMinutes: r.cleanup } });
    expect(result.ok).toBe(!predicate);
    if (!result.ok) {
      expect([
        'overlaps_booking',
        'overlaps_block',
        'in_cleanup',
        'no_cleanup_before_next',
      ]).toContain(result.reason);
    }
  });
});

describe('findCleanupConflicts with W-CC (NUC-16)', () => {
  const PRINCIPAL = 'principal';
  const SECUNDARIA = 'secundaria';
  const b = (id: string, start: number, end: number, roomId = PRINCIPAL) => ({
    id,
    roomId,
    start: at(start),
    end: at(end),
  });

  it('CC-1: 09:00-11:00 and 11:30-12:30 with cleanup 45 conflict as one pair', () => {
    expect(findCleanupConflicts([b('first', 540, 660), b('second', 690, 750)], 45)).toEqual([
      { firstId: 'first', secondId: 'second' },
    ]);
  });

  it('CC-2: 09:00-11:00 and 12:00-13:00 with cleanup 60 do not conflict', () => {
    expect(findCleanupConflicts([b('first', 540, 660), b('second', 720, 780)], 60)).toEqual([]);
  });

  it('CC-3: 09:00-11:00 and 12:00-13:00 with cleanup 90 conflict as one pair', () => {
    expect(findCleanupConflicts([b('second', 720, 780), b('first', 540, 660)], 90)).toEqual([
      { firstId: 'first', secondId: 'second' },
    ]);
  });

  it('CC-4: bookings in different rooms never conflict', () => {
    expect(
      findCleanupConflicts([b('first', 540, 660), b('second', 660, 720, SECUNDARIA)], 60),
    ).toEqual([]);
  });
});
