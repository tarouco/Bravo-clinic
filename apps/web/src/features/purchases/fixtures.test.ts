import {
  adminSubscriptionListSchema,
  cancelPreviewSchema,
  couponListSchema,
  couponUseListSchema,
  creditsSummarySchema,
  extraHoursSummarySchema,
  ledgerPageSchema,
  occurrenceCheckSchema,
  packageOfferListSchema,
  periodSchema,
  purchaseHistoryPageSchema,
  slotDiscountApplyResultSchema,
  slotDiscountListSchema,
  subscriptionListSchema,
  subscriptionPurchaseResultSchema,
  subscriptionQuoteSchema,
  subscriptionSchema,
  switchQuoteSchema,
} from '@bravo/core';
import { describe, expect, it } from 'vitest';
import { parseFixture } from '../../test/fixtures/parse';
import * as fixtures from './fixtures';

// REC-14, REC-20: the web fixtures obey the contract the API routes are tested against.
describe('receita contract fixtures (AD-035)', () => {
  it.each([
    ['packageOffers', packageOfferListSchema, fixtures.packageOffers],
    ['occurrenceCheck', occurrenceCheckSchema, fixtures.occurrenceCheck],
    ['occurrenceCheckWithConflict', occurrenceCheckSchema, fixtures.occurrenceCheckWithConflict],
    ['subscriptionQuote', subscriptionQuoteSchema, fixtures.subscriptionQuote],
    ['subscriptionActive', subscriptionSchema, fixtures.subscriptionActive],
    ['subscriptionSuspended', subscriptionSchema, fixtures.subscriptionSuspended],
    ['subscriptionAwaiting', subscriptionSchema, fixtures.subscriptionAwaiting],
    ['subscriptionList', subscriptionListSchema, fixtures.subscriptionList],
    [
      'subscriptionPurchaseResult',
      subscriptionPurchaseResultSchema,
      fixtures.subscriptionPurchaseResult,
    ],
    ['ledgerPage', ledgerPageSchema, fixtures.ledgerPage],
    ['ledgerPageWithMore', ledgerPageSchema, fixtures.ledgerPageWithMore],
    ['switchQuote', switchQuoteSchema, fixtures.switchQuote],
    ['cancelPreview', cancelPreviewSchema, fixtures.cancelPreview],
    ['extraHoursSummary', extraHoursSummarySchema, fixtures.extraHoursSummary],
    ['creditsSummary', creditsSummarySchema, fixtures.creditsSummary],
    ['purchaseHistory', purchaseHistoryPageSchema, fixtures.purchaseHistory],
    ['couponList', couponListSchema, fixtures.couponList],
    ['couponUses', couponUseListSchema, fixtures.couponUses],
    ['slotDiscountList', slotDiscountListSchema, fixtures.slotDiscountList],
    ['slotDiscountApplyResult', slotDiscountApplyResultSchema, fixtures.slotDiscountApplyResult],
    ['adminSubscriptionList', adminSubscriptionListSchema, fixtures.adminSubscriptionList],
    ['adjustedPeriod', periodSchema, fixtures.adjustedPeriod],
  ] as const)('%s is accepted by its core schema', (name, schema, fixture) => {
    expect(() => parseFixture(schema, fixture, name)).not.toThrow();
  });

  it('parses the checkout extensions through revenueQuoteSchema as packageOption', () => {
    expect(fixtures.revenueQuoteSufficient.packageOption?.debitMinutes).toBe(78);
    expect(fixtures.revenueQuoteSufficient.packageOption?.sufficient).toBe(true);
    expect(fixtures.revenueQuoteInsufficient.packageOption).toMatchObject({
      sufficient: false,
      reason: 'insufficient',
      debitMinutes: 78,
      packageAvailableMinutes: 40,
    });
    expect(fixtures.buildRevenueQuote().packageOption).toBeNull();
  });

  it('carries the worked examples of the spec', () => {
    const [pacote, meioTurno] = fixtures.packageOffers.items;
    expect(pacote).toMatchObject({ priceCents: 160000, includedMinutes: 1200, avgHourCents: 8000 });
    expect(meioTurno).toMatchObject({
      pricePerOccurrenceCents: 28000,
      estimate: { minCount: 20, maxCount: 22, minCents: 560000, maxCents: 616000 },
    });
    expect(fixtures.ledgerPage.items[0]).toMatchObject({
      minutes: -78,
      detailText: '60 min + 18 min de excedente = 78 min',
    });
    expect(fixtures.subscriptionActive.balance).toMatchObject({
      packageMinutes: 750,
      includedMinutes: 1200,
    });
  });

  it('rejects a fixture that drifts from the contract', () => {
    const broken = { ...fixtures.subscriptionActive, status: 'paused' };
    expect(() => parseFixture(subscriptionSchema, broken, 'broken')).toThrow(
      /Fixture "broken" violates its contract schema/,
    );
  });
});
