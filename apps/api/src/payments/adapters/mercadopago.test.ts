import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GatewayError } from '../gateway';
import {
  MP_TIMEOUT_MS,
  createMercadoPagoGateway,
  mapMercadoPagoStatus,
  toMercadoPagoDate,
} from './mercadopago';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const CHARGE_ID = '5d3b1f0e-7c1a-4f0e-9a52-0d2c9f6a1b11';
const WEBHOOK_SECRET = 'mp-webhook-secret';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; json?: unknown } | Error;

/** A `fetch` that records every call and answers from a queue. */
function stubFetch(...replies: Reply[]) {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetchStub: typeof fetch = (input, init) => {
    calls.push({
      url: input as string,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = queue.shift();
    if (reply === undefined) return Promise.reject(new Error('unexpected extra fetch'));
    if (reply instanceof Error) return Promise.reject(reply);
    const status = reply.status ?? 200;
    return Promise.resolve(
      new Response(reply.json === undefined ? '' : JSON.stringify(reply.json), { status }),
    );
  };
  return { fetch: fetchStub, calls };
}

const gatewayWith = (fetchStub: typeof fetch, extra: { timeoutMs?: number } = {}) =>
  createMercadoPagoGateway({
    credentials: { accessToken: 'APP_USR-token', webhookSecret: WEBHOOK_SECRET },
    env: { APP_BASE_URL: 'https://clinic.test' },
    fetch: fetchStub,
    now: () => NOW,
    ...extra,
  });

const payer = {
  email: 'ana@bravoclinic.test',
  name: 'Ana Souza Lima',
  docType: 'cpf' as const,
  docNumber: '52998224725',
};

const chargeInput = (method: 'pix' | 'card', expiresAt = new Date('2026-10-20T12:45:00.000Z')) => ({
  chargeId: CHARGE_ID,
  idempotencyKey: 'ik-1',
  method,
  amountCents: 10950,
  description: 'Reserva BRV-ABC123',
  payer,
  expiresAt,
  returnUrl: 'https://clinic.test/checkout/booking-1',
});

describe('Pix charge (NUC-122)', () => {
  const payment = {
    id: 987654321,
    status: 'pending',
    status_detail: 'pending_waiting_transfer',
    transaction_amount: 109.5,
    point_of_interaction: {
      transaction_data: { qr_code: '00020126PIX', qr_code_base64: 'iVBORw0KGgo=' },
    },
  };

  it('POSTs /v1/payments with the amount in reais, pix, expiry, reference and idempotency key', async () => {
    const { fetch, calls } = stubFetch({ status: 201, json: payment });

    const result = await gatewayWith(fetch).createCharge(chargeInput('pix'));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.mercadopago.com/v1/payments');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['Authorization']).toBe('Bearer APP_USR-token');
    expect(calls[0]?.headers['X-Idempotency-Key']).toBe('ik-1');
    expect(calls[0]?.body).toEqual({
      transaction_amount: 109.5,
      description: 'Reserva BRV-ABC123',
      payment_method_id: 'pix',
      date_of_expiration: '2026-10-20T09:45:00.000-03:00',
      external_reference: CHARGE_ID,
      notification_url: 'https://clinic.test/api/webhooks/pagamentos/mercadopago',
      payer: {
        email: 'ana@bravoclinic.test',
        first_name: 'Ana',
        last_name: 'Souza Lima',
        identification: { type: 'CPF', number: '52998224725' },
      },
    });
    expect(result).toMatchObject({
      externalId: '987654321',
      status: 'pending',
      pixCopyPaste: '00020126PIX',
      pixQrCodeBase64: 'iVBORw0KGgo=',
    });
  });

  it('never asks for an expiry under 31 minutes, the API minimum being 30', async () => {
    const { fetch, calls } = stubFetch({ json: payment });

    await gatewayWith(fetch).createCharge(chargeInput('pix', new Date('2026-10-20T12:15:00.000Z')));

    expect((calls[0]?.body as { date_of_expiration: string }).date_of_expiration).toBe(
      '2026-10-20T09:31:00.000-03:00',
    );
  });

  it('reports the fee of an approved payment in cents', async () => {
    const { fetch } = stubFetch({
      json: { ...payment, status: 'approved', fee_details: [{ amount: 0.99 }, { amount: 0.01 }] },
    });

    const result = await gatewayWith(fetch).createCharge(chargeInput('pix'));

    expect(result.status).toBe('approved');
    expect(result.feeCents).toBe(100);
  });
});

describe('Checkout Pro preference for a card (NUC-123)', () => {
  it('POSTs /checkout/preferences with the hold as expiration_date_to and back URLs', async () => {
    const { fetch, calls } = stubFetch({
      status: 201,
      json: {
        id: 'pref-1',
        init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1',
      },
    });

    const result = await gatewayWith(fetch).createCharge(chargeInput('card'));

    expect(calls[0]?.url).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['X-Idempotency-Key']).toBe('ik-1');
    expect(calls[0]?.body).toMatchObject({
      items: [
        {
          id: CHARGE_ID,
          title: 'Reserva BRV-ABC123',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: 109.5,
        },
      ],
      external_reference: CHARGE_ID,
      back_urls: {
        success: 'https://clinic.test/checkout/booking-1',
        failure: 'https://clinic.test/checkout/booking-1',
        pending: 'https://clinic.test/checkout/booking-1',
      },
      expires: true,
      expiration_date_from: '2026-10-20T09:00:00.000-03:00',
      expiration_date_to: '2026-10-20T09:45:00.000-03:00',
      notification_url: 'https://clinic.test/api/webhooks/pagamentos/mercadopago',
    });
    expect(result).toMatchObject({
      externalId: null,
      status: 'pending',
      checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1',
    });
  });

  it('fails with a typed error when the answer has no init_point', async () => {
    const { fetch } = stubFetch({ json: { id: 'pref-1' } });

    await expect(gatewayWith(fetch).createCharge(chargeInput('card'))).rejects.toMatchObject({
      name: 'GatewayError',
      kind: 'invalid_response',
    });
  });
});

describe('status mapping (NUC-114)', () => {
  it.each([
    [{ status: 'approved' }, 'approved'],
    [{ status: 'pending' }, 'pending'],
    [{ status: 'in_process' }, 'pending'],
    [{ status: 'in_mediation' }, 'pending'],
    [{ status: 'authorized' }, 'pending'],
    [{ status: 'rejected' }, 'rejected'],
    [{ status: 'cancelled' }, 'cancelled'],
    [{ status: 'cancelled', status_detail: 'expired' }, 'expired'],
    [{ status: 'refunded' }, 'refunded'],
    [{ status: 'charged_back' }, 'charged_back'],
    [
      { status: 'approved', transaction_amount: 100, transaction_amount_refunded: 30 },
      'partially_refunded',
    ],
    [{ status: 'approved', transaction_amount: 100, transaction_amount_refunded: 100 }, 'refunded'],
    [{ status: 'something_new' }, 'pending'],
  ] as const)('maps %j to %s', (payment, expected) => {
    expect(mapMercadoPagoStatus(payment)).toBe(expected);
  });
});

describe('failures (NUC-111)', () => {
  it('aborts after the timeout and throws a typed timeout error', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('timed out', 'TimeoutError'));
        });
      });

    const error = await gatewayWith(hanging, { timeoutMs: 20 })
      .createCharge(chargeInput('pix'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ kind: 'timeout' });
  });

  it('uses a 10 second timeout by default', () => {
    expect(MP_TIMEOUT_MS).toBe(10_000);
  });

  it('turns a provider error into a typed http error without leaking the token', async () => {
    const { fetch } = stubFetch({ status: 400, json: { message: 'invalid payer' } });

    const error = await gatewayWith(fetch)
      .createCharge(chargeInput('pix'))
      .catch((e: unknown) => e as GatewayError);

    expect(error).toMatchObject({ kind: 'http', httpStatus: 400 });
    expect((error as GatewayError).message).toBe('Mercado Pago respondeu 400: invalid payer');
    expect((error as GatewayError).message).not.toContain('APP_USR');
  });

  it('turns a network failure into a typed network error', async () => {
    const { fetch } = stubFetch(new TypeError('fetch failed'));

    await expect(gatewayWith(fetch).createCharge(chargeInput('pix'))).rejects.toMatchObject({
      kind: 'network',
    });
  });
});

