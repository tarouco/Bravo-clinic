import type { PaymentConfig } from '@bravo/core';

// Card tokenizers (design.md "Card tokenizers", NUC-128): the card number and CVV only ever reach
// the provider's own tokenizer; the API receives the resulting token and nothing else.

export interface CardInput {
  number: string;
  holder: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  /** CPF or CNPJ digits of the card holder (Mercado Pago identification). */
  document: string;
}

export type Tokenizer = (card: CardInput) => Promise<string>;

const digitsOf = (value: string): string => value.replace(/\D/g, '');

/** Sandbox: no network and no real provider; the token carries only the last four digits. */
export const sandboxTokenizer: Tokenizer = (card) => {
  const digits = digitsOf(card.number);
  if (digits.length < 12) return Promise.reject(new Error('Número de cartão inválido.'));
  return Promise.resolve(`tok_sandbox_${digits.slice(-4)}`);
};

const MP_SDK_URL = 'https://sdk.mercadopago.com/js/v2';

interface MercadoPagoClient {
  createCardToken: (data: Record<string, string>) => Promise<{ id: string }>;
}

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoClient;
  }
}

let sdkLoading: Promise<void> | null = null;

/** Loads the Mercado Pago browser SDK once. */
function loadMercadoPagoSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MP_SDK_URL;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      sdkLoading = null;
      reject(new Error('Não foi possível carregar o formulário seguro do cartão.'));
    };
    document.head.appendChild(script);
  });
  return sdkLoading;
}

/** Mercado Pago: `mp.createCardToken` runs in the browser and returns an opaque token id. */
export function mercadoPagoTokenizer(publicKey: string): Tokenizer {
  return async (card) => {
    await loadMercadoPagoSdk();
    if (!window.MercadoPago) throw new Error('Formulário seguro do cartão indisponível.');
    const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
    const document = digitsOf(card.document);
    const token = await mp.createCardToken({
      cardNumber: digitsOf(card.number),
      cardholderName: card.holder.trim(),
      cardExpirationMonth: card.expMonth.padStart(2, '0'),
      cardExpirationYear: card.expYear.length === 2 ? `20${card.expYear}` : card.expYear,
      securityCode: digitsOf(card.cvv),
      identificationType: document.length > 11 ? 'CNPJ' : 'CPF',
      identificationNumber: document,
    });
    return token.id;
  };
}

/** The tokenizer of the active provider (`GET /api/public/payment-config`). */
export function tokenizerFor(config: PaymentConfig): Tokenizer {
  if (config.provider === 'mercadopago' && config.publicKey) {
    return mercadoPagoTokenizer(config.publicKey);
  }
  return sandboxTokenizer;
}
