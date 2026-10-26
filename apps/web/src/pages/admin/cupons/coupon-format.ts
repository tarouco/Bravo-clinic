import { addDays, formatBRL, utcToLocal } from '@bravo/core';
import { formatLocalDateBR } from '../../../lib/format';
import type { Coupon } from '../../../features/purchases/types';

// pt-BR texts of the Cupons table (REC-128). Validity is the half-open range
// `[validFrom, validUntil)`, so the last valid day is the day before `validUntil` at 00:00.

/** 1000 basis points -> "10%", 1250 -> "12,5%"; a fixed discount in cents -> "R$ 20,00". */
export function couponDiscountText(coupon: Pick<Coupon, 'discountKind' | 'discountValue'>): string {
  if (coupon.discountKind === 'fixed') return formatBRL(coupon.discountValue);
  const percent = (coupon.discountValue / 100).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  });
  return `${percent}%`;
}

/** "3/∞" without a limit, "3/10" with one. */
export function couponUsesText(coupon: Pick<Coupon, 'usesCount' | 'maxUses'>): string {
  return `${String(coupon.usesCount)}/${coupon.maxUses === null ? '∞' : String(coupon.maxUses)}`;
}

/** First valid day of a coupon (`validFrom` in São Paulo time), or null. */
export function firstValidDay(coupon: Pick<Coupon, 'validFrom'>): string | null {
  return coupon.validFrom ? utcToLocal(new Date(coupon.validFrom)).date : null;
}

/** Last valid day (inclusive): the exclusive `validUntil` midnight minus one day, or null. */
export function lastValidDay(coupon: Pick<Coupon, 'validUntil'>): string | null {
  if (!coupon.validUntil) return null;
  const local = utcToLocal(new Date(coupon.validUntil));
  return local.minuteOfDay === 0 ? addDays(local.date, -1) : local.date;
}

/** "—" without limits, "01/11/2026–30/11/2026", "a partir de 01/11/2026" or "até 30/11/2026". */
export function couponValidityText(coupon: Pick<Coupon, 'validFrom' | 'validUntil'>): string {
  const from = firstValidDay(coupon);
  const until = lastValidDay(coupon);
  if (from && until) return `${formatLocalDateBR(from)}–${formatLocalDateBR(until)}`;
  if (from) return `a partir de ${formatLocalDateBR(from)}`;
  if (until) return `até ${formatLocalDateBR(until)}`;
  return '—';
}

export const COUPON_TYPE_LABELS = {
  first_booking: 'Primeira reserva',
  discount: 'Desconto',
} as const satisfies Record<Coupon['type'], string>;
