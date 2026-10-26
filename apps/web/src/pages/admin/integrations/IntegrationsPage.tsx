import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../../components/ui/Tabs';
import { usePageTitle } from '../../../lib/usePageTitle';
import { PaymentsTab } from './PaymentsTab';

const TAB_IDS = ['pagamentos'] as const;
type TabId = (typeof TAB_IDS)[number];

const isTab = (value: string | null): value is TabId => TAB_IDS.some((id) => id === value);

/**
 * `/admin/integracoes`: Pagamentos, Calendário, MCP, E-mails and Consumo. The active tab is the
 * `tab` search param; only the open tab is mounted, so a closed tab does not fetch.
 */
export function IntegrationsPage() {
  usePageTitle('Integrações');
  const [searchParams, setSearchParams] = useSearchParams();
  const param = searchParams.get('tab');
  const tab: TabId = isTab(param) ? param : 'pagamentos';

  return (
    <div className="mx-auto max-w-5xl space-y-space-lg">
      <h1 className="font-heading text-heading-mobile text-ink md:text-heading">Integrações</h1>
      <Tabs
        label="Seções das integrações"
        value={tab}
        onValueChange={(id) => {
          setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            if (id === 'pagamentos') next.delete('tab');
            else next.set('tab', id);
            return next;
          });
        }}
        items={[
          {
            id: 'pagamentos',
            label: 'Pagamentos',
            content: tab === 'pagamentos' ? <PaymentsTab /> : null,
          },
        ]}
      />
    </div>
  );
}
