import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../../components/ui/Tabs';
import { usePageTitle } from '../../../lib/usePageTitle';
import { ExpensesTab } from './ExpensesTab';
import { FinanceOverviewPage } from './FinanceOverviewPage';
import { ReceiptsTab } from './ReceiptsTab';

const TAB_IDS = ['visao-geral', 'despesas', 'recebimentos'] as const;
type TabId = (typeof TAB_IDS)[number];

const isTab = (value: string | null): value is TabId => TAB_IDS.some((id) => id === value);

/**
 * `/admin/financeiro`: Visão geral, Despesas and Recebimentos manuais. The active tab is the
 * `tab` search param, next to the overview's own `regime`, `grouping`, `from` and `to`.
 */
export function FinancePage() {
  usePageTitle('Financeiro');
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get('tab');
  const tab: TabId = isTab(param) ? param : 'visao-geral';

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
        Financeiro
      </h1>
      <Tabs
        label="Seções do financeiro"
        value={tab}
        onValueChange={(id) => {
          setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            if (id === 'visao-geral') next.delete('tab');
            else next.set('tab', id);
            return next;
          });
        }}
        // Only the open tab is mounted, so a closed tab does not fetch.
        items={[
          {
            id: 'visao-geral',
            label: 'Visão geral',
            content: tab === 'visao-geral' ? <FinanceOverviewPage /> : null,
          },
          {
            id: 'despesas',
            label: 'Despesas',
            content: tab === 'despesas' ? <ExpensesTab /> : null,
          },
          {
            id: 'recebimentos',
            label: 'Recebimentos manuais',
            content: tab === 'recebimentos' ? <ReceiptsTab /> : null,
          },
        ]}
      />
    </div>
  );
}
