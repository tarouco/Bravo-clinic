import { ceilDiv, formatBRL, type Quote } from '@bravo/core';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/form';
import { Icon } from '../../components/ui/Icon';
import { formatServicePrice } from '../admin-extras/labels';
import { usePublicExtraServices } from './api';
import type { PublicExtraService } from './contracts';

/** One add-on line of `addons.extras` (the web-assumed checkout contract, GES-88). */
export interface ExtraAddonLine {
  serviceId: string;
  quantity: number;
}

export interface ExtrasAddonPickerProps {
  /** The current quote; its duration bounds the hourly quantities. */
  draft: Quote;
  /** Receives the whole `addons` object: `{ extras: [...] }`, or `{}` when nothing is picked. */
  onChange: (addons: Record<string, unknown>) => void;
}

/** Highest quantity of a service for the booking (GES-89): ceil(minutes / 60) per hour, else 1. */
export function maxQuantity(service: PublicExtraService, durationMinutes: number): number {
  return service.unit === 'hour' ? Math.max(1, ceilDiv(durationMinutes, 60)) : 1;
}

/**
 * Slot `checkout.summary.extras`: online-sold extra services added to the booking (GES-88). The
 * API prices each line at its frozen unit price; the totals shown here are only a preview of
 * `unit price × quantity`, the quote lines remain the source of truth.
 */
export function ExtrasAddonPicker({ draft, onChange }: ExtrasAddonPickerProps) {
  const services = usePublicExtraServices();
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const online = (services.data?.items ?? []).filter((service) => service.saleMode === 'online');
  if (online.length === 0) return null;

  const emit = (next: Record<string, number>) => {
    setQuantities(next);
    const extras: ExtraAddonLine[] = online
      .filter((service) => (next[service.id] ?? 0) > 0)
      .map((service) => ({ serviceId: service.id, quantity: next[service.id] ?? 0 }));
    onChange(extras.length > 0 ? { extras } : {});
  };

  const setQuantity = (service: PublicExtraService, quantity: number) => {
    const bounded = Math.min(Math.max(quantity, 0), maxQuantity(service, draft.durationMinutes));
    emit({ ...quantities, [service.id]: bounded });
  };

  return (
    <section aria-label="Serviços extras" className="space-y-space-sm">
      <h3 className="font-heading-mobile text-heading-mobile text-ink">Serviços extras</h3>
      <ul className="space-y-space-sm">
        {online.map((service) => {
          const max = maxQuantity(service, draft.durationMinutes);
          const quantity = Math.min(quantities[service.id] ?? 0, max);
          const unitCents = service.referencePriceCents ?? 0;
          return (
            <li
              key={service.id}
              className="flex flex-wrap items-center justify-between gap-space-sm rounded-card border border-hairline bg-surface-raised p-space-md"
            >
              <div>
                <p className="font-body text-body text-ink">{service.name}</p>
                <p className="font-small text-small text-ink-muted">
                  {formatServicePrice(service.referencePriceCents, service.unit)}
                </p>
              </div>
              {service.unit === 'hour' ? (
                <div className="flex items-center gap-space-sm">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Diminuir horas de ${service.name}`}
                    disabled={quantity <= 0}
                    onClick={() => {
                      setQuantity(service, quantity - 1);
                    }}
                  >
                    <Icon as={Minus} size={16} />
                  </Button>
                  <span
                    role="status"
                    aria-label={`Horas de ${service.name}`}
                    className="min-w-[2ch] text-center font-body text-body text-ink"
                  >
                    {quantity}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Aumentar horas de ${service.name}`}
                    disabled={quantity >= max}
                    onClick={() => {
                      setQuantity(service, quantity + 1);
                    }}
                  >
                    <Icon as={Plus} size={16} />
                  </Button>
                </div>
              ) : (
                <Checkbox
                  label={`Adicionar ${service.name}`}
                  checked={quantity === 1}
                  onChange={(event) => {
                    setQuantity(service, event.target.checked ? 1 : 0);
                  }}
                />
              )}
              {quantity > 0 ? (
                <p className="w-full text-right font-small text-small text-ink">
                  {`${service.name}: ${formatBRL(unitCents * quantity)}`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
