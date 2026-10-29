import { PackageCard } from '../../components/revenue/PackageCard';
import { usePackages } from './api';
import type { PackageOffer } from './types';

function OfferGroup({
  title,
  offers,
  recommendedId,
}: {
  title: string;
  offers: PackageOffer[];
  recommendedId: string | null;
}) {
  if (offers.length === 0) return null;
  return (
    <div className="space-y-space-sm">
      <h3 className="font-heading-mobile text-heading-mobile text-ink">{title}</h3>
      <div className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-3">
        {offers.map((offer) => (
          <PackageCard key={offer.id} offer={offer} recommended={offer.id === recommendedId} />
        ))}
      </div>
    </div>
  );
}

/** The offer with the lowest average hour value, when there is a choice to make. */
function bestHourValue(items: readonly PackageOffer[]): string | null {
  if (items.length < 2) return null;
  const best = items.reduce((low, offer) => (offer.avgHourCents < low.avgHourCents ? offer : low));
  return best.id;
}

function PackagesSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando pacotes"
      className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-3"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-56 animate-pulse rounded-lg bg-surface-deboss shadow-deboss"
        />
      ))}
    </div>
  );
}

/**
 * Slot `pricing.packages` of `/precos`: active public packages in two groups, "Pacotes de horas"
 * and "Horário fixo" (REC-155). Hidden when there is nothing to offer or the offers fail to load,
 * because the avulsas tables above stand on their own.
 */
export function PackagesSection() {
  const { data, isPending } = usePackages();

  if (isPending) {
    return (
      <section aria-label="Pacotes e assinaturas" className="space-y-space-sm">
        <PackagesSkeleton />
      </section>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const recommendedId = bestHourValue(items);

  return (
    <section aria-labelledby="packages-title" className="space-y-space-lg">
      <div className="space-y-space-xs">
        <h2 id="packages-title" className="font-heading-mobile text-heading-mobile text-ink">
          Pacotes e assinaturas
        </h2>
        <p className="font-small text-small text-ink-muted">
          Os pacotes renovam automaticamente a cada período; você acompanha tudo em Compras.
        </p>
      </div>
      <OfferGroup
        title="Pacotes de horas"
        offers={items.filter((o) => o.type === 'hour_package')}
        recommendedId={recommendedId}
      />
      <OfferGroup
        title="Horário fixo"
        offers={items.filter((o) => o.type === 'fixed_schedule')}
        recommendedId={recommendedId}
      />
    </section>
  );
}
