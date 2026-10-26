import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGatewayAdapters, logGateway, stripCardData } from '../gateway';
import {
  SANDBOX_SIGNATURE_HEADER,
  buildSandboxWebhook,
  createSandboxGateway,
  sandboxExternalId,
} from './sandbox';

const env = {
  SESSION_SECRET: 'test-only-session-secret-0123456789abcdef',
  APP_BASE_URL: 'http://localhost:5173',
};
const gateway = createSandboxGateway({ env, now: () => new Date('2026-10-20T12:00:00Z') });

const CHARGE_ID = '5d3b1f0e-7c1a-4f0e-9a52-0d2c9f6a1b11';

const chargeInput = (method: 'pix' | 'card') => ({
  chargeId: CHARGE_ID,
  idempotencyKey: 'ik-1',
  method,
  amountCents: 10950,
  description: 'Reserva BRV-ABC123',
  payer: {
    email: 'ana@bravoclinic.test',
    name: 'Ana',
    docType: 'cpf' as const,
    docNumber: '52998224725',
  },
  expiresAt: new Date('2026-10-20T12:15:00Z'),
  returnUrl: 'http://localhost:5173/checkout/x',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sandbox createCharge (NUC-105)', () => {
  it('returns an sbx_ id, the hosted checkout URL and a fake Pix copy-paste for Pix', async () => {
    const result = await gateway.createCharge(chargeInput('pix'));

    expect(result.externalId).toBe(`sbx_${CHARGE_ID}`);
    expect(result.externalId).toBe(sandboxExternalId(CHARGE_ID));
    expect(result.status).toBe('pending');
    expect(result.checkoutUrl).toBe(`http://localhost:5173/pagamento/sandbox/${CHARGE_ID}`);
    expect(result.pixCopyPaste).toBe(`00020126SANDBOX${CHARGE_ID}`);
    expect(result.feeCents).toBe(0);
  });

  it('returns the hosted page and no Pix code for a card charge', async () => {
    const result = await gateway.createCharge(chargeInput('card'));

    expect(result.checkoutUrl).toBe(`http://localhost:5173/pagamento/sandbox/${CHARGE_ID}`);
    expect(result.pixCopyPaste).toBeUndefined();
  });
});

describe('sandbox webhook (NUC-120)', () => {
  const payload = {
    chargeId: CHARGE_ID,
    externalId: `sbx_${CHARGE_ID}`,
    status: 'approved' as const,
    amountCents: 10950,
  };

  it('parseWebhook accepts a delivery signed by buildSandboxWebhook', async () => {
    const { headers, rawBody } = buildSandboxWebhook(payload, env);

    const parsed = await gateway.parseWebhook({ headers, rawBody, query: {} });

    expect(parsed).toMatchObject({
      valid: true,
      externalId: `sbx_${CHARGE_ID}`,
      externalStatus: 'approved',
      status: 'approved',
      chargeId: CHARGE_ID,
      amountCents: 10950,
    });
  });

  it('rejects a tampered body with the original signature', async () => {
    const { headers, rawBody } = buildSandboxWebhook(payload, env);
    const tampered = rawBody.replace('"approved"', '"rejected"');

    expect(await gateway.parseWebhook({ headers, rawBody: tampered, query: {} })).toEqual({
      valid: false,
    });
  });

  it('rejects a missing or wrong signature', async () => {
    const { rawBody } = buildSandboxWebhook(payload, env);

    expect(await gateway.parseWebhook({ headers: {}, rawBody, query: {} })).toEqual({
      valid: false,
    });
    expect(
      await gateway.parseWebhook({
        headers: { [SANDBOX_SIGNATURE_HEADER]: 'f'.repeat(64) },
        rawBody,
        query: {},
      }),
    ).toEqual({ valid: false });
  });

  it('rejects a delivery signed with another secret', async () => {
    const forged = buildSandboxWebhook(payload, { SESSION_SECRET: 'x'.repeat(40) });

    expect(
      await gateway.parseWebhook({ headers: forged.headers, rawBody: forged.rawBody, query: {} }),
    ).toEqual({ valid: false });
  });

  it('rejects a correctly signed body that is not a sandbox payload', async () => {
    const { signSandboxBody } = await import('./sandbox');
    const rawBody = '{"hello":"world"}';

    const parsed = await gateway.parseWebhook({
      headers: { [SANDBOX_SIGNATURE_HEADER]: signSandboxBody(rawBody, env) },
      rawBody,
      query: {},
    });

    expect(parsed).toEqual({ valid: false });
  });
});

