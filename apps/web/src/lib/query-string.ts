export type QueryValue = string | number | boolean | null | undefined;

/** `path?a=1&b=2` from the defined params; null, undefined and empty strings are left out. */
export function withQuery(path: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** A fresh `Idempotency-Key` for one money-moving attempt (reuse it only to retry that attempt). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
