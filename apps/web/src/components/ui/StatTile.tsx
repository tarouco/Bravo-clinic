import { formatBRL } from '@bravo/core';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface StatDelta {
  /** Absolute change in cents versus the previous period. */
  cents: number;
  /** Relative change in percent (one decimal); `null` when the previous value was 0. */
  percent: number | null;
}

export interface StatTileProps {
  label: string;
  valueCents: number;
  delta?: StatDelta | undefined;
  /** Name of the period the delta compares with, read after the delta ("vs. 01/05–31/10"). */
  deltaLabel?: string | undefined;
  /** False for figures where an increase is bad (expenses): the delta then uses the error tone. */
  higherIsBetter?: boolean;
  className?: string;
}

const percentFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/** 12.5 -> "+12,5%", -3 -> "-3,0%", null -> "—". */
export function formatDeltaPercent(percent: number | null): string {
  return percent === null ? '—' : `${percentFormat.format(percent)}%`;
}

/** Headline figure with its change versus the previous period (dataviz: stat tile contract). */
export function StatTile({
  label,
  valueCents,
  delta,
  deltaLabel,
  higherIsBetter = true,
  className,
}: StatTileProps) {
  const direction = delta ? Math.sign(delta.cents) : 0;
  const bad = direction !== 0 && direction > 0 !== higherIsBetter;

  return (
    <div
      className={cx('rounded-card border border-hairline bg-surface-raised p-space-md', className)}
    >
      <p className="font-small text-small text-ink-muted">{label}</p>
      <p className="mt-space-xs font-heading text-heading-mobile text-ink md:text-heading">
        {formatBRL(valueCents)}
      </p>
      {delta ? (
        <p
          className={cx(
            'mt-space-xs flex flex-wrap items-center gap-x-space-xs font-caption text-caption',
            bad ? 'text-error' : 'text-ink-muted',
          )}
        >
          {direction !== 0 ? <Icon as={direction > 0 ? ArrowUp : ArrowDown} size={14} /> : null}
          <span className="font-medium">{formatDeltaPercent(delta.percent)}</span>
          {deltaLabel ? <span className="text-ink-muted">{deltaLabel}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
