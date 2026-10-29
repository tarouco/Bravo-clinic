import { utcToLocal } from '@bravo/core';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { QUOTE_STATUS_LABELS } from '../../features/admin-extras/labels';
import { useMyQuoteRequests } from '../../features/extras/api';
import { formatLocalDateBR } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';

/** "2026-10-25T14:00:00Z" -> "25/10/2026" (São Paulo date). */
function sentOn(createdAt: string): string {
  return formatLocalDateBR(utcToLocal(new Date(createdAt)).date);
}

/** `/app/orcamentos`: the signed-in tenant's own quote requests with their status (GES-97). */
export function QuotesPage() {
  usePageTitle('Orçamentos');
  const quotes = useMyQuoteRequests();
  const items = quotes.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
          Orçamentos
        </h1>
        <Button asChild variant="secondary" size="sm">
          <Link to="/servicos-extras">Novo pedido</Link>
        </Button>
      </div>

      {quotes.isPending ? <Spinner label="Carregando orçamentos" /> : null}
      {quotes.isError ? (
        <Alert tone="error">Não foi possível carregar seus orçamentos agora.</Alert>
      ) : null}
      {quotes.isSuccess && items.length === 0 ? (
        <Alert>Você ainda não pediu nenhum orçamento.</Alert>
      ) : null}

      <ul className="space-y-space-md">
        {items.map((quote) => (
          <li
            key={quote.id}
            className="space-y-space-xs rounded-md bg-surface-raised p-space-lg shadow-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-space-sm">
              <h2 className="font-heading-mobile text-body text-ink">{quote.serviceName}</h2>
              <Badge tone="gold">{QUOTE_STATUS_LABELS[quote.status]}</Badge>
            </div>
            <p className="font-small text-small text-ink-muted">{quote.description}</p>
            <p className="font-caption text-caption text-ink-muted">
              Enviado em {sentOn(quote.createdAt)}
              {quote.desiredOn ? ` · Data desejada: ${formatLocalDateBR(quote.desiredOn)}` : ''}
              {quote.bookingCode ? ` · Reserva ${quote.bookingCode}` : ''}
            </p>
          </li>
        ))}
      </ul>

      {quotes.hasNextPage ? (
        <Button
          variant="secondary"
          loading={quotes.isFetchingNextPage}
          onClick={() => void quotes.fetchNextPage()}
        >
          Ver mais
        </Button>
      ) : null}
    </div>
  );
}
