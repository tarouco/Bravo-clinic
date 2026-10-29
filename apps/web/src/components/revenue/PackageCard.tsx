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
import { cx } from '../ui/cx';

export interface PackageCardProps {
  offer: PackageOffer;
  /** The best hour value of the list: the gold card (one colored card per screen). */
  recommended?: boolean;
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
export function PackageCard({ offer, recommended = false }: PackageCardProps) {
  const hourly = `${formatBRL(offer.avgHourCents)}/h`;
  const muted = recommended ? 'text-on-gold' : 'text-ink-muted';
  const price = cx('font-display text-heading', recommended ? 'text-on-gold' : 'text-ink');
  return (
    <Card variant={recommended ? 'gold' : 'raised'} className="h-full">
      <div className="flex h-full flex-col gap-space-sm">
        {recommended ? (
          <span className="font-eyebrow text-eyebrow uppercase text-on-gold">
            Melhor valor por hora
          </span>
        ) : null}
        <h3 className="font-heading-mobile text-heading-mobile">{offer.name}</h3>
        {offer.type === 'hour_package' ? (
          <>
            <p className={price}>{formatBRL(offer.priceCents)}</p>
            <p className={cx('font-small text-small', muted)}>
              {`${formatIncludedHours(offer.includedMinutes)} · ${periodLabel(offer.period)}`}
            </p>
          </>
        ) : (
          <>
            <p className={price}>{`${formatBRL(offer.pricePerOccurrenceCents)} por ocorrência`}</p>
            <p className="font-body text-body">
              {`${formatWeekdayRange(offer.weekdays)} · ${formatWindow(offer.startMinute, offer.endMinute)}`}
            </p>
            <p className={cx('font-small text-small', muted)}>{estimateText(offer)}</p>
            <p className={cx('font-small text-small', muted)}>
              {`Período ${periodLabel(offer.period)}`}
            </p>
          </>
        )}
        <p className={cx('font-small text-small', muted)}>{hourly}</p>
        <Button asChild className="mt-auto self-start">
          <Link to={`/assinar/${offer.id}`}>Assinar</Link>
        </Button>
      </div>
    </Card>
  );
}
