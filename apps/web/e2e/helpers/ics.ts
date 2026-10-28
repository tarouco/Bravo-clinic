// Minimal RFC 5545 reader for the e2e specs (gestao T45): unfolds continuation lines, drops
// property parameters and returns the calendar properties plus one property map per VEVENT.

export interface IcsCalendar {
  /** Properties of the VCALENDAR itself (VERSION, PRODID, METHOD, ...). */
  props: Record<string, string>;
  /** One map per VEVENT, keyed by property name (UID, SEQUENCE, DTSTART, SUMMARY, ...). */
  events: Record<string, string>[];
}

/** Parses an `.ics` body; throws when it is not a CRLF-delimited VCALENDAR. */
export function parseIcs(text: string): IcsCalendar {
  if (!text.startsWith('BEGIN:VCALENDAR\r\n')) throw new Error('not a CRLF VCALENDAR');
  // Unfold: a CRLF followed by one space or tab continues the previous line (RFC 5545 3.1).
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n');
  const props: Record<string, string> = {};
  const events: Record<string, string>[] = [];
  let event: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === '') continue;
    if (line === 'BEGIN:VEVENT') {
      event = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (event !== null) events.push(event);
      event = null;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = (line.slice(0, colon).split(';')[0] ?? '').toUpperCase();
    const value = line.slice(colon + 1);
    if (event !== null) event[name] = value;
    else if (name !== 'BEGIN' && name !== 'END') props[name] = value;
  }
  return { props, events };
}

/** `2026-11-13T19:00:00.000Z` → `20261113T190000Z`, the UTC DATE-TIME form of DTSTART. */
export function icsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
