import type { QuoteStatus } from '@bravo/core';
import { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Popover } from '../../../components/ui/Popover';
import { useQuoteRequests, useUpdateQuoteRequest } from '../../../features/admin-extras/api';
import type { QuoteRequest } from '../../../features/admin-extras/contracts';
import {
  QUOTE_NEXT_STATUSES,
  QUOTE_STATUSES,
  QUOTE_STATUS_LABELS,
} from '../../../features/admin-extras/labels';
import { QuoteDrawer } from '../../../features/admin-extras/QuoteDrawer';
import { ApiError } from '../../../lib/api';
import { messageOf } from '../../../lib/api-errors';
import { formatLocalDateBR } from '../../../lib/format';

const STALE_STATUS_MESSAGE = 'O pedido mudou de status. Atualize a página.';

interface CardProps {
  quote: QuoteRequest;
  onOpen: () => void;
  onMove: (status: QuoteStatus) => void;
  moving: boolean;
}

/** A request card: opens the detail drawer, and moves through a keyboard-reachable menu. */
function QuoteCard({ quote, onOpen, onMove, moving }: CardProps) {
  const next = QUOTE_NEXT_STATUSES[quote.status];
  const moveLabel = `Mover pedido de ${quote.name} para`;

  return (
    <li className="space-y-space-xs rounded-control border border-hairline bg-surface-raised p-space-sm">
      <Button variant="link" className="font-medium" onClick={onOpen}>
        {quote.name}
      </Button>
      <p className="font-small text-small text-ink-muted">{quote.serviceName}</p>
      <p className="font-caption text-caption text-ink-muted">
        {quote.desiredOn ? `Para ${formatLocalDateBR(quote.desiredOn)}` : 'Sem data desejada'}
        {quote.bookingCode ? ` · ${quote.bookingCode}` : ''}
      </p>
      {next.length > 0 ? (
        <Popover
          label={moveLabel}
          trigger={(props) => (
            <Button
              variant="secondary"
              size="sm"
              disabled={moving}
              aria-label={moveLabel}
              {...props}
            >
              Mover para
            </Button>
          )}
        >
          <ul className="flex flex-col gap-space-xs">
            {next.map((status) => (
              <li key={status}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onMove(status);
                  }}
                >
                  {QUOTE_STATUS_LABELS[status]}
                </Button>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </li>
  );
}

/** Pedidos tab: the quote funnel, five columns with a "Mover para" menu (GES-95, GES-96). */
export function QuotesTab() {
  const quotes = useQuoteRequests();
  const update = useUpdateQuoteRequest();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = quotes.data?.pages.flatMap((page) => page.items) ?? [];
  const opened = all.find((q) => q.id === openId) ?? null;

  const move = (quote: QuoteRequest, status: QuoteStatus) => {
    setError(null);
    update.mutate(
      { id: quote.id, body: { status } },
      {
        onError: (failure) => {
          setError(
            failure instanceof ApiError && failure.status === 409
              ? STALE_STATUS_MESSAGE
              : messageOf(failure, 'Não foi possível mover o pedido.'),
          );
        },
      },
    );
  };

  return (
    <div className="space-y-space-md">
      {quotes.isPending ? <Spinner label="Carregando os pedidos" /> : null}
      {quotes.isError ? (
        <Alert tone="error">
          <p>{messageOf(quotes.error, 'Não foi possível carregar os pedidos.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void quotes.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {quotes.data ? (
        <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-space-md overflow-x-auto pb-space-sm">
          {QUOTE_STATUSES.map((status) => {
            const items = all.filter((q) => q.status === status);
            return (
              <section
                key={status}
                aria-label={`${QUOTE_STATUS_LABELS[status]} (${String(items.length)})`}
                className="space-y-space-sm rounded-card bg-surface-stone p-space-sm"
              >
                <h2 className="flex items-center justify-between font-small text-small font-medium text-ink">
                  {QUOTE_STATUS_LABELS[status]}
                  <Badge tone="neutral">{items.length}</Badge>
                </h2>
                {items.length === 0 ? (
                  <p className="font-caption text-caption text-ink-muted">Nenhum pedido</p>
                ) : (
                  <ul className="space-y-space-sm">
                    {items.map((quote) => (
                      <QuoteCard
                        key={quote.id}
                        quote={quote}
                        moving={update.isPending}
                        onOpen={() => {
                          setOpenId(quote.id);
                        }}
                        onMove={(next) => {
                          move(quote, next);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
      {quotes.hasNextPage ? (
        <Button
          variant="secondary"
          loading={quotes.isFetchingNextPage}
          onClick={() => {
            void quotes.fetchNextPage();
          }}
        >
          Carregar mais
        </Button>
      ) : null}

      {opened ? (
        <QuoteDrawer
          key={opened.id}
          quote={opened}
          onClose={() => {
            setOpenId(null);
          }}
        />
      ) : null}
    </div>
  );
}
