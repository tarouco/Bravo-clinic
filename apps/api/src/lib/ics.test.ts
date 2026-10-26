import { describe, expect, it } from 'vitest';
import { buildIcs, escapeIcsText, foldIcsLine, icsUtc, type IcsEventInput } from './ics';

const NOW = new Date('2026-10-20T12:00:00.000Z');

const event: IcsEventInput = {
  uid: 'abc-123@bravoclinic.test',
  sequence: 0,
  start: new Date('2026-10-27T13:00:00.000Z'),
  end: new Date('2026-10-27T15:00:00.000Z'),
  summary: 'Reserva Bravô Clinic — Sala 1',
  location: 'Praia Brava, Itajaí – SC',
  description: 'Código BRV-ABC123',
};

/** Undoes line folding (CRLF + one space). */
const unfold = (ics: string) => ics.replaceAll('\r\n ', '');
const linesOf = (ics: string) => ics.split('\r\n');

describe('buildIcs line endings and folding (NUC-139)', () => {
  it('uses CRLF only and ends with a CRLF', () => {
    const ics = buildIcs({ method: 'REQUEST', events: [event], now: NOW });

    expect(ics.endsWith('\r\n')).toBe(true);
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
    expect(/\r(?!\n)/.test(ics)).toBe(false);
  });

  it('folds a 100-character SUMMARY so no physical line passes 75 octets', () => {
    const summary = 'S'.repeat(100);
    const ics = buildIcs({ method: 'REQUEST', events: [{ ...event, summary }], now: NOW });

    const physical = linesOf(ics);
    expect(Math.max(...physical.map((line) => Buffer.byteLength(line, 'utf8')))).toBe(75);
    const start = physical.findIndex((line) => line.startsWith('SUMMARY:'));
    expect(physical[start]).toBe(`SUMMARY:${'S'.repeat(67)}`);
    expect(physical[start + 1]).toBe(` ${'S'.repeat(33)}`);
    expect(unfold(ics)).toContain(`SUMMARY:${summary}\r\n`);
  });

  it('counts octets, not characters, and never splits a multi-byte character', () => {
    const summary = 'ç'.repeat(60);
    const folded = foldIcsLine(`SUMMARY:${summary}`);

    for (const line of folded.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(folded.replaceAll('\r\n ', '')).toBe(`SUMMARY:${summary}`);
  });

  it('leaves a line of exactly 75 octets unfolded', () => {
    const line = `X:${'a'.repeat(73)}`;

    expect(foldIcsLine(line)).toBe(line);
  });
});

describe('escapeIcsText (NUC-139)', () => {
  it('escapes backslash, semicolon, comma and line breaks', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('escapes the TEXT properties of the event', () => {
    const ics = buildIcs({
      method: 'REQUEST',
      events: [{ ...event, location: 'Rua A, 10; sala B\\C' }],
      now: NOW,
    });

    expect(linesOf(ics)).toContain('LOCATION:Rua A\\, 10\\; sala B\\\\C');
  });
});

describe('buildIcs content (NUC-136, NUC-137)', () => {
  it('writes METHOD:REQUEST, UTC DTSTART/DTEND of the given times, UID and SEQUENCE', () => {
    const ics = buildIcs({
      method: 'REQUEST',
      events: [{ ...event, sequence: 3 }],
      now: NOW,
    });
    const lines = linesOf(ics);

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('METHOD:REQUEST');
    expect(lines).toContain('UID:abc-123@bravoclinic.test');
    expect(lines).toContain('SEQUENCE:3');
    expect(lines).toContain('DTSTART:20261027T130000Z');
    expect(lines).toContain('DTEND:20261027T150000Z');
    expect(lines).toContain('DTSTAMP:20261020T120000Z');
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain('LOCATION:Praia Brava\\, Itajaí – SC');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('writes METHOD:CANCEL with the same UID and STATUS:CANCELLED', () => {
    const ics = buildIcs({
      method: 'CANCEL',
      events: [{ ...event, sequence: 1 }],
      now: NOW,
    });
    const lines = linesOf(ics);

    expect(lines).toContain('METHOD:CANCEL');
    expect(lines).toContain('UID:abc-123@bravoclinic.test');
    expect(lines).toContain('SEQUENCE:1');
    expect(lines).toContain('STATUS:CANCELLED');
  });

  it('emits one VEVENT per event and an explicit status wins', () => {
    const ics = buildIcs({
      method: 'PUBLISH',
      events: [event, { ...event, uid: 'second@bravoclinic.test', status: 'TENTATIVE' }],
      now: NOW,
    });
    const lines = linesOf(ics);

    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines).toContain('UID:second@bravoclinic.test');
    expect(lines).toContain('STATUS:TENTATIVE');
  });

  it('adds the organizer only when given', () => {
    const without = buildIcs({ method: 'REQUEST', events: [event], now: NOW });
    const withOrganizer = buildIcs({
      method: 'REQUEST',
      events: [event],
      organizerEmail: 'reservas@bravoclinic.test',
      now: NOW,
    });

    expect(without).not.toContain('ORGANIZER');
    expect(linesOf(withOrganizer)).toContain('ORGANIZER:mailto:reservas@bravoclinic.test');
  });
});

describe('icsUtc', () => {
  it('formats an instant as basic-format UTC without milliseconds', () => {
    expect(icsUtc(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});
