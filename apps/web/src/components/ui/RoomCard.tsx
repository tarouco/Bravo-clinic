import { formatBRL } from '@bravo/core';
import { CircleCheck, type LucideIcon } from 'lucide-react';
import { Badge } from './Badge';
import { Button } from './Button';
import { Icon } from './Icon';

export const ROOM_PLACEHOLDER_SRC = '/room-placeholder.webp';

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
}: RoomCardProps) {
  return (
    <article className="flex flex-col overflow-hidden rounded-xl bg-surface-raised shadow-lg transition-transform duration-300 hover:-translate-y-1">
      <div className={`relative w-full ${compact ? 'aspect-[4/3]' : 'h-64'}`}>
        <img
          className="absolute inset-0 h-full w-full object-cover"
          src={imageUrl ?? ROOM_PLACEHOLDER_SRC}
          alt={imageAlt ?? `Foto da ${name}`}
        />
        <div className="absolute left-3 top-3 rounded bg-bronze px-space-sm py-1 font-eyebrow text-caption font-semibold uppercase tracking-wider text-on-bronze shadow-sm">
          {name}
        </div>
        {featureChip ? (
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded bg-surface-raised/95 px-space-sm py-1 font-caption text-caption text-walnut shadow-sm backdrop-blur-md">
            {featureChip.icon ? (
              <Icon as={featureChip.icon} size={14} className="text-bronze" />
            ) : null}
            <span>{featureChip.label}</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col justify-between space-y-space-md p-space-lg">
        <div>
          <div className="mb-space-sm flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
          <h3 className="mb-space-xs font-heading text-heading text-ink">{name}</h3>
          {compact ? null : (
            <>
              <p className="font-small text-small text-ink-muted">{description}</p>
              <ul className="mt-space-md space-y-space-xs font-small text-small text-ink-muted">
                {equipment.map((item) => (
                  <li key={item} className="flex items-center gap-space-xs">
                    <Icon as={CircleCheck} size={16} className="shrink-0 text-bronze" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="-mx-space-lg -mb-space-lg mt-space-md flex items-center justify-between bg-surface-container-low p-space-lg">
          {fromPriceCents === null ? (
            <span className="font-small text-small text-ink-muted">Consulte os valores</span>
          ) : (
            <div>
              <span className="block font-caption text-caption uppercase tracking-wider text-ink-muted">
                A partir de
              </span>
              <span className="font-display text-heading font-semibold text-bronze">
                {formatBRL(fromPriceCents)}
                <span className="font-body text-small font-normal text-ink-muted">/h</span>
              </span>
            </div>
          )}
          <Button size="sm" onClick={onReserve}>
            Reservar Sala
          </Button>
        </div>
      </div>
    </article>
  );
}
