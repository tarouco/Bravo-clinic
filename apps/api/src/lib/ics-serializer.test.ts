import { localToUtc } from '@bravo/core';
import { describe, expect, it } from 'vitest';
import { buildIcs, icsCalendar, icsEvent, type IcsEvent } from './ics';

// RFC 5545 serializer used by the feeds and the per-booking file (GES-47, GES-48).

const DTSTAMP = new Date('2026-10-20T12:00:00.000Z');
const base: IcsEvent = {
  uid: 'bkg-1@bravo-clinic',
  sequence: 2,
  dtstamp: DTSTAMP,
  start: localToUtc('2026-10-27', 10 * 60),
  end: localToUtc('2026-10-27', 12 * 60),
  summary: 'Bravô Clinic · Sala Principal',
};

const physicalLines = (ics: string) => ics.split('\r\n').slice(0, -1);
const unfold = (ics: string) => ics.replaceAll('\r\n ', '');

describe('icsCalendar (GES-47)', () => {
  it('ends every line with CRLF, including the last, and has no bare LF or CR', () => {
    const ics = icsCalendar([icsEvent(base), icsEvent({ ...base, uid: 'b2' })], {
      method: 'PUBLISH',
      name: 'Bravô Clinic',
    });

    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
    expect(/\r(?!\n)/.test(ics)).toBe(false);
  });

  it('writes VERSION, PRODID, CALSCALE, the given METHOD and the calendar name', () => {
    const lines = physicalLines(
      icsCalendar([icsEvent(base)], { method: 'PUBLISH', name: 'Agenda, Bravô' }),
    );

    expect(lines.slice(0, 6)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Bravo Clinic//Salas Inteligentes//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Agenda\\, Bravô',
    ]);
  });

  it('omits METHOD and the name when not given', () => {
    const ics = icsCalendar([icsEvent(base)]);

    expect(ics).not.toContain('METHOD:');
    expect(ics).not.toContain('X-WR-CALNAME');
  });

  it('folds at 75 octets without splitting an "ô" that crosses the boundary', () => {
    // "SUMMARY:" (8) + 66 "a" = 74 octets; the 2-octet "ô" would end at octet 76.
    const summary = `${'a'.repeat(66)}ô${'b'.repeat(80)}`;
    const ics = icsCalendar([icsEvent({ ...base, summary })]);
    const lines = physicalLines(ics);

    for (const line of lines) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    const at = lines.findIndex((line) => line.startsWith('SUMMARY:'));
    expect(lines[at]).toBe(`SUMMARY:${'a'.repeat(66)}`);
    expect(lines[at + 1]?.startsWith(' ô')).toBe(true);
    expect(unfold(ics)).toContain(`\r\nSUMMARY:${summary}\r\n`);
  });
});

describe('icsEvent (GES-47)', () => {
  it('writes UTC times: 10:00 local on 2026-10-27 is DTSTART:20261027T130000Z', () => {
    const lines = icsEvent(base);

    expect(lines).toContain('DTSTART:20261027T130000Z');
    expect(lines).toContain('DTEND:20261027T150000Z');
    expect(lines).toContain('DTSTAMP:20261020T120000Z');
    expect(lines).toContain('UID:bkg-1@bravo-clinic');
    expect(lines).toContain('SEQUENCE:2');
    expect(lines).toContain('STATUS:CONFIRMED');
  });

  it('escapes comma, semicolon, backslash and newline in TEXT values', () => {
    const lines = icsEvent({
      ...base,
      summary: 'a,b;c\\d',
      location: 'Bravô Clinic — Sala 1, Praia Brava; Itajaí',
      description: 'linha 1\nlinha 2\r\nlinha 3',
    });

    expect(lines).toContain('SUMMARY:a\\,b\\;c\\\\d');
    expect(lines).toContain('LOCATION:Bravô Clinic — Sala 1\\, Praia Brava\\; Itajaí');
    expect(lines).toContain('DESCRIPTION:linha 1\\nlinha 2\\nlinha 3');
  });

  it('omits LOCATION and DESCRIPTION when absent and keeps an explicit TENTATIVE status', () => {
    const lines = icsEvent({ ...base, status: 'TENTATIVE' });

    expect(lines.some((line) => line.startsWith('LOCATION'))).toBe(false);
    expect(lines.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
    expect(lines).toContain('STATUS:TENTATIVE');
    expect(lines[0]).toBe('BEGIN:VEVENT');
    expect(lines.at(-1)).toBe('END:VEVENT');
  });
});

describe('METHOD:CANCEL (GES-50 on the serializer)', () => {
  it('buildIcs CANCEL carries STATUS:CANCELLED with the same UID and the given SEQUENCE', () => {
    const event = {
      uid: base.uid,
      sequence: 3,
      start: base.start,
      end: base.end,
      summary: base.summary,
      location: 'Bravô Clinic — Sala Principal, Praia Brava, Itajaí – SC',
      description: 'Código BRV-ABC123',
    };
    const lines = physicalLines(
      unfold(buildIcs({ method: 'CANCEL', events: [event], now: DTSTAMP })),
    );

    expect(lines).toContain('METHOD:CANCEL');
    expect(lines).toContain('UID:bkg-1@bravo-clinic');
    expect(lines).toContain('SEQUENCE:3');
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).toContain('PRODID:-//Bravo Clinic//Salas Inteligentes//PT-BR');
  });

  it('icsCalendar CANCEL with a cancelled event keeps its UID and SEQUENCE', () => {
    const ics = icsCalendar([icsEvent({ ...base, sequence: 4, status: 'CANCELLED' })], {
      method: 'CANCEL',
    });

    expect(physicalLines(ics)).toEqual(
      expect.arrayContaining([
        'METHOD:CANCEL',
        'UID:bkg-1@bravo-clinic',
        'SEQUENCE:4',
        'STATUS:CANCELLED',
      ]),
    );
  });
});
