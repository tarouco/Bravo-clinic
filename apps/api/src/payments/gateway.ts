import type { Cents, chargeStatusSchema } from '@bravo/core';
import type { z } from 'zod';
import { logger } from '../lib/logger';

// Provider-agnostic payment gateway (AD-006, NUC-105). Adapters never see the database: the
// services in `modules/payments` own persistence and call the gateway after commit.

export type ProviderId = 'sandbox' | 'mercadopago';
export const PROVIDER_IDS: readonly ProviderId[] = ['sandbox', 'mercadopago'];

export const isProviderId = (value: string): value is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(value);

/** Provider-agnostic charge status (docs/architecture.md section 3.3). */
export type NormalizedStatus = z.infer<typeof chargeStatusSchema>;

export type PayerDocType = 'cpf' | 'cnpj';

export interface CreateChargeInput {
  chargeId: string;
  idempotencyKey: string;
  method: 'pix' | 'card';
  amountCents: Cents;
  description: string;
  payer: { email: string; name: string; docType: PayerDocType; docNumber: string };
  /** Pix and hosted-card expiry; equals the booking hold (AD-034). */
  expiresAt: Date;
  /** Where the hosted checkout sends the customer back to. */
  returnUrl: string;
}

export interface ChargeResult {
  externalId: string | null;
  status: NormalizedStatus;
  /** Pix "copia e cola" string. */
  pixCopyPaste?: string;
  pixQrCodeBase64?: string;
  /** Hosted checkout (card, and the sandbox page for Pix). */
  checkoutUrl?: string;
  feeCents?: Cents;
  /** Provider response kept in `charges.raw_last`; never holds card data. */
  raw: unknown;
}

export interface SavedCardInfo {
  cardId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export type ParsedWebhook =
  | { valid: false }
  | {
      valid: true;
      externalId: string;
      /** The provider's own status word (the `webhook_events.external_status` dedupe key). */
      externalStatus: string;
      /** `externalStatus` normalized; for Mercado Pago it comes from the re-fetched payment. */
      status: NormalizedStatus;
      chargeId?: string;
      /** Amount the provider reports, compared with the charge (NUC-116). */
      amountCents?: Cents;
      raw: unknown;
    };

export interface PaymentGateway {
  id: ProviderId;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  chargeSavedCard(input: {
    chargeId: string;
    idempotencyKey: string;
    amountCents: Cents;
    description: string;
    customerId: string;
    cardId: string;
    payerEmail: string;
  }): Promise<ChargeResult>;
  /** `null` = the provider does not know the payment. */
  getStatus(ref: { externalId: string | null; chargeId: string }): Promise<ChargeResult | null>;
  cancelCharge(ref: { externalId: string | null; chargeId: string }): Promise<void>;
  refund(input: {
    externalId: string;
    amountCents: Cents;
    idempotencyKey: string;
  }): Promise<{ externalId: string; status: 'approved' | 'pending' | 'failed' }>;
  ensureCustomer(user: {
    userId: string;
    email: string;
    name: string;
    docType: PayerDocType;
    docNumber: string;
    existingId?: string;
  }): Promise<{ customerId: string }>;
  saveCard(input: { customerId: string; cardToken: string }): Promise<SavedCardInfo>;
  /** Verifies the signature first; an invalid delivery never reaches `webhook_events`. */
  parseWebhook(request: {
    headers: Record<string, string>;
    rawBody: string;
    query: Record<string, string>;
  }): Promise<ParsedWebhook>;
  verifyCredentials(
    credentials: Record<string, string>,
    environment: 'test' | 'production',
  ): Promise<{ ok: boolean; message: string }>;
}

export interface GatewayAdapterInfo {
  provider: ProviderId;
  label: string;
  credentialFields: { key: string; label: string; secret: boolean }[];
}

/** Metadata for the admin Integrações screen (NUC-208). */
export function listGatewayAdapters(): GatewayAdapterInfo[] {
  return [
    { provider: 'sandbox', label: 'Sandbox (simulado)', credentialFields: [] },
    {
      provider: 'mercadopago',
      label: 'Mercado Pago',
      credentialFields: [
        { key: 'accessToken', label: 'Access token', secret: true },
        { key: 'webhookSecret', label: 'Assinatura secreta do webhook', secret: true },
        { key: 'publicKey', label: 'Public key', secret: false },
      ],
    },
  ];
}

/** A provider call failed or timed out; the charge stays pending for reconciliation (NUC-111). */
export class GatewayError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'http' | 'invalid_response',
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

const FORBIDDEN_LOG_KEYS = new Set([
  'cardnumber',
  'card_number',
  'cvv',
  'securitycode',
  'security_code',
]);

/** Deep copy without card-number or CVV keys, whatever their casing (NUC-128). */
export function stripCardData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCardData);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !FORBIDDEN_LOG_KEYS.has(key.toLowerCase()))
        .map(([key, inner]) => [key, stripCardData(inner)]),
    );
  }
  return value;
}

/** The one logging door of the adapters: payloads lose card keys, the logger redacts secrets. */
export function logGateway(
  provider: ProviderId,
  event: string,
  payload: Record<string, unknown> = {},
): void {
  logger.info('gateway', { provider, event, ...(stripCardData(payload) as object) });
}
