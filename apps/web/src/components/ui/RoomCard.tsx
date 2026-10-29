import { formatBRL } from '@bravo/core';
import { CircleCheck, type LucideIcon } from 'lucide-react';
import { photoSrcSet } from '../../lib/room-photo';
import { Badge } from './Badge';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';

export const ROOM_PLACEHOLDER_SRC = '/room-placeholder.webp';

/** Pearl glass pill over the photo (name, feature). */
const photoChip =
  'absolute flex items-center rounded-pill bg-surface-raised/90 px-3 py-1 font-caption text-caption text-ink shadow-lift-1 backdrop-blur-glass';

export interface RoomCardProps {
  name: string;
  /** Cover photo; falls back to the placeholder asset. */
  imageUrl?: string | undefined;
  imageAlt?: string | undefined;
  /** Chip at the top right of the cover, e.g. "Filmagem & Estúdio". */
  featureChip?: { label: string; icon?: LucideIcon } | undefined;
  tags: string[];
  description: string;
  equipment: string[];
  /** Lowest hourly rate, in integer cents; null when no hourly category is active. */
  fromPriceCents: number | null;
  onReserve: () => void;
  /** Photo-led card: taller cover, no description or equipment list (home showcase). */
  compact?: boolean;
  /** First card above the fold: fetch the cover early; every other cover loads lazily. */
  priority?: boolean;
}

export function RoomCard({
  name,
  imageUrl,
  imageAlt,
  featureChip,
  tags,
  description,
  equipment,
  fromPriceCents,
  onReserve,
  compact = false,
  priority = false,
}: RoomCardProps) {
  const src = imageUrl ?? ROOM_PLACEHOLDER_SRC;
  return (
    <article className="flex flex-col overflow-hidden rounded-lg bg-surface-raised text-ink shadow-card transition-transform duration-300 hover:-translate-y-1">
      <div className={`relative w-full ${compact ? 'aspect-[4/3]' : 'h-64'}`}>
        <img
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
          srcSet={photoSrcSet(src)}
          sizes="(min-width: 1024px) 33vw, 100vw"
          alt={imageAlt ?? `Foto da ${name}`}
          {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
        />
        <div className={cx('left-3 top-3', photoChip)}>{name}</div>
        {/* The price tag is the gold accent of the card, floating over the photo (DESIGN-v3.md). */}
        {fromPriceCents === null ? null : (
          <div className="absolute right-3 top-3 flex items-baseline gap-1 rounded-pill bg-grad-gold px-3 py-1.5 text-on-gold shadow-lift-1">
            <span className="font-caption text-caption">A partir de</span>
            <span className="font-display text-small font-semibold">
              {formatBRL(fromPriceCents)}
              <span className="font-body text-caption font-normal">/h</span>
            </span>
          </div>
        )}
        {featureChip ? (
          <div className={cx('bottom-3 left-3 gap-1', photoChip)}>
            {featureChip.icon ? (
              <Icon as={featureChip.icon} size={14} className="text-accent" />
            ) : null}
            <span>{featureChip.label}</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-space-md p-space-lg">
        <div>
          <div className="mb-space-sm flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
          </div>
          <h3 className="mb-space-xs font-heading text-heading-mobile text-ink md:text-heading">
            {name}
          </h3>
          {compact ? null : (
            <>
              <p className="font-small text-small text-ink-muted">{description}</p>
              <ul className="mt-space-md space-y-space-xs font-small text-small text-ink-muted">
                {equipment.map((item) => (
                  <li key={item} className="flex items-center gap-space-xs">
                    <Icon as={CircleCheck} size={16} className="shrink-0 text-accent" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-space-md border-t border-hairline pt-space-md">
          {fromPriceCents === null ? (
            <span className="font-small text-small text-ink-muted">Consulte os valores</span>
          ) : null}
          <Button size="sm" className="ml-auto" onClick={onReserve}>
            Reservar Sala
          </Button>
        </div>
      </div>
    </article>
  );
}
