// RFC 5545 iCalendar builder (NUC-139). One or more VEVENTs per calendar; the booking e-mails
// attach it with METHOD:REQUEST (confirmed, rescheduled) or METHOD:CANCEL (cancelled).

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
const PRODID = '-//Bravô Clinic//Reservas//PT-BR';

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

function eventLines(
  event: IcsEventInput,
  method: IcsMethod,
  stamp: string,
  organizerEmail: string | undefined,
): string[] {
  const status = event.status ?? (method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED');
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${String(event.sequence)}`,
    `DTSTART:${icsUtc(event.start)}`,
    `DTEND:${icsUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `STATUS:${status}`,
    ...(organizerEmail === undefined ? [] : [`ORGANIZER:mailto:${organizerEmail}`]),
    'END:VEVENT',
  ];
}

/** The calendar text with CRLF line endings and a trailing CRLF. */
export function buildIcs(input: IcsInput): string {
  const stamp = icsUtc(input.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    ...input.events.flatMap((event) =>
      eventLines(event, input.method, stamp, input.organizerEmail),
    ),
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
