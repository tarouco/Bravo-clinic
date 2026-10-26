import { formatBRL, type Cents } from '@bravo/core';
import { cx } from '../ui/cx';

export interface PriceTagProps {
  cents: Cents;
  /** Unit suffix, e.g. "/h" for hourly rates. */
  unit?: string;
  className?: string;
}

/** Money in BRL with an optional muted unit: "R$ 80,00/h". */
export function PriceTag({ cents, unit, className }: PriceTagProps) {
  return (
    <span className={cx('whitespace-nowrap font-semibold text-bronze', className)}>
      {formatBRL(cents)}
      {unit ? <span className="font-normal text-ink-muted">{unit}</span> : null}
    </span>
  );
}
