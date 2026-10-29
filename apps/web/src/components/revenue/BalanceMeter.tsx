import { formatBalance } from '../../features/purchases/format';

export interface BalanceMeterProps {
  /** Minutes left in the active period. */
  packageMinutes: number;
  /** Minutes the period granted. */
  includedMinutes: number;
  /** Minutes left in extra lots (bought, compensation, manual). */
  extraMinutes?: number;
}

/**
 * Package balance "12h 30min de 20h" over a sunken track with the emerald fill (like the Slider),
 * as an accessible meter, and the extra-minutes line (REC-143).
 */
export function BalanceMeter({
  packageMinutes,
  includedMinutes,
  extraMinutes = 0,
}: BalanceMeterProps) {
  const value = Math.min(Math.max(packageMinutes, 0), includedMinutes);
  const text = `${formatBalance(packageMinutes)} de ${formatBalance(includedMinutes)}`;
  const percent = includedMinutes > 0 ? (value / includedMinutes) * 100 : 0;
  return (
    <div className="space-y-space-xs">
      <p className="font-small text-small text-ink">{text}</p>
      <div
        role="meter"
        aria-label="Saldo do pacote"
        aria-valuemin={0}
        aria-valuemax={includedMinutes}
        aria-valuenow={value}
        aria-valuetext={text}
        className="h-2 w-full overflow-hidden rounded-pill bg-surface-deboss shadow-deboss"
      >
        <div
          className="h-full rounded-pill bg-grad-emerald"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      {extraMinutes > 0 ? (
        <p className="font-small text-small text-ink-muted">
          {`Horas extras: ${formatBalance(extraMinutes)}`}
        </p>
      ) : null}
    </div>
  );
}
