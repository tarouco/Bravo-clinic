import { describe } from 'vitest';
import {
  bookingListQuerySchema,
  bookingListSchema,
  cancellationPreviewSchema,
  cancelRequestSchema,
  createBookingSchema,
  meSchema,
  payBalanceRequestSchema,
  payRequestSchema,
  rescheduleQuoteRequestSchema,
  rescheduleQuoteSchema,
  rescheduleRequestSchema,
  rescheduleResultSchema,
  saveCardSchema,
  savedCardListSchema,
  savedCardSchema,
  totpDisableRequestSchema,
  totpDisableResponseSchema,
  updateMeSchema,
} from './app';
import {
  bookingDetail,
  bookingSummary,
  chargeIntent,
  describeContracts,
  ID,
  quote,
} from './fixtures.test-support';

const quoteRequest = {
  roomSlug: 'principal',
  date: '2026-10-27',
  startMinute: 1050,
  endMinute: 1200,
};
const savedCard = {
  id: ID.other,
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  recurringConsentAt: '2026-10-20T12:00:00.000Z',
};
const me = {
  id: ID.user,
  name: 'Camila Souza',
  email: 'camila@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
  phone: '+5547999990000',
  profession: 'Dermatologista',
  professionalRegistry: null,
  document: '52998224725',
};
const settlement = { payNowCents: 0, creditCents: 14300, newTotalCents: 9700, newBalanceCents: 0 };

describe('app contracts (NUC-04)', () => {
  describeContracts([
    [
      'createBookingSchema',
      createBookingSchema,
      { ...quoteRequest, acceptPolicy: true, policyVersion: 1, expectedTotalCents: 21900 },
      { ...quoteRequest, acceptPolicy: false, policyVersion: 1, expectedTotalCents: 21900 },
    ],
    ['bookingListQuerySchema', bookingListQuerySchema, { tab: 'upcoming' }, { tab: 'all' }],
    [
      'bookingListSchema',
      bookingListSchema,
      { items: [bookingSummary], nextCursor: null },
      { items: [bookingSummary] },
    ],
    [
      'payRequestSchema',
      payRequestSchema,
      { method: 'pix', acceptPolicy: true, policyVersion: 1 },
      { method: 'saved_card' },
    ],
    [
      'payBalanceRequestSchema',
      payBalanceRequestSchema,
      { method: 'saved_card', savedCardId: ID.other },
      { method: 'boleto' },
    ],
    [
      'rescheduleQuoteRequestSchema',
      rescheduleQuoteRequestSchema,
      { date: '2026-11-03', startMinute: 840, endMinute: 900 },
      { date: '2026-11-03', startMinute: 840 },
    ],
    [
      'rescheduleQuoteSchema',
      rescheduleQuoteSchema,
      { allowed: true, reason: null, message: null, newQuote: quote, settlement },
      { allowed: false, reason: 'too_soon', message: 'x', newQuote: null, settlement: null },
    ],
    [
      'rescheduleRequestSchema',
      rescheduleRequestSchema,
      {
        roomSlug: 'secundaria',
        date: '2026-11-03',
        startMinute: 840,
        endMinute: 1020,
        method: 'pix',
      },
      { date: '2026-11-03', startMinute: 840, endMinute: 1020, method: 'cash' },
    ],
    [
      'rescheduleResultSchema',
      rescheduleResultSchema,
      {
        rescheduleRequestId: ID.other,
        expiresAt: '2026-10-20T12:15:00.000Z',
        charge: chargeIntent,
      },
      { rescheduleRequestId: ID.other, charge: chargeIntent },
    ],
    [
      'rescheduleResultSchema (moved at once)',
      rescheduleResultSchema,
      { ...bookingDetail, creditCents: 14300 },
      bookingDetail,
    ],
    [
      'cancellationPreviewSchema',
      cancellationPreviewSchema,
      { retainedCents: 8000, refundCents: 8000, minutesReturned: 0, creditCents: 0 },
      { retainedCents: 8000, refundCents: -1, minutesReturned: 0, creditCents: 0 },
    ],
    [
      'cancelRequestSchema',
      cancelRequestSchema,
      { reason: 'Imprevisto' },
      { reason: 'x'.repeat(501) },
    ],
    ['savedCardSchema', savedCardSchema, savedCard, { ...savedCard, last4: '42' }],
    [
      'savedCardListSchema',
      savedCardListSchema,
      { items: [savedCard] },
      { items: [{ ...savedCard, expMonth: 13 }] },
    ],
    [
      'saveCardSchema',
      saveCardSchema,
      { cardToken: 'tok_sandbox_4242', recurringConsent: true },
      { cardToken: 'tok_sandbox_4242', recurringConsent: false },
    ],
    [
      'updateMeSchema',
      updateMeSchema,
      { name: 'Camila Souza', phone: '(47) 99999-0000', document: '529.982.247-25' },
      { document: '111.111.111-11' },
    ],
    ['meSchema', meSchema, me, { ...me, role: 'owner' }],
    [
      'totpDisableRequestSchema',
      totpDisableRequestSchema,
      { code: 'abcd-efgh' },
      { code: '12345' },
    ],
    [
      'totpDisableResponseSchema',
      totpDisableResponseSchema,
      { mfa: { enrolled: false, verified: false } },
      { mfa: { enrolled: true, verified: true } },
    ],
  ]);
});
