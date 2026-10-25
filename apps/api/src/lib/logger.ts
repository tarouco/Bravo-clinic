const SENSITIVE_KEY = /pass|token|secret|authorization|cookie|code/i;
const REDACTED = '[redacted]';

/** Deep copy with the value of every sensitive key replaced by "[redacted]". */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : redact(inner),
      ]),
    );
  }
  return value;
}

type Level = 'info' | 'warn' | 'error';

function write(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ...(redact(fields) as Record<string, unknown>) });
  process.stdout.write(`${line}\n`);
}

export const logger = {
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};
