import type { HTMLAttributes } from 'react';
import { cx } from './cx';

/** v2 tone names stay (AD-039): `champagne` is gold, `bronze` is emerald, `error` is danger. */
export type BadgeTone =
  'champagne' | 'gold' | 'neutral' | 'bronze' | 'emerald' | 'error' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  champagne: 'bg-gold text-on-gold',
  gold: 'bg-gold text-on-gold',
  neutral: 'bg-surface-deboss text-ink-muted',
  bronze: 'bg-emerald text-on-emerald',
  emerald: 'bg-emerald text-on-emerald',
  error: 'bg-danger-soft text-danger',
  danger: 'bg-danger-soft text-danger',
};

/** Mini pill with a sentence-case caption (status, tags). */
export function Badge({ tone = 'champagne', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-pill px-2.5 py-0.5 font-caption text-caption font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
