import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { chargeStatusSchema } from '@bravo/core';
import { z } from 'zod';
import type { Env } from '../../env';
import { sha256Hex } from '../../lib/crypto';
import {
  logGateway,
  type ChargeResult,
  type NormalizedStatus,
  type PaymentGateway,
} from '../gateway';

// Simulated gateway (AD-006): no network, a hosted fake checkout page on the app itself, and a
// signed webhook through the same pipeline as real providers (NUC-120).

export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';

/** Saved cards whose id carries this last4 are declined, so tests can exercise card failures. */
export const SANDBOX_DECLINED_LAST4 = '0002';

type SandboxEnv = Pick<Env, 'SESSION_SECRET' | 'APP_BASE_URL'>;

/** HMAC key of the sandbox webhooks, derived from the session secret. */
function webhookKey(env: Pick<Env, 'SESSION_SECRET'>): string {
  return sha256Hex(`${env.SESSION_SECRET}:sandbox-webhook`);
}

export function signSandboxBody(rawBody: string, env: Pick<Env, 'SESSION_SECRET'>): string {
  return createHmac('sha256', webhookKey(env)).update(rawBody).digest('hex');
}

const webhookPayloadSchema = z.object({
  chargeId: z.string().min(1),
  externalId: z.string().min(1),
  status: chargeStatusSchema,
  amountCents: z.number().int().positive().optional(),
});
export type SandboxWebhookPayload = z.infer<typeof webhookPayloadSchema>;

/** The signed delivery the hosted page emits when the visitor approves or rejects (NUC-120). */
export function buildSandboxWebhook(
  payload: SandboxWebhookPayload,
  env: Pick<Env, 'SESSION_SECRET'>,
): { headers: Record<string, string>; rawBody: string } {
  const rawBody = JSON.stringify(payload);
  return {
    headers: {
      'content-type': 'application/json',
      [SANDBOX_SIGNATURE_HEADER]: signSandboxBody(rawBody, env),
    },
    rawBody,
  };
}

export const sandboxExternalId = (chargeId: string) => `sbx_${chargeId}`;

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function result(chargeId: string, status: NormalizedStatus, extra: Partial<ChargeResult> = {}) {
  return {
    externalId: sandboxExternalId(chargeId),
    status,
    feeCents: 0,
    raw: { provider: 'sandbox', chargeId, status },
    ...extra,
  } satisfies ChargeResult;
}

export function createSandboxGateway(deps: { env: SandboxEnv; now?: () => Date }): PaymentGateway {
  const now = deps.now ?? (() => new Date());
  const hostedPage = (chargeId: string) =>
    new URL(`/pagamento/sandbox/${chargeId}`, deps.env.APP_BASE_URL).toString();

  return {
    id: 'sandbox',

    createCharge(input) {
      logGateway('sandbox', 'createCharge', {
        chargeId: input.chargeId,
        method: input.method,
        amountCents: input.amountCents,
      });
      return Promise.resolve(
        result(input.chargeId, 'pending', {
          checkoutUrl: hostedPage(input.chargeId),
          ...(input.method === 'pix' && { pixCopyPaste: `00020126SANDBOX${input.chargeId}` }),
        }),
      );
    },

    chargeSavedCard(input) {
      const declined = input.cardId.startsWith(`sbx_card_${SANDBOX_DECLINED_LAST4}_`);
      logGateway('sandbox', 'chargeSavedCard', {
        chargeId: input.chargeId,
        amountCents: input.amountCents,
        declined,
      });
      return Promise.resolve(result(input.chargeId, declined ? 'rejected' : 'approved'));
    },

    getStatus(ref) {
      return Promise.resolve(ref.externalId === null ? null : result(ref.chargeId, 'pending'));
    },

    cancelCharge(ref) {
      logGateway('sandbox', 'cancelCharge', { chargeId: ref.chargeId });
      return Promise.resolve();
    },

    refund(input) {
      logGateway('sandbox', 'refund', {
        externalId: input.externalId,
        amountCents: input.amountCents,
      });
      return Promise.resolve({
        externalId: `sbx_refund_${input.idempotencyKey}`,
        status: 'approved' as const,
      });
    },

    ensureCustomer(user) {
      return Promise.resolve({ customerId: user.existingId ?? `sbx_cus_${user.userId}` });
    },

    saveCard(input) {
      // The web tokenizer produces `tok_sandbox_<last4>`; the number itself never reaches the API.
      const last4 = /^tok_sandbox_(\d{4})$/.exec(input.cardToken)?.[1] ?? '4242';
      return Promise.resolve({
        cardId: `sbx_card_${last4}_${randomUUID()}`,
        brand: 'visa',
        last4,
        expMonth: 12,
        expYear: now().getUTCFullYear() + 4,
      });
    },

    parseWebhook(request) {
      const signature = request.headers[SANDBOX_SIGNATURE_HEADER];
      if (
        signature === undefined ||
        !safeEqualHex(signature, signSandboxBody(request.rawBody, deps.env))
      ) {
        return Promise.resolve({ valid: false as const });
      }
      let json: unknown;
      try {
        json = JSON.parse(request.rawBody);
      } catch {
        return Promise.resolve({ valid: false as const });
      }
      const parsed = webhookPayloadSchema.safeParse(json);
      if (!parsed.success) return Promise.resolve({ valid: false as const });
      const { chargeId, externalId, status, amountCents } = parsed.data;
      return Promise.resolve({
        valid: true as const,
        externalId,
        externalStatus: status,
        status,
        chargeId,
        ...(amountCents !== undefined && { amountCents }),
        raw: parsed.data,
      });
    },

    verifyCredentials() {
      return Promise.resolve({
        ok: true,
        message: 'Gateway simulado: nenhuma credencial necessária.',
      });
    },
  };
}
