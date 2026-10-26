import type { BookingSummary } from '@bravo/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Tabs } from '../../components/ui/Tabs';
import { useMyBookings, type BookingTab } from '../../features/booking/api';
import { BookingRow } from '../../features/booking/BookingRow';
import { usePageTitle } from '../../lib/usePageTitle';

/** Rows with the same `group.id` sit under one header; the others stay in order. */
export function groupBookings(
  items: readonly BookingSummary[],
): { key: string; label: string | null; items: BookingSummary[] }[] {
  const groups: { key: string; label: string | null; items: BookingSummary[] }[] = [];
  for (const booking of items) {
    const last = groups[groups.length - 1];
    const existing = booking.group ? groups.find((g) => g.key === booking.group?.id) : undefined;
    if (existing) existing.items.push(booking);
    else if (!booking.group && last?.key === 'ungrouped') last.items.push(booking);
    else {
      groups.push({
        key: booking.group?.id ?? 'ungrouped',
        label: booking.group?.label ?? null,
        items: [booking],
      });
    }
  }
  return groups;
}

const EMPTY_TEXT: Record<BookingTab, string> = {
  upcoming: 'Você não tem reservas próximas.',
  past: 'Você ainda não tem reservas passadas.',
  cancelled: 'Você não tem reservas canceladas.',
};

function BookingTabList({ tab }: { tab: BookingTab }) {
  const query = useMyBookings(tab);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isPending) return <Spinner label="Carregando reservas" />;
  if (query.isError) {
    return <Alert tone="error">Não foi possível carregar suas reservas agora.</Alert>;
  }
  if (items.length === 0) {
    return (
      <div className="space-y-space-md">
        <p className="font-body text-body text-ink-muted">{EMPTY_TEXT[tab]}</p>
        {tab === 'upcoming' ? (
          <Button asChild>
            <Link to="/app/reservar">Reservar uma sala</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-space-lg">
      {groupBookings(items).map((group, index) => (
        <section key={`${group.key}-${String(index)}`} className="space-y-space-sm">
          {group.label ? (
            <h3 className="font-heading-mobile text-body text-ink">{group.label}</h3>
          ) : null}
          <ul className="space-y-space-sm">
            {group.items.map((booking) => (
              <BookingRow key={booking.id} booking={booking} />
            ))}
          </ul>
        </section>
      ))}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}

const TAB_LABELS: Record<BookingTab, string> = {
  upcoming: 'Próximas',
  past: 'Passadas',
  cancelled: 'Canceladas',
};
const TABS: BookingTab[] = ['upcoming', 'past', 'cancelled'];

/** `/app/minhas-reservas`: Próximas, Passadas and Canceladas (NUC-189). */
export function MyBookingsPage() {
  usePageTitle('Minhas reservas');
  const [tab, setTab] = useState<BookingTab>('upcoming');

  return (
    <div className="mx-auto max-w-3xl space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="font-heading text-heading-mobile text-ink md:text-heading">
          Minhas reservas
        </h1>
        <Button asChild size="sm">
          <Link to="/app/reservar">Reservar</Link>
        </Button>
      </div>
      <Tabs
        label="Reservas"
        value={tab}
        onValueChange={(id) => {
          setTab(id as BookingTab);
        }}
        items={TABS.map((id) => ({
          id,
          label: TAB_LABELS[id],
          // Only the open tab loads, so each tab fetches its own `tab` parameter on demand.
          content: id === tab ? <BookingTabList tab={id} /> : null,
        }))}
      />
    </div>
  );
}
