import {
  addDays,
  diffDays,
  formatBRL,
  periodBounds,
  settingsCatalog,
  type LocalDate,
} from '@bravo/core';
import { formatLocalDateBR } from '../../lib/format';
import type { OccurrenceCheck, PackageOffer, SubscriptionQuote } from './types';

/** Numbers the subscription summary shows (REC-158), from the server quote or a local estimate. */
export type SummaryValues = Pick<
  SubscriptionQuote,
  | 'startsOn'
  | 'endsOn'
  | 'renewsOn'
  | 'chargeDueOn'
  | 'priceCents'
  | 'discountCents'
  | 'creditAvailableCents'
  | 'creditAppliedCents'
  | 'payNowCents'
>;

/** `payment.subscription_renewal_days_before` default, used before login when no quote exists. */
const DEFAULT_RENEWAL_DAYS = settingsCatalog['payment.subscription_renewal_days_before'].default;

/**
 * Summary of a visitor who is not logged in yet: the quote endpoint needs a session, so the
 * period dates and the price come from the public offer (and, for fixed schedules, from the
 * occurrence check). Coupon and credits apply after login.
 */
export function localSummary(
  offer: PackageOffer,
  baseOn: string,
  check: OccurrenceCheck | undefined,
): SummaryValues | null {
  const priceCents = offer.type === 'hour_package' ? offer.priceCents : check?.periodPriceCents;
  if (priceCents === undefined) return null;
  const { startsOn, endsOn } = periodBounds(baseOn as LocalDate, offer.periodDays);
  return {
    startsOn,
    endsOn,
    renewsOn: endsOn,
    chargeDueOn: addDays(endsOn, -DEFAULT_RENEWAL_DAYS),
    priceCents,
    discountCents: 0,
    creditAvailableCents: 0,
    creditAppliedCents: 0,
    payNowCents: priceCents,
  };
}

/** "R$ 1.600,00" for an hour package; the estimated range for a fixed schedule (it varies by month). */
export function renewalPriceText(offer: PackageOffer): string {
  if (offer.type === 'hour_package') return formatBRL(offer.priceCents);
  const { minCents, maxCents } = offer.estimate;
  return minCents === maxCents
    ? formatBRL(minCents)
    : `${formatBRL(minCents)} – ${formatBRL(maxCents)}`;
}

/** REC-158: "Renova automaticamente em 02/12/2026 por R$ 1.600,00 (cobrança 2 dias antes)". */
export function renewalSentence(offer: PackageOffer, values: SummaryValues): string {
  const days = diffDays(values.chargeDueOn, values.renewsOn);
  const unit = days === 1 ? 'dia' : 'dias';
  return `Renova automaticamente em ${formatLocalDateBR(values.renewsOn)} por ${renewalPriceText(offer)} (cobrança ${String(days)} ${unit} antes)`;
}

/** The period as shown to people: the end date is the last day, not the exclusive bound. */
export function periodText(values: Pick<SummaryValues, 'startsOn' | 'endsOn'>): string {
  const last = addDays(values.endsOn, -1);
  return `${formatLocalDateBR(values.startsOn)} a ${formatLocalDateBR(last)}`;
}
