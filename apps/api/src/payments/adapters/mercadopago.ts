import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cents } from '@bravo/core';
import type { Env } from '../../env';
import {
  GatewayError,
  logGateway,
  type ChargeResult,
  type CreateChargeInput,
  type NormalizedStatus,
  type ParsedWebhook,
  type PayerDocType,
  type PaymentGateway,
} from '../gateway';

// Mercado Pago over REST `fetch` (AD-006, NUC-122..124). Request shapes were checked against the
// current developer docs when this adapter was written (T16); differences from design.md:
//  - Pix `date_of_expiration` must be 30 min to 30 days after issuance, so a shorter booking hold
//    (default 15 min) cannot be mirrored: we send at least 31 min and the booking hold stays the
//    authority (a late approval takes the NUC-117 path).
//  - Paying with a saved card normally needs the CVV in the card token. Creating the token from
//    `card_id` alone (below) is not in the public docs and may need Mercado Pago to enable
//    recurring payments on the account; a failure surfaces as a rejected charge or GatewayError.

export const MP_BASE_URL = 'https://api.mercadopago.com';
/** Every provider call is aborted after 10 s (NUC-111). */
export const MP_TIMEOUT_MS = 10_000;
const MIN_PIX_EXPIRY_MS = 31 * 60_000;
const MAX_PIX_EXPIRY_MS = 30 * 24 * 3_600_000;
const BRAZIL_OFFSET_MS = 3 * 3_600_000;
const WEBHOOK_PATH = '/api/webhooks/pagamentos/mercadopago';

export interface MercadoPagoCredentials {
  accessToken: string;
  webhookSecret?: string;
  publicKey?: string;
}

export interface MercadoPagoDeps {
  credentials: MercadoPagoCredentials;
  env: Pick<Env, 'APP_BASE_URL'>;
  fetch: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

interface MpPayment {
  id: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  external_reference?: string | null;
  fee_details?: { amount?: number }[];
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; qr_code_base64?: string };
  };
  [key: string]: unknown;
}

/** Provider payment status to ours (NUC-114). `refunded` and partial refunds come from amounts. */
export function mapMercadoPagoStatus(payment: {
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
}): NormalizedStatus {
  switch (payment.status) {
    case 'approved': {
      const refunded = payment.transaction_amount_refunded ?? 0;
      const total = payment.transaction_amount ?? 0;
      if (refunded > 0) return total > 0 && refunded >= total ? 'refunded' : 'partially_refunded';
      return 'approved';
    }
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return payment.status_detail === 'expired' ? 'expired' : 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'charged_back':
      return 'charged_back';
    // pending, in_process, in_mediation, authorized and anything unknown wait for the next event.
    default:
      return 'pending';
  }
}

const toReais = (cents: Cents): number => Number((cents / 100).toFixed(2));
const toCents = (reais: number): Cents => Math.round(reais * 100);

/** ISO 8601 with the clinic's fixed -03:00 offset, the format the API documents. */
export function toMercadoPagoDate(instant: Date): string {
  return new Date(instant.getTime() - BRAZIL_OFFSET_MS).toISOString().replace('Z', '-03:00');
}

function splitName(name: string): { first_name: string; last_name: string } {
  const [first = name, ...rest] = name.trim().split(/\s+/);
  return { first_name: first, last_name: rest.join(' ') || first };
}

const docType = (type: PayerDocType) => (type === 'cnpj' ? 'CNPJ' : 'CPF');

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `x-signature: ts=1704908010,v1=618c85...` */
function parseSignatureHeader(header: string | undefined): { ts: string; v1: string } | null {
  if (header === undefined) return null;
  const fields = new Map(
    header.split(',').map((part) => {
      const [key = '', ...value] = part.trim().split('=');
      return [key, value.join('=')] as const;
    }),
  );
  const ts = fields.get('ts');
  const v1 = fields.get('v1');
  return ts && v1 ? { ts, v1 } : null;
}