describe('refund (NUC-119)', () => {
  it('POSTs the partial amount in reais with the idempotency key', async () => {
    const { fetch, calls } = stubFetch({ status: 201, json: { id: 555, status: 'approved' } });

    const refund = await gatewayWith(fetch).refund({
      externalId: '987654321',
      amountCents: 4850,
      idempotencyKey: 'rf-1',
    });

    expect(calls[0]?.url).toBe('https://api.mercadopago.com/v1/payments/987654321/refunds');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['X-Idempotency-Key']).toBe('rf-1');
    expect(calls[0]?.body).toEqual({ amount: 48.5 });
    expect(refund).toEqual({ externalId: '555', status: 'approved' });
  });

  it.each([
    ['in_process', 'pending'],
    ['rejected', 'failed'],
  ] as const)('maps a %s refund to %s', async (providerStatus, expected) => {
    const { fetch } = stubFetch({ json: { id: 1, status: providerStatus } });

    const refund = await gatewayWith(fetch).refund({
      externalId: '1',
      amountCents: 100,
      idempotencyKey: 'rf',
    });

    expect(refund.status).toBe(expected);
  });
});

describe('webhook signature (NUC-124)', () => {
  const TS = '1704908010';
  const REQUEST_ID = 'req-abc-123';
  const sign = (manifest: string, secret = WEBHOOK_SECRET) =>
    createHmac('sha256', secret).update(manifest).digest('hex');
  const delivery = (
    overrides: { v1?: string; header?: string; query?: Record<string, string> } = {},
  ) => ({
    headers: {
      'x-signature':
        overrides.header ??
        `ts=${TS},v1=${overrides.v1 ?? sign(`id:123456;request-id:${REQUEST_ID};ts:${TS};`)}`,
      'x-request-id': REQUEST_ID,
    },
    rawBody: JSON.stringify({ type: 'payment', data: { id: '123456' }, action: 'payment.updated' }),
    query: overrides.query ?? { 'data.id': '123456', type: 'payment' },
  });
  const approvedPayment = {
    id: 123456,
    status: 'approved',
    transaction_amount: 109.5,
    external_reference: CHARGE_ID,
    fee_details: [{ amount: 1.5 }],
  };

  it('accepts a valid signature, re-fetches the payment and uses its status, not the payload', async () => {
    // The payload claims nothing about status; the provider says rejected.
    const { fetch, calls } = stubFetch({ json: { ...approvedPayment, status: 'rejected' } });

    const parsed = await gatewayWith(fetch).parseWebhook(delivery());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.mercadopago.com/v1/payments/123456');
    expect(calls[0]?.method).toBe('GET');
    expect(parsed).toMatchObject({
      valid: true,
      externalId: '123456',
      externalStatus: 'rejected',
      status: 'rejected',
      chargeId: CHARGE_ID,
      amountCents: 10950,
    });
    expect(parsed).not.toHaveProperty('feeCents');
  });

  it('maps the re-fetched approved payment to the charge by external_reference', async () => {
    const { fetch } = stubFetch({ json: approvedPayment });

    const parsed = await gatewayWith(fetch).parseWebhook(delivery());

    expect(parsed).toMatchObject({
      valid: true,
      status: 'approved',
      chargeId: CHARGE_ID,
      feeCents: 150,
    });
  });

  it('rejects a wrong v1 without calling the provider', async () => {
    const { fetch, calls } = stubFetch();

    const parsed = await gatewayWith(fetch).parseWebhook(delivery({ v1: 'a'.repeat(64) }));

    expect(parsed).toEqual({ valid: false });
    expect(calls).toHaveLength(0);
  });

  it('rejects a header without ts, without v1 or missing altogether', async () => {
    const { fetch, calls } = stubFetch();
    const gateway = gatewayWith(fetch);

    expect(await gateway.parseWebhook(delivery({ header: `v1=${sign('x')}` }))).toEqual({
      valid: false,
    });
    expect(await gateway.parseWebhook(delivery({ header: `ts=${TS}` }))).toEqual({ valid: false });
    expect(
      await gateway.parseWebhook({ ...delivery(), headers: { 'x-request-id': REQUEST_ID } }),
    ).toEqual({ valid: false });
    expect(calls).toHaveLength(0);
  });

  it('rejects a signature made for another data.id or another secret', async () => {
    const { fetch } = stubFetch();
    const gateway = gatewayWith(fetch);

    expect(
      await gateway.parseWebhook(delivery({ query: { 'data.id': '999999', type: 'payment' } })),
    ).toEqual({ valid: false });
    expect(
      await gateway.parseWebhook(
        delivery({ v1: sign(`id:123456;request-id:${REQUEST_ID};ts:${TS};`, 'other-secret') }),
      ),
    ).toEqual({ valid: false });
  });

  it('rejects every delivery when no webhook secret is configured', async () => {
    const { fetch } = stubFetch();
    const gateway = createMercadoPagoGateway({
      credentials: { accessToken: 'APP_USR-token' },
      env: { APP_BASE_URL: 'https://clinic.test' },
      fetch,
    });

    expect(await gateway.parseWebhook(delivery())).toEqual({ valid: false });
  });

  it('omits the request-id pair from the manifest when the header is absent, and lowercases the id', async () => {
    const { fetch } = stubFetch({ json: { ...approvedPayment, id: 'ABC123' } });
    const gateway = gatewayWith(fetch);

    const parsed = await gateway.parseWebhook({
      headers: { 'x-signature': `ts=${TS},v1=${sign(`id:abc123;ts:${TS};`)}` },
      rawBody: '{}',
      query: { 'data.id': 'ABC123', type: 'payment' },
    });

    expect(parsed).toMatchObject({ valid: true });
  });

  it('ignores an authentic delivery of another topic and of an unknown payment', async () => {
    const { fetch, calls } = stubFetch({ status: 404, json: { message: 'not found' } });
    const gateway = gatewayWith(fetch);
    const merchantOrder = delivery({ query: { 'data.id': '123456', type: 'merchant_order' } });

    expect(await gateway.parseWebhook(merchantOrder)).toEqual({ valid: true, ignored: true });
    expect(calls).toHaveLength(0);
    expect(await gateway.parseWebhook(delivery())).toEqual({ valid: true, ignored: true });
    expect(calls).toHaveLength(1);
  });
});

