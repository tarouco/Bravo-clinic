import type { MiddlewareHandler } from 'hono';
import { validationFailed } from '../lib/errors';
import type { AppEnv } from '../types';

// The API never accepts card numbers or CVV (NUC-128): cards reach the gateway's tokenizer or
// hosted page only. Zod would silently strip unknown keys, so this guard looks at the raw body.

const FORBIDDEN_KEYS = new Set([
  'cardnumber',
  'card_number',
  'number',
  'pan',
  'cvv',
  'cvc',
  'securitycode',
  'security_code',
]);
const PAN_LIKE = /^\d{13,19}$/;

interface Finding {
  path: string;
  message: string;
}

function scan(value: unknown, path: string[], findings: Finding[]): void {
  if (Array.isArray(value)) {
    value.forEach((inner, index) => {
      scan(inner, [...path, String(index)], findings);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        findings.push({
          path: [...path, key].join('.'),
          message: 'Dados de cartão não são aceitos. Use o formulário seguro de pagamento.',
        });
      } else {
        scan(inner, [...path, key], findings);
      }
    }
    return;
  }
  if (typeof value === 'string' && PAN_LIKE.test(value.replace(/[\s-]/g, ''))) {
    findings.push({
      path: path.join('.'),
      message: 'Dados de cartão não são aceitos. Use o formulário seguro de pagamento.',
    });
  }
}

/** 422 `VALIDATION_FAILED` when a JSON body carries card-number or CVV keys or a PAN-like string. */
export function rejectCardData(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const findings: Finding[] = [];
    scan(body, [], findings);
    if (findings.length > 0) {
      throw validationFailed(
        findings.map((f) => ({ path: f.path.split('.'), message: f.message })),
      );
    }
    await next();
  };
}