function rawPayment(payment: MpPayment) {
  return {
    id: payment.id,
    status: payment.status,
    status_detail: payment.status_detail,
    transaction_amount: payment.transaction_amount,
    transaction_amount_refunded: payment.transaction_amount_refunded,
    external_reference: payment.external_reference,
    date_approved: payment.date_approved,
    payment_method_id: payment.payment_method_id,
    payment_type_id: payment.payment_type_id,
    fee_details: payment.fee_details,
  };
}

const feeOf = (payment: MpPayment): Cents =>
  (payment.fee_details ?? []).reduce((sum, fee) => sum + toCents(fee.amount ?? 0), 0);

function chargeResultOf(payment: MpPayment): ChargeResult {
  const status = mapMercadoPagoStatus(payment);
  const data = payment.point_of_interaction?.transaction_data;
  const feeCents = status === 'approved' ? feeOf(payment) : undefined;
  return {
    externalId: String(payment.id),
    status,
    ...(data?.qr_code !== undefined && { pixCopyPaste: data.qr_code }),
    ...(data?.qr_code_base64 !== undefined && { pixQrCodeBase64: data.qr_code_base64 }),
    ...(feeCents !== undefined && { feeCents }),
    raw: rawPayment(payment),
  };
}

export function createMercadoPagoGateway(deps: MercadoPagoDeps): PaymentGateway {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? MP_TIMEOUT_MS;
  const notificationUrl = new URL(WEBHOOK_PATH, deps.env.APP_BASE_URL).toString();

  async function request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: {
      body?: unknown;
      idempotencyKey?: string;
      credentials?: MercadoPagoCredentials;
      /** A 404 is an answer, not a failure. */
      allowNotFound?: boolean;
    } = {},
  ): Promise<{ status: number; json: unknown }> {
    const credentials = options.credentials ?? deps.credentials;
    let response: Response;
    try {
      response = await deps.fetch(`${MP_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(options.idempotencyKey !== undefined && {
            'X-Idempotency-Key': options.idempotencyKey,
          }),
        },
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = (error as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new GatewayError('timeout', `Mercado Pago não respondeu em ${String(timeoutMs)} ms`);
      }
      throw new GatewayError('network', 'Falha de rede ao chamar o Mercado Pago');
    }
    const text = await response.text().catch(() => '');
    let json: unknown = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        if (response.ok)
          throw new GatewayError('invalid_response', 'Resposta inválida do Mercado Pago');
      }
    }
    if (response.status === 404 && options.allowNotFound === true) {
      return { status: 404, json };
    }
    if (!response.ok) {
      const message = (json as { message?: unknown } | null)?.message;
      const detail = typeof message === 'string' ? `: ${message.slice(0, 200)}` : '';
      throw new GatewayError(
        'http',
        `Mercado Pago respondeu ${String(response.status)}${detail}`,
        response.status,
      );
    }
    return { status: response.status, json };
  }

  const getPayment = async (externalId: string): Promise<MpPayment | null> => {
    const { status, json } = await request(
      'GET',
      `/v1/payments/${encodeURIComponent(externalId)}`,
      {
        allowNotFound: true,
      },
    );
    return status === 404 ? null : (json as MpPayment);
  };

  function payerOf(input: CreateChargeInput['payer']) {
    return {
      email: input.email,
      ...splitName(input.name),
      identification: { type: docType(input.docType), number: input.docNumber },
    };
  }

  async function createPix(input: CreateChargeInput): Promise<ChargeResult> {
    const at = now().getTime();
    const expiresAt = Math.min(
      Math.max(input.expiresAt.getTime(), at + MIN_PIX_EXPIRY_MS),
      at + MAX_PIX_EXPIRY_MS,
    );
    const { json } = await request('POST', '/v1/payments', {
      idempotencyKey: input.idempotencyKey,
      body: {
        transaction_amount: toReais(input.amountCents),
        description: input.description,
        payment_method_id: 'pix',
        date_of_expiration: toMercadoPagoDate(new Date(expiresAt)),
        external_reference: input.chargeId,
        notification_url: notificationUrl,
        payer: payerOf(input.payer),
      },
    });
    return chargeResultOf(json as MpPayment);
  }

  async function createPreference(input: CreateChargeInput): Promise<ChargeResult> {
    const { json } = await request('POST', '/checkout/preferences', {
      idempotencyKey: input.idempotencyKey,
      body: {
        items: [
          {
            id: input.chargeId,
            title: input.description,
            quantity: 1,
            currency_id: 'BRL',
            unit_price: toReais(input.amountCents),
          },
        ],
        payer: {
          email: input.payer.email,
          name: splitName(input.payer.name).first_name,
          surname: splitName(input.payer.name).last_name,
          identification: { type: docType(input.payer.docType), number: input.payer.docNumber },
        },
        external_reference: input.chargeId,
        notification_url: notificationUrl,
        back_urls: {
          success: input.returnUrl,
          failure: input.returnUrl,
          pending: input.returnUrl,
        },
        auto_return: 'approved',
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }, { id: 'bank_transfer' }],
        },
        expires: true,
        expiration_date_from: toMercadoPagoDate(now()),
        expiration_date_to: toMercadoPagoDate(input.expiresAt),
      },
    });
    const preference = json as { init_point?: string };
    if (typeof preference.init_point !== 'string') {
      throw new GatewayError('invalid_response', 'Preferência sem init_point');
    }
    return {
      // The payment id exists only once the customer pays; webhooks map back by external_reference.
      externalId: null,
      status: 'pending',
      checkoutUrl: preference.init_point,
      raw: { preference: (json as { id?: unknown }).id },
    };
  }

  return {
    id: 'mercadopago',

    async createCharge(input) {
      logGateway('mercadopago', 'createCharge', {
        chargeId: input.chargeId,
        method: input.method,
        amountCents: input.amountCents,
      });
      return input.method === 'pix' ? createPix(input) : createPreference(input);
    },

    async chargeSavedCard(input) {
      logGateway('mercadopago', 'chargeSavedCard', {
        chargeId: input.chargeId,
        amountCents: input.amountCents,
      });
      const { json: token } = await request('POST', '/v1/card_tokens', {
        idempotencyKey: `${input.idempotencyKey}:token`,
        body: { card_id: input.cardId, customer_id: input.customerId },
      });
      const { json } = await request('POST', '/v1/payments', {
        idempotencyKey: input.idempotencyKey,
        body: {
          transaction_amount: toReais(input.amountCents),
          token: (token as { id: string }).id,
          installments: 1,
          description: input.description,
          external_reference: input.chargeId,
          notification_url: notificationUrl,
          payer: { type: 'customer', id: input.customerId, email: input.payerEmail },
        },
      });
      return chargeResultOf(json as MpPayment);
    },

    async getStatus(ref) {
      if (ref.externalId !== null) {
        const payment = await getPayment(ref.externalId);
        return payment === null ? null : chargeResultOf(payment);
      }
      const { json } = await request(
        'GET',
        `/v1/payments/search?external_reference=${encodeURIComponent(ref.chargeId)}&sort=date_created&criteria=desc`,
      );
      const results = (json as { results?: MpPayment[] } | null)?.results ?? [];
      // A paid attempt wins over later failed ones; otherwise the newest attempt speaks.
      const chosen = results.find((p) => p.status === 'approved') ?? results[0];
      return chosen === undefined ? null : chargeResultOf(chosen);
    },

    async cancelCharge(ref) {
      logGateway('mercadopago', 'cancelCharge', { chargeId: ref.chargeId });
      // A Checkout Pro preference has no payment to cancel; it simply expires.
      if (ref.externalId === null) return;
      await request('PUT', `/v1/payments/${encodeURIComponent(ref.externalId)}`, {
        body: { status: 'cancelled' },
      });
    },

    async refund(input) {
      logGateway('mercadopago', 'refund', {
        externalId: input.externalId,
        amountCents: input.amountCents,
      });
      const { json } = await request(
        'POST',
        `/v1/payments/${encodeURIComponent(input.externalId)}/refunds`,
        { idempotencyKey: input.idempotencyKey, body: { amount: toReais(input.amountCents) } },
      );
      const refund = json as { id: number | string; status?: string };
      const status =
        refund.status === 'approved'
          ? ('approved' as const)
          : refund.status === 'rejected' || refund.status === 'cancelled'
            ? ('failed' as const)
            : ('pending' as const);
      return { externalId: String(refund.id), status };
    },

    async ensureCustomer(user) {
      if (user.existingId !== undefined) return { customerId: user.existingId };
      const { json: found } = await request(
        'GET',
        `/v1/customers/search?email=${encodeURIComponent(user.email)}`,
      );
      const existing = (found as { results?: { id: string }[] } | null)?.results?.[0];
      if (existing !== undefined) return { customerId: String(existing.id) };
      const { json } = await request('POST', '/v1/customers', {
        body: {
          email: user.email,
          ...splitName(user.name),
          identification: { type: docType(user.docType), number: user.docNumber },
        },
      });
      return { customerId: String((json as { id: string }).id) };
    },

    async saveCard(input) {
      const { json } = await request(
        'POST',
        `/v1/customers/${encodeURIComponent(input.customerId)}/cards`,
        { body: { token: input.cardToken } },
      );
      const card = json as {
        id: string | number;
        last_four_digits: string;
        expiration_month: number;
        expiration_year: number;
        payment_method?: { id?: string };
      };
      return {
        cardId: String(card.id),
        brand: card.payment_method?.id ?? 'card',
        last4: card.last_four_digits,
        expMonth: card.expiration_month,
        expYear: card.expiration_year,
      };
    },

    async parseWebhook(req): Promise<ParsedWebhook> {
      const secret = deps.credentials.webhookSecret;
      const signature = parseSignatureHeader(req.headers['x-signature']);
      if (secret === undefined || secret === '' || signature === null) return { valid: false };

      let body: { type?: unknown; data?: { id?: unknown } } = {};
      try {
        body = JSON.parse(req.rawBody) as typeof body;
      } catch {
        // The id may still come from the query string.
      }
      const rawId = req.query['data.id'] ?? req.query['data_id'] ?? body.data?.id;
      const dataId =
        typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;
      const requestId = req.headers['x-request-id'];
      // The manifest omits any pair the notification does not carry; alphanumeric ids are lowercase.
      const manifest =
        (dataId === undefined
          ? ''
          : `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`) +
        (requestId === undefined ? '' : `request-id:${requestId};`) +
        `ts:${signature.ts};`;
      const expected = createHmac('sha256', secret).update(manifest).digest('hex');
      if (!safeEqual(signature.v1, expected)) return { valid: false };

      const topic = req.query['type'] ?? req.query['topic'] ?? body.type;
      if (dataId === undefined || (topic !== undefined && topic !== 'payment')) {
        return { valid: true, ignored: true };
      }
      // Never trust the payload's status: ask the provider (NUC-114).
      const payment = await getPayment(dataId);
      if (payment === null) return { valid: true, ignored: true };
      const status = mapMercadoPagoStatus(payment);
      return {
        valid: true,
        externalId: String(payment.id),
        externalStatus: payment.status ?? 'unknown',
        status,
        ...(typeof payment.external_reference === 'string' &&
          payment.external_reference !== '' && { chargeId: payment.external_reference }),
        ...(payment.transaction_amount !== undefined && {
          amountCents: toCents(payment.transaction_amount),
        }),
        ...(status === 'approved' && { feeCents: feeOf(payment) }),
        raw: rawPayment(payment),
      };
    },

    async verifyCredentials(credentials, environment) {
      const accessToken = credentials['accessToken'];
      if (accessToken === undefined || accessToken === '') {
        return { ok: false, message: 'Informe o access token do Mercado Pago.' };
      }
      try {
        const { json } = await request('GET', '/users/me', {
          credentials: { accessToken },
        });
        const me = json as { nickname?: string; email?: string; id?: number | string } | null;
        const who = me?.nickname ?? me?.email ?? String(me?.id ?? '');
        return {
          ok: true,
          message: `Conectado ao Mercado Pago${who === '' ? '' : ` como ${who}`} (${environment === 'production' ? 'produção' : 'teste'}).`,
        };
      } catch (error) {
        if (
          error instanceof GatewayError &&
          (error.httpStatus === 401 || error.httpStatus === 403)
        ) {
          return { ok: false, message: 'Credenciais recusadas pelo Mercado Pago.' };
        }
        return { ok: false, message: 'Não foi possível consultar o Mercado Pago agora.' };
      }
    },
  };
}