describe('sandbox credentials, cards and refunds (NUC-208)', () => {
  it('verifyCredentials is always ok', async () => {
    expect((await gateway.verifyCredentials({}, 'test')).ok).toBe(true);
    expect((await gateway.verifyCredentials({}, 'production')).ok).toBe(true);
  });

  it('saveCard reads the last4 from the sandbox tokenizer token', async () => {
    const card = await gateway.saveCard({ customerId: 'sbx_cus_1', cardToken: 'tok_sandbox_1111' });

    expect(card).toMatchObject({ brand: 'visa', last4: '1111', expMonth: 12, expYear: 2030 });
    expect(card.cardId.startsWith('sbx_card_1111_')).toBe(true);
  });

  it('charges a saved card at once, declining the 0002 test card', async () => {
    const base = {
      chargeId: CHARGE_ID,
      idempotencyKey: 'ik-2',
      amountCents: 5000,
      description: 'Saldo',
      customerId: 'sbx_cus_1',
      payerEmail: 'ana@bravoclinic.test',
    };
    const ok = await gateway.chargeSavedCard({ ...base, cardId: 'sbx_card_4242_a' });
    const declined = await gateway.chargeSavedCard({ ...base, cardId: 'sbx_card_0002_a' });

    expect(ok.status).toBe('approved');
    expect(declined.status).toBe('rejected');
  });

  it('refund is approved with an id derived from the idempotency key', async () => {
    const refund = await gateway.refund({
      externalId: `sbx_${CHARGE_ID}`,
      amountCents: 1000,
      idempotencyKey: 'rf-1',
    });

    expect(refund).toEqual({ externalId: 'sbx_refund_rf-1', status: 'approved' });
  });
});

describe('listGatewayAdapters (NUC-208)', () => {
  it('lists the sandbox without fields and Mercado Pago with its credential fields', () => {
    const adapters = listGatewayAdapters();

    expect(adapters.map((a) => a.provider)).toEqual(['sandbox', 'mercadopago']);
    expect(adapters[0]?.credentialFields).toEqual([]);
    expect(adapters[1]?.credentialFields).toEqual([
      { key: 'accessToken', label: 'Access token', secret: true },
      { key: 'webhookSecret', label: 'Assinatura secreta do webhook', secret: true },
      { key: 'publicKey', label: 'Public key', secret: false },
    ]);
  });
});

describe('adapter logs never hold card data (NUC-128)', () => {
  it('stripCardData removes cardNumber, cvv and securityCode at any depth and casing', () => {
    const cleaned = stripCardData({
      amount: 1,
      cardNumber: '4111111111111111',
      nested: { CVV: '123', securityCode: '123', keep: 'x', list: [{ card_number: '1', ok: 2 }] },
    });

    expect(cleaned).toEqual({ amount: 1, nested: { keep: 'x', list: [{ ok: 2 }] } });
  });

  it('logGateway writes the event without the forbidden keys', () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    logGateway('sandbox', 'test', { cardNumber: '4111111111111111', cvv: '123', amountCents: 5 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"amountCents":5');
    for (const key of ['cardNumber', 'cvv', 'securityCode', '4111111111111111']) {
      expect(lines[0]).not.toContain(key);
    }
  });

  it('every sandbox operation logs without card keys even when the input carries them', async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const dirty = { cardNumber: '4111111111111111', cvv: '123', securityCode: '123' };

    await gateway.createCharge({ ...chargeInput('card'), ...dirty });
    await gateway.chargeSavedCard({
      chargeId: CHARGE_ID,
      idempotencyKey: 'k',
      amountCents: 100,
      description: 'd',
      customerId: 'c',
      cardId: 'sbx_card_4242_x',
      payerEmail: 'a@b.test',
      ...dirty,
    });
    await gateway.refund({
      externalId: 'e',
      amountCents: 1,
      idempotencyKey: 'r',
      ...dirty,
    });

    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      for (const key of ['cardNumber', 'cvv', 'securityCode']) expect(line).not.toContain(key);
    }
  });
});
