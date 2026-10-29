import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * The name in type (DESIGN-v3.md Logo): BRAVÔ in display 300 with wide tracking, CLINIC smaller
 * and wider, and optionally — SALAS INTELIGENTES — between two rules. Never a cropped logo image.
 * `header` sits on pearl (ink); `footer` sits on the emerald band (on-emerald and gold) and shows
 * the tagline unless `tagline` says otherwise.
 */
export function BrandLockup({
  variant = 'header',
  tagline,
  className,
}: {
  variant?: 'header' | 'footer';
  tagline?: boolean;
  className?: string;
}) {
  const onBand = variant === 'footer';
  const showTagline = tagline ?? onBand;
  return (
    <span className={cx('inline-flex flex-col items-start leading-none', className)}>
      <span
        className={cx(
          'font-display font-light uppercase tracking-[0.16em]',
          onBand
            ? 'text-[26px] leading-[30px] text-on-emerald'
            : 'text-[18px] leading-[22px] text-ink',
        )}
      >
        Bravô
      </span>{' '}
      <span
        className={cx(
          'font-display uppercase',
          onBand
            ? 'mt-1 text-[11px] leading-[14px] tracking-[0.62em] text-on-emerald/80'
            : 'text-[9px] leading-[12px] tracking-[0.62em] text-ink-muted',
        )}
      >
        Clinic
      </span>
      {showTagline ? (
        <>
          {' '}
          <EyebrowLockup onBand={onBand} className="mt-space-sm" />
        </>
      ) : null}
    </span>
  );
}

/** Small uppercase section label in the accent color (emerald by day, gold by night). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('block font-eyebrow text-eyebrow uppercase text-accent', className)}>
      {children}
    </span>
  );
}

/** Signature device: eyebrow text flanked by thin rules (default "Salas inteligentes"). */
export function EyebrowLockup({
  children = 'Salas inteligentes',
  onBand = false,
  className,
}: {
  children?: ReactNode;
  /** On the emerald band: gold text and rules. */
  onBand?: boolean;
  className?: string;
}) {
  const rule = cx('block h-px w-6', onBand ? 'bg-gold/50' : 'bg-hairline');
  return (
    <div className={cx('flex items-center justify-center gap-space-sm', className)}>
      <span aria-hidden="true" className={rule} />
      <span
        className={cx(
          'font-eyebrow text-eyebrow uppercase',
          onBand ? 'text-gold' : 'text-ink-muted',
        )}
      >
        {children}
      </span>
      <span aria-hidden="true" className={rule} />
    </div>
  );
}
