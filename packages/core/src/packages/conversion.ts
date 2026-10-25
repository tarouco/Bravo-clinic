import { mulDivRoundHalfUp } from '../money';
import type { PackageRate } from './debit';

/**
 * Remaining minutes carried to a new package (docs/architecture.md section 7.9, REC-71):
 * remaining × V_pac_old / V_pac_new = remaining × fromPrice × toIncluded / (fromIncluded × toPrice),
 * rounded half up to the minute. 360 min on 160000/1200 → 225000/1800 = 384.
 */
export function convertPackageBalance(args: {
  remainingMinutes: number;
  from: PackageRate;
  to: PackageRate;
}): number {
  const { remainingMinutes, from, to } = args;
  return mulDivRoundHalfUp(
    remainingMinutes * from.priceCents,
    to.includedMinutes,
    from.includedMinutes * to.priceCents,
  );
}
