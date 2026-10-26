import { LedgerTable } from '../../components/revenue/LedgerTable';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useLedger } from './api';
import type { Subscription } from './types';

export interface LedgerSectionProps {
  subscription: Pick<Subscription, 'id' | 'category'>;
  onClose: () => void;
}

/** Extrato of one subscription under the cards, with "Carregar mais" by cursor (REC-41). */
export function LedgerSection({ subscription, onClose }: LedgerSectionProps) {
  const ledger = useLedger(subscription.id);
  const items = ledger.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-labelledby="ledger-title" className="space-y-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id="ledger-title" className="font-heading-mobile text-heading-mobile text-ink">
          {`Extrato · ${subscription.category.name}`}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar extrato
        </Button>
      </div>
      {ledger.isPending ? (
        <Spinner label="Carregando o extrato" />
      ) : ledger.isError ? (
        <Alert tone="error">Não foi possível carregar o extrato agora.</Alert>
      ) : (
        <LedgerTable
          items={items}
          hasMore={ledger.hasNextPage}
          loadingMore={ledger.isFetchingNextPage}
          onLoadMore={() => void ledger.fetchNextPage()}
        />
      )}
    </section>
  );
}
