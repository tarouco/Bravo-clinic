import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export type BadgeTone = 'champagne' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  champagne: 'bg-champagne-soft text-on-champagne',
  neutral: 'bg-surface-stone text-ink-muted',
};

/** Mini chip: uppercase caption with .08em tracking (DESIGN.md status badges). */
export function Badge({ tone = 'champagne', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-control px-space-sm py-0.5 font-caption text-caption uppercase tracking-[0.08em]',
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
