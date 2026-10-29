import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/**
 * `raised` is the pearl card (`bv-card`), `stone` sits on the panel tone, `gold` and `emerald` are
 * the accent cards (one colored card per screen). `walnut` is the v2 name of `emerald` (AD-039).
 */
export type CardVariant = 'raised' | 'stone' | 'gold' | 'emerald' | 'walnut';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Image or band that bleeds edge-to-edge across the top, under the card's rounded corners. */
  media?: ReactNode;
  /** Hangs the card past its panel's edge by `space-12` (`bv-overhang-*`); one per area. */
  overhang?: 'start' | 'end';
}

const variants: Record<CardVariant, string> = {
  raised: 'bv-card',
  stone: 'bv-card bg-surface-panel',
  gold: 'bv-card bv-card--gold',
  emerald: 'bv-card bv-card--emerald',
  walnut: 'bv-card bv-card--emerald',
};

export function Card({
  variant = 'raised',
  media,
  overhang,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        // The kit pads the card itself; here the body does, so the media can bleed to the edges.
        'flex flex-col p-0',
        variants[variant],
        media ? 'overflow-hidden' : null,
        overhang === 'start' && 'bv-overhang-start',
        overhang === 'end' && 'bv-overhang-end',
        className,
      )}
      {...rest}
    >
      {media ? <div className="w-full">{media}</div> : null}
      <div className="flex-1 p-space-lg">{children}</div>
    </div>
  );
}
