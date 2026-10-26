import type { CreditsSummary, ExtraHoursSummary, Period } from '@bravo/core';

// Receita web types are the `z.infer` types of the core contract schemas (AD-035): the lanes share
// one contract, so they are re-exported rather than redeclared.
export type {
  AdminSubscriptionRow,
  CancelPreview,
  CompensationPreview,
  Coupon,
  CouponInput,
  CouponRejectionReason,
  CouponUse,
  CreditsSummary,
  ExtraHoursPurchaseInput,
  ExtraHoursPurchaseResult,
  ExtraHoursSummary,
  LedgerEntry,
  LedgerPage,
  OccurrenceCheck,
  OccurrenceConflict,
  PackageOffer,
  PackageOption,
  Period,
  PurchaseHistoryItem,
  RevenueQuote,
  SlotDiscount,
  SlotDiscountApplyResult,
  SlotDiscountInput,
  Subscription,
  SubscriptionPurchaseResult,
  SubscriptionQuote,
  SwitchQuote,
} from '@bravo/core';

/** One credit lot of `GET /app/credits`. */
export type CreditLot = CreditsSummary['lots'][number];
/** One line of the credit ledger of `GET /app/credits`. */
export type CreditLedgerLine = CreditsSummary['ledger'][number];
/** One extra-minute lot of `GET /app/extra-hours`. */
export type ExtraLot = ExtraHoursSummary['lots'][number];

/** `POST /admin/subscriptions/:id/adjust-balance` answers the adjusted period (design.md). */
export interface AdjustBalanceResult {
  period: Period;
}
/** `POST /admin/customers/:userId/credits` answers the created lot (design.md). */
export interface GrantCreditResult {
  lot: CreditLot;
}
