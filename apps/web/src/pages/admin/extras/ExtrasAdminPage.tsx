import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../../components/ui/Tabs';
import { usePageTitle } from '../../../lib/usePageTitle';
import { QuotesTab } from './QuotesTab';
import { ServicesTab } from './ServicesTab';

const TAB_IDS = ['servicos', 'pedidos'] as const;
type TabId = (typeof TAB_IDS)[number];

const isTab = (value: string | null): value is TabId => TAB_IDS.some((id) => id === value);

/**
 * `/admin/servicos-extras`: Serviços (catalog) and Pedidos (quote funnel). The active tab is the
 * `tab` search param; only the open tab is mounted, so a closed tab does not fetch.
 */
export function ExtrasAdminPage() {
  usePageTitle('Serviços Extras');
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get('tab');
  const tab: TabId = isTab(param) ? param : 'servicos';

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">Serviços Extras</h1>
      <Tabs
        label="Seções dos serviços extras"
        value={tab}
        onValueChange={(id) => {
          setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            if (id === 'servicos') next.delete('tab');
            else next.set('tab', id);
            return next;
          });
        }}
        items={[
          {
            id: 'servicos',
            label: 'Serviços',
            content: tab === 'servicos' ? <ServicesTab /> : null,
          },
          {
            id: 'pedidos',
            label: 'Pedidos',
            content: tab === 'pedidos' ? <QuotesTab /> : null,
          },
        ]}
      />
    </div>
  );
}
