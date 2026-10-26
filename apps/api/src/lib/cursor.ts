import { validationFailed } from './errors';

/** Keyset cursor `(sort key, id)` as the opaque base64url string lists return (docs/architecture.md 6.2). */
export interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at.toISOString(), cursor.id]), 'utf8').toString(
    'base64url',
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed cursor is the client's mistake: 422 on the `cursor` field. */
export function decodeCursor(raw: string): Cursor {
  const invalid = () => validationFailed([{ path: ['cursor'], message: 'Cursor inválido' }]);
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw invalid();
    }
    const at = new Date(parsed[0]);
    if (Number.isNaN(at.getTime()) || !UUID.test(parsed[1])) throw invalid();
    return { at, id: parsed[1] };
  } catch {
    throw invalid();
  }
}