describe('status, cancel, customers and cards', () => {
  it('getStatus by external id fetches the payment, and returns null when it is unknown', async () => {
    const { fetch, calls } = stubFetch(
      { json: { id: 1, status: 'approved' } },
      { status: 404, json: { message: 'Payment not found' } },
    );
    const gateway = gatewayWith(fetch);

    const found = await gateway.getStatus({ externalId: '1', chargeId: CHARGE_ID });
    const missing = await gateway.getStatus({ externalId: '2', chargeId: CHARGE_ID });

    expect(calls[0]?.url).toBe('https://api.mercadopago.com/v1/payments/1');
    expect(found).toMatchObject({ externalId: '1', status: 'approved' });
    expect(missing).toBeNull();
  });

  it('getStatus without external id searches by external_reference and prefers an approved attempt', async () => {
    const { fetch, calls } = stubFetch({
      json: {
        results: [
          { id: 3, status: 'rejected' },
          { id: 2, status: 'approved' },
        ],
      },
    });

    const result = await gatewayWith(fetch).getStatus({ externalId: null, chargeId: CHARGE_ID });

    expect(calls[0]?.url).toBe(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${CHARGE_ID}&sort=date_created&criteria=desc`,
    );
    expect(result).toMatchObject({ externalId: '2', status: 'approved' });
  });

  it('getStatus without external id returns null when nothing was paid or tried', async () => {
    const { fetch } = stubFetch({ json: { results: [] } });

    expect(
      await gatewayWith(fetch).getStatus({ externalId: null, chargeId: CHARGE_ID }),
    ).toBeNull();
  });

  it('cancelCharge PUTs status cancelled, and does nothing for a preference', async () => {
    const { fetch, calls } = stubFetch({ json: { id: 1, status: 'cancelled' } });
    const gateway = gatewayWith(fetch);

    await gateway.cancelCharge({ externalId: '1', chargeId: CHARGE_ID });
    await gateway.cancelCharge({ externalId: null, chargeId: CHARGE_ID });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/payments/1',
      method: 'PUT',
      body: { status: 'cancelled' },
    });
  });

  it('ensureCustomer reuses a known id, then a customer found by e-mail, then creates one', async () => {
    const { fetch, calls } = stubFetch(
      { json: { results: [{ id: 'cus-found' }] } },
      { json: { results: [] } },
      { status: 201, json: { id: 'cus-new' } },
    );
    const gateway = gatewayWith(fetch);
    const user = {
      userId: 'u1',
      email: 'ana@bravoclinic.test',
      name: 'Ana Souza',
      docType: 'cpf' as const,
      docNumber: '52998224725',
    };

    expect(await gateway.ensureCustomer({ ...user, existingId: 'cus-known' })).toEqual({
      customerId: 'cus-known',
    });
    expect(await gateway.ensureCustomer(user)).toEqual({ customerId: 'cus-found' });
    expect(await gateway.ensureCustomer(user)).toEqual({ customerId: 'cus-new' });
    expect(calls[0]?.url).toBe(
      'https://api.mercadopago.com/v1/customers/search?email=ana%40bravoclinic.test',
    );
    expect(calls[2]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/customers',
      method: 'POST',
      body: {
        email: 'ana@bravoclinic.test',
        first_name: 'Ana',
        last_name: 'Souza',
        identification: { type: 'CPF', number: '52998224725' },
      },
    });
  });

  it('saveCard POSTs the token to the customer and maps brand, last4 and expiry', async () => {
    const { fetch, calls } = stubFetch({
      status: 201,
      json: {
        id: '8765',
        last_four_digits: '4242',
        expiration_month: 11,
        expiration_year: 2030,
        payment_method: { id: 'visa' },
      },
    });

    const card = await gatewayWith(fetch).saveCard({ customerId: 'cus-1', cardToken: 'tok-123' });

    expect(calls[0]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/customers/cus-1/cards',
      method: 'POST',
      body: { token: 'tok-123' },
    });
    expect(card).toEqual({
      cardId: '8765',
      brand: 'visa',
      last4: '4242',
      expMonth: 11,
      expYear: 2030,
    });
  });

  it('chargeSavedCard creates a token from the card id, then pays as the customer', async () => {
    const { fetch, calls } = stubFetch(
      { status: 201, json: { id: 'tok-from-card' } },
      { status: 201, json: { id: 77, status: 'approved', fee_details: [{ amount: 2.5 }] } },
    );

    const result = await gatewayWith(fetch).chargeSavedCard({
      chargeId: CHARGE_ID,
      idempotencyKey: 'ik-bal',
      amountCents: 5000,
      description: 'Saldo BRV-ABC123',
      customerId: 'cus-1',
      cardId: 'card-1',
      payerEmail: 'ana@bravoclinic.test',
    });

    expect(calls[0]).toMatchObject({
      url: 'https://api.mercadopago.com/v1/card_tokens',
      body: { card_id: 'card-1', customer_id: 'cus-1' },
    });
    expect(calls[1]?.url).toBe('https://api.mercadopago.com/v1/payments');
    expect(calls[1]?.headers['X-Idempotency-Key']).toBe('ik-bal');
    expect(calls[1]?.body).toMatchObject({
      transaction_amount: 50,
      token: 'tok-from-card',
      installments: 1,
      external_reference: CHARGE_ID,
      payer: { type: 'customer', id: 'cus-1', email: 'ana@bravoclinic.test' },
    });
    expect(result).toMatchObject({ externalId: '77', status: 'approved', feeCents: 250 });
  });
});

describe('verifyCredentials (NUC-208)', () => {
  it('is ok when GET /users/me answers with the given token', async () => {
    const { fetch, calls } = stubFetch({ json: { id: 1, nickname: 'BRAVOCLINIC' } });

    const result = await gatewayWith(fetch).verifyCredentials(
      { accessToken: 'APP_USR-other' },
      'test',
    );

    expect(calls[0]?.url).toBe('https://api.mercadopago.com/users/me');
    expect(calls[0]?.headers['Authorization']).toBe('Bearer APP_USR-other');
    expect(result).toEqual({
      ok: true,
      message: 'Conectado ao Mercado Pago como BRAVOCLINIC (teste).',
    });
  });

  it('is not ok for a refused token, an unreachable provider or a missing token', async () => {
    const { fetch } = stubFetch(
      { status: 401, json: { message: 'invalid token' } },
      new TypeError('fetch failed'),
    );
    const gateway = gatewayWith(fetch);

    expect(await gateway.verifyCredentials({ accessToken: 'bad' }, 'production')).toEqual({
      ok: false,
      message: 'Credenciais recusadas pelo Mercado Pago.',
    });
    expect((await gateway.verifyCredentials({ accessToken: 'x' }, 'test')).ok).toBe(false);
    expect(await gateway.verifyCredentials({}, 'test')).toEqual({
      ok: false,
      message: 'Informe o access token do Mercado Pago.',
    });
  });
});

describe('toMercadoPagoDate', () => {
  it('writes the clinic wall clock with the fixed -03:00 offset', () => {
    expect(toMercadoPagoDate(new Date('2026-10-20T12:00:00.000Z'))).toBe(
      '2026-10-20T09:00:00.000-03:00',
    );
    expect(toMercadoPagoDate(new Date('2026-01-01T02:00:00.000Z'))).toBe(
      '2025-12-31T23:00:00.000-03:00',
    );
  });
});
