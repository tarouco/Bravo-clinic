import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Tabs, type TabItem } from '../../../components/ui/Tabs';
import { useExtraHours, usePackages, useSubscriptions } from '../../../features/purchases/api';
import { LedgerSection } from '../../../features/purchases/LedgerSection';
import { PayDialog } from '../../../features/purchases/PayDialog';
import { SubscriptionCard } from '../../../features/purchases/SubscriptionCard';
import {
  CancelSubscriptionDialog,
  SwitchPackageDialog,
} from '../../../features/purchases/SubscriptionDialogs';
import { usePageTitle } from '../../../lib/usePageTitle';

interface ComprasTab {
  id: string;
  label: string;
  path: string;
}

const BASE = '/app/compras';

/** The tab a path belongs to: `/app/compras/assinaturas/:id/pagar` is still Assinaturas. */
function activeTabId(pathname: string): string {
  if (pathname.startsWith(`${BASE}/horas-extras`)) return 'horas-extras';
  if (pathname.startsWith(`${BASE}/creditos`)) return 'creditos';
  if (pathname.startsWith(`${BASE}/historico`)) return 'historico';
  return 'assinaturas';
}

/**
 * `/app/compras/*`: the tabs Assinaturas, Horas extras, Créditos and Histórico (REC-146). Horas
 * extras shows only while the API says the tenant is eligible (REC-69).
 */
export function ComprasLayout() {
  usePageTitle('Compras');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const extraHours = useExtraHours();

  const tabs: ComprasTab[] = [
    { id: 'assinaturas', label: 'Assinaturas', path: BASE },
    ...(extraHours.data?.eligible
      ? [{ id: 'horas-extras', label: 'Horas extras', path: `${BASE}/horas-extras` }]
      : []),
    { id: 'creditos', label: 'Créditos', path: `${BASE}/creditos` },
    { id: 'historico', label: 'Histórico', path: `${BASE}/historico` },
  ];
  const active = activeTabId(pathname);
  const items: TabItem[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    content: tab.id === active ? <Outlet /> : null,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-space-lg">
      <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
        Compras
      </h1>
      <Tabs
        label="Compras"
        items={items}
        {...(tabs.some((tab) => tab.id === active) ? { value: active } : {})}
        onValueChange={(id) => {
          const target = tabs.find((tab) => tab.id === id);
          if (target) void navigate(target.path);
        }}
      />
      {/* A tab the tenant cannot see (Horas extras without a package) still renders its page,
          which sends the tenant back to Assinaturas. */}
      {tabs.some((tab) => tab.id === active) ? null : <Outlet />}
    </div>
  );
}

/** Assinaturas tab: a card per subscription with the actions of its status (REC-143, REC-144, REC-147). */
export function ComprasPage() {
  const navigate = useNavigate();
  const { id: payId } = useParams();
  const subscriptions = useSubscriptions();
  const packages = usePackages();
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'switch' | 'cancel'; id: string } | null>(null);

  if (subscriptions.isPending) {
    return (
      <div className="flex justify-center py-space-2xl">
        <Spinner label="Carregando assinaturas" />
      </div>
    );
  }
  if (subscriptions.isError) {
    return <Alert tone="error">Não foi possível carregar suas assinaturas agora.</Alert>;
  }

  const items = subscriptions.data.items;
  const offers = packages.data?.items ?? [];
  const ledgerOf = items.find((subscription) => subscription.id === ledgerId);
  const dialogOf = items.find((subscription) => subscription.id === dialog?.id);
  const closeDialog = () => {
    setDialog(null);
  };

  return (
    <div className="space-y-space-lg">
      {items.length === 0 ? (
        <Card variant="emerald">
          <div className="flex flex-col items-start gap-space-sm">
            <h2 className="bv-card-title">Você ainda não tem assinaturas</h2>
            <p className="bv-card-text">
              Pacotes de horas e horários fixos têm preço melhor e renovam sozinhos.
            </p>
            <Button asChild variant="gold" size="sm" className="mt-space-sm">
              <Link to="/precos">Ver pacotes</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-space-md">
          {items.map((subscription) => (
            <SubscriptionCard
              key={subscription.id}
              subscription={subscription}
              offer={offers.find((offer) => offer.id === subscription.category.id)}
              onSwitch={() => {
                setDialog({ kind: 'switch', id: subscription.id });
              }}
              onCancel={() => {
                setDialog({ kind: 'cancel', id: subscription.id });
              }}
              onLedger={() => {
                setLedgerId(subscription.id);
              }}
            />
          ))}
        </div>
      )}

      {ledgerOf ? (
        <LedgerSection
          subscription={ledgerOf}
          onClose={() => {
            setLedgerId(null);
          }}
        />
      ) : null}

      {dialogOf && dialog?.kind === 'switch' ? (
        <SwitchPackageDialog subscription={dialogOf} onClose={closeDialog} />
      ) : null}
      {dialogOf && dialog?.kind === 'cancel' ? (
        <CancelSubscriptionDialog subscription={dialogOf} onClose={closeDialog} />
      ) : null}

      {payId ? (
        <PayDialog
          subscriptionId={payId}
          onClose={() => {
            void navigate(BASE);
          }}
        />
      ) : null}
    </div>
  );
}
