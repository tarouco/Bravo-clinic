import { formatBRL } from '@bravo/core';
import { Link } from 'react-router-dom';
import {
  formatIncludedHours,
  formatWeekdayRange,
  formatWindow,
  periodLabel,
} from '../../features/purchases/format';
import type { PackageOffer } from '../../features/purchases/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export interface PackageCardProps {
  offer: PackageOffer;
}

/** Fixed-schedule estimate: "20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00" (one value when equal). */
function estimateText(offer: Extract<PackageOffer, { type: 'fixed_schedule' }>): string {
  const { minCount, maxCount, minCents, maxCents } = offer.estimate;
  const count =
    minCount === maxCount ? String(minCount) : `${String(minCount)}–${String(maxCount)}`;
  const price =
    minCents === maxCents ? formatBRL(minCents) : `${formatBRL(minCents)} – ${formatBRL(maxCents)}`;
  return `${count} ocorrências · ${price}`;
}

/** Offer of `/precos`: name, period, price, average hour value and the "Assinar" link (REC-155). */
export function PackageCard({ offer }: PackageCardProps) {
  const hourly = `${formatBRL(offer.avgHourCents)}/h`;
  return (
    <Card className="h-full">
      <div className="flex h-full flex-col gap-space-md">
        <h3 className="font-h3 text-h3 text-ink">{offer.name}</h3>
        {offer.type === 'hour_package' ? (
          <>
            <p className="font-h2 text-h2 font-semibold text-bronze">
              {formatBRL(offer.priceCents)}
            </p>
            <p className="font-small text-small text-ink-muted">
              {`${formatIncludedHours(offer.includedMinutes)} · ${periodLabel(offer.period)}`}
            </p>
          </>
        ) : (
          <>
            <p className="font-h2 text-h2 font-semibold text-bronze">
              {`${formatBRL(offer.pricePerOccurrenceCents)} por ocorrência`}
            </p>
            <p className="font-body text-body text-ink">
              {`${formatWeekdayRange(offer.weekdays)} · ${formatWindow(offer.startMinute, offer.endMinute)}`}
            </p>
            <p className="font-small text-small text-ink-muted">{estimateText(offer)}</p>
            <p className="font-small text-small text-ink-muted">
              {`Período ${periodLabel(offer.period)}`}
            </p>
          </>
        )}
        <p className="font-small text-small text-ink-muted">{hourly}</p>
        <Button asChild className="mt-auto self-start">
          <Link to={`/assinar/${offer.id}`}>Assinar</Link>
        </Button>
      </div>
    </Card>
  );
}
