import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type CardVariant = 'raised' | 'stone' | 'walnut';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Image or band that bleeds edge-to-edge across the top with square corners. */
  media?: ReactNode;
}

const variants: Record<CardVariant, string> = {
  raised: 'bg-surface-raised border border-hairline text-ink',
  stone: 'bg-surface-stone border border-hairline text-ink',
  walnut: 'bg-walnut border border-walnut text-ink-night',
};

export function Card({ variant = 'raised', media, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx('flex flex-col overflow-hidden rounded-card', variants[variant], className)}
      {...rest}
    >
      {media ? <div className="w-full rounded-none">{media}</div> : null}
      <div className="flex-1 p-space-lg">{children}</div>
    </div>
  );
}
