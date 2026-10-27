// RFC 5545 iCalendar serializer (NUC-139, GES-47, GES-48). One or more VEVENTs per calendar; the
// booking e-mails attach it with METHOD:REQUEST (confirmed, rescheduled) or METHOD:CANCEL
// (cancelled); the per-booking file and the calendar feeds use METHOD:PUBLISH / METHOD:CANCEL.

export type IcsMethod = 'PUBLISH' | 'REQUEST' | 'CANCEL';
export type IcsStatus = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';

export interface IcsEventInput {
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
  /** Defaults to CANCELLED for METHOD:CANCEL and CONFIRMED otherwise. */
  status?: IcsStatus;
}

export interface IcsInput {
  method: IcsMethod;
  events: IcsEventInput[];
  organizerEmail?: string;
  /** DTSTAMP of every event; injected so output is deterministic. Defaults to the current time. */
  now?: Date;
}

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
// GES-47.
const PRODID = '-//Bravo Clinic//Salas Inteligentes//PT-BR';

/** `20261027T130000Z` */
export function icsUtc(instant: Date): string {
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks (RFC 5545 section 3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line so no physical line exceeds 75 octets; continuation lines start with one
 * space (which counts toward their 75). Never splits a UTF-8 sequence.
 */
export function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= MAX_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const octets = Buffer.byteLength(char, 'utf8');
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = '';
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** One VEVENT of a feed or attachment (GES-47); times are written in UTC. */
export interface IcsEvent {
  uid: string;
  sequence: number;
  dtstamp: Date;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  /** Defaults to CONFIRMED. */
  status?: IcsStatus;
  organizerEmail?: string;
}

/** The unfolded content lines of one VEVENT; `icsCalendar` folds and joins them. */
export function icsEvent(e: IcsEvent): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsUtc(e.dtstamp)}`,
    `SEQUENCE:${String(e.sequence)}`,
    `DTSTART:${icsUtc(e.start)}`,
    `DTEND:${icsUtc(e.end)}`,
    `SUMMARY:${escapeIcsText(e.summary)}`,
    ...(e.location === undefined ? [] : [`LOCATION:${escapeIcsText(e.location)}`]),
    ...(e.description === undefined ? [] : [`DESCRIPTION:${escapeIcsText(e.description)}`]),
    `STATUS:${e.status ?? 'CONFIRMED'}`,
    ...(e.organizerEmail === undefined ? [] : [`ORGANIZER:mailto:${e.organizerEmail}`]),
    'END:VEVENT',
  ];
}

/**
 * The calendar text (RFC 5545): CRLF line endings with a trailing CRLF, every line folded at 75
 * octets on UTF-8 boundaries, `METHOD` only when given, `X-WR-CALNAME` = `name` when given.
 */
export function icsCalendar(
  events: string[][],
  opts: { method?: IcsMethod; name?: string } = {},
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    ...(opts.method === undefined ? [] : [`METHOD:${opts.method}`]),
    ...(opts.name === undefined ? [] : [`X-WR-CALNAME:${escapeIcsText(opts.name)}`]),
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/**
 * The booking e-mail attachments and per-booking file (nucleo's signature, R4), built on
 * `icsEvent`/`icsCalendar`. METHOD:CANCEL marks every event CANCELLED unless a status is given.
 */
export function buildIcs(input: IcsInput): string {
  const dtstamp = input.now ?? new Date();
  const events = input.events.map((event) =>
    icsEvent({
      ...event,
      dtstamp,
      status: event.status ?? (input.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'),
      ...(input.organizerEmail !== undefined && { organizerEmail: input.organizerEmail }),
    }),
  );
  return icsCalendar(events, { method: input.method });
}
