import {
  formatBRL,
  periodStatusLabel,
  subscriptionStatusLabel,
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from '@bravo/core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BalanceMeter } from '../../components/revenue/BalanceMeter';
import { LedgerTable } from '../../components/revenue/LedgerTable';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/form';
import { Table, type TableColumn } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { messageOf } from '../../lib/api-errors';
import { formatLocalDateBR } from '../../lib/format';
import { useSession } from '../auth/useSession';
import {
  useAdminLedger,
  useAdminSubscription,
  useAdminSubscriptions,
  useResendSaleLink,
  type AdminSubscriptionFilters,
} from '../purchases/api';
import { formatBalance, formatDateTime } from '../purchases/format';
import type { AdminSubscriptionRow, Period, Subscription } from '../purchases/types';
import {
  AdjustBalanceDialog,
  AdminCancelDialog,
  GrantCreditDialog,
} from './AdminSubscriptionDialogs';

export { GrantCreditDialog } from './AdminSubscriptionDialogs';

const STATUS_TONES: Record<SubscriptionStatus, BadgeTone> = {
  awaiting_payment: 'champagne',
  active: 'bronze',
  suspended: 'error',
  ended: 'neutral',
  cancelled: 'neutral',
  switched: 'neutral',
  expired: 'neutral',
};

const TYPE_LABELS = { hour_package: 'Pacote de horas', fixed_schedule: 'Horário fixo' } as const;

/** Statuses a subscription can still be cancelled from (REC-60). */
const CANCELLABLE: readonly SubscriptionStatus[] = ['awaiting_payment', 'active', 'suspended'];

const SEARCH_DELAY_MS = 300;

/** The value once it stopped changing for a moment, so typing does not query on every key. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </dt>
      <dd className="font-small text-small text-ink">{children}</dd>
    </div>
  );
}

function PeriodLine({ period }: { period: Period }) {
  const parts = [
    `Período ${String(period.seq)}`,
    `${formatLocalDateBR(period.startsOn)} a ${formatLocalDateBR(period.endsOn)}`,
    periodStatusLabel[period.status],
    formatBRL(period.priceCents),
  ];
  if (period.minutesBalance !== undefined) {
    parts.push(`saldo ${formatBalance(period.minutesBalance)}`);
  }
  if (period.occurrenceCount !== undefined) {
    parts.push(`${String(period.occurrenceCount)} ocorrências`);
  }
  return (
    <li className="space-y-0.5 py-space-xs font-small text-small text-ink">
      <p>{parts.join(' · ')}</p>
      {period.heldConflicts && period.heldConflicts.length > 0 ? (
        <p className="text-ink-muted">
          {`Datas retidas: ${period.heldConflicts.map((c) => `${formatLocalDateBR(c.date)} (${c.label})`).join(', ')}`}
        </p>
      ) : null}
    </li>
  );
}

type Dialog = 'adjust' | 'cancel' | 'credit';

function nextChargeText(charge: NonNullable<Subscription['nextCharge']>): string {
  const method =
    charge.method === 'saved_card' && charge.cardLast4
      ? `cartão final ${charge.cardLast4}`
      : charge.method === 'saved_card'
        ? 'cartão salvo'
        : 'Pix';
  return `${formatLocalDateBR(charge.on)} · ${formatBRL(charge.amountCents)} · ${method}`;
}

interface DrawerProps {
  row: AdminSubscriptionRow | null;
  /** Admin-only actions are shown only when true (reception reads only, REC-153). */
  canManage: boolean;
  onClose: () => void;
}

/** One subscription: its periods, extrato and the admin actions (REC-149). */
function SubscriptionDrawer({ row, canManage, onClose }: DrawerProps) {
  const detail = useAdminSubscription(row?.id ?? null);
  const ledger = useAdminLedger(row && row.type === 'hour_package' ? row.id : null);
  const resend = useResendSaleLink(row?.id ?? '');
  const { toast } = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const subscription = detail.data;
  const ledgerItems = ledger.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <Drawer
        open={row !== null}
        onClose={onClose}
        wide
        title={row ? `${row.customer.name} · ${row.category.name}` : 'Assinatura'}
      >
        {detail.isPending ? (
          <Spinner label="Carregando a assinatura" />
        ) : detail.isError || !subscription || !row ? (
          <Alert tone="error">
            {messageOf(detail.error, 'Não foi possível carregar a assinatura.')}
          </Alert>
        ) : (
          <div className="space-y-space-lg">
            <div className="flex flex-wrap items-center gap-space-sm">
              <Badge tone={STATUS_TONES[subscription.status]}>
                {subscriptionStatusLabel[subscription.status]}
              </Badge>
              <span className="font-small text-small text-ink-muted">
                {TYPE_LABELS[subscription.type]}
              </span>
            </div>

            <dl className="grid gap-space-md sm:grid-cols-2">
              <Detail label="Início">{formatLocalDateBR(subscription.baseOn)}</Detail>
              {subscription.room ? <Detail label="Sala">{subscription.room.name}</Detail> : null}
              {subscription.nextCharge ? (
                <Detail label="Próxima cobrança">{nextChargeText(subscription.nextCharge)}</Detail>
              ) : null}
              {subscription.holdExpiresAt ? (
                <Detail label="Link vale até">{formatDateTime(subscription.holdExpiresAt)}</Detail>
              ) : null}
            </dl>

            {subscription.type === 'hour_package' && subscription.balance ? (
              <BalanceMeter
                packageMinutes={subscription.balance.packageMinutes}
                includedMinutes={subscription.balance.includedMinutes}
                extraMinutes={subscription.balance.extraMinutes}
              />
            ) : null}
            {subscription.type === 'fixed_schedule' && subscription.occurrences ? (
              <p className="font-small text-small text-ink">
                {`${String(subscription.occurrences.remainingInPeriod)} ocorrências restantes no período`}
              </p>
            ) : null}

            <section aria-labelledby="sub-periods" className="space-y-space-xs">
              <h3 id="sub-periods" className="font-h3 text-h3 text-ink">
                Períodos
              </h3>
              {subscription.currentPeriod || subscription.nextPeriod ? (
                <ul aria-label="Períodos da assinatura" className="divide-y divide-hairline/60">
                  {subscription.currentPeriod ? (
                    <PeriodLine period={subscription.currentPeriod} />
                  ) : null}
                  {subscription.nextPeriod ? <PeriodLine period={subscription.nextPeriod} /> : null}
                </ul>
              ) : (
                <p className="font-small text-small text-ink-muted">Nenhum período em andamento.</p>
              )}
            </section>

            {canManage ? (
              <div className="flex flex-wrap gap-space-sm">
                {subscription.type === 'hour_package' && subscription.status === 'active' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDialog('adjust');
                    }}
                  >
                    Ajustar saldo
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDialog('credit');
                  }}
                >
                  Conceder crédito
                </Button>
                {subscription.status === 'awaiting_payment' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={resend.isPending}
                    onClick={() => {
                      resend.mutate(undefined, {
                        onSuccess: () => {
                          toast({ message: 'Link reenviado ao cliente.' });
                        },
                        onError: (error) => {
                          toast({ message: messageOf(error, 'Não foi possível reenviar o link.') });
                        },
                      });
                    }}
                  >
                    Reenviar link
                  </Button>
                ) : null}
                {CANCELLABLE.includes(subscription.status) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDialog('cancel');
                    }}
                  >
                    Cancelar assinatura
                  </Button>
                ) : null}
              </div>
            ) : null}

            {subscription.type === 'hour_package' ? (
              <section aria-labelledby="sub-ledger" className="space-y-space-sm">
                <h3 id="sub-ledger" className="font-h3 text-h3 text-ink">
                  Extrato
                </h3>
                {ledger.isPending ? (
                  <Spinner label="Carregando o extrato" />
                ) : ledger.isError ? (
                  <Alert tone="error">
                    {messageOf(ledger.error, 'Não foi possível carregar o extrato.')}
                  </Alert>
                ) : (
                  <LedgerTable
                    items={ledgerItems}
                    hasMore={ledger.hasNextPage}
                    loadingMore={ledger.isFetchingNextPage}
                    onLoadMore={() => void ledger.fetchNextPage()}
                  />
                )}
              </section>
            ) : null}
          </div>
        )}
      </Drawer>

      {row && subscription && dialog === 'adjust' ? (
        <AdjustBalanceDialog
          subscription={subscription}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {row && subscription && dialog === 'cancel' ? (
        <AdminCancelDialog
          subscription={subscription}
          customerName={row.customer.name}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {row && dialog === 'credit' ? (
        <GrantCreditDialog
          userId={row.customer.id}
          customerName={row.customer.name}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Gestão de Reservas → Assinaturas (slot `admin.reservations.tabs`): every subscription with
 * filters and search, and the detail drawer with periods, extrato and admin actions
 * (REC-148, REC-149). Reception only reads (REC-153).
 */
export function AssinaturasTab() {
  const { session } = useSession();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), SEARCH_DELAY_MS);
  const [selected, setSelected] = useState<AdminSubscriptionRow | null>(null);

  const filters = useMemo<AdminSubscriptionFilters>(
    () => ({
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(search ? { search } : {}),
    }),
    [status, type, search],
  );
  const list = useAdminSubscriptions(filters);
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  const columns: readonly TableColumn<AdminSubscriptionRow>[] = [
    {
      id: 'customer',
      header: 'Cliente',
      sortValue: (r) => r.customer.name,
      cell: (r) => <span className="font-medium">{r.customer.name}</span>,
    },
    { id: 'category', header: 'Categoria', cell: (r) => r.category.name },
    { id: 'type', header: 'Tipo', cell: (r) => TYPE_LABELS[r.type] },
    { id: 'room', header: 'Sala', cell: (r) => r.room?.name ?? '—' },
    { id: 'baseOn', header: 'Data base', cell: (r) => formatLocalDateBR(r.baseOn) },
    {
      id: 'nextCharge',
      header: 'Próxima cobrança',
      cell: (r) => (r.nextChargeOn ? formatLocalDateBR(r.nextChargeOn) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <Badge tone={STATUS_TONES[r.status]}>{r.statusLabel}</Badge>,
    },
    { id: 'balance', header: 'Saldo', cell: (r) => r.balanceText },
    {
      id: 'actions',
      header: 'Ações',
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Abrir assinatura de ${r.customer.name}: ${r.category.name}`}
          onClick={() => {
            setSelected(r);
          }}
        >
          Detalhes
        </Button>
      ),
    },
  ];

  return (
    <section aria-label="Assinaturas" className="space-y-space-md">
      <div className="flex flex-wrap items-end gap-space-md">
        <Select
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
          }}
        >
          <option value="">Todos os status</option>
          {SUBSCRIPTION_STATUSES.map((code) => (
            <option key={code} value={code}>
              {subscriptionStatusLabel[code]}
            </option>
          ))}
        </Select>
        <Select
          label="Tipo"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
          }}
        >
          <option value="">Todos os tipos</option>
          <option value="hour_package">{TYPE_LABELS.hour_package}</option>
          <option value="fixed_schedule">{TYPE_LABELS.fixed_schedule}</option>
        </Select>
        <Input
          label="Buscar cliente"
          placeholder="Nome do cliente"
          autoComplete="off"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
          }}
        />
      </div>

      {list.isPending ? <Spinner label="Carregando as assinaturas" /> : null}
      {list.isError ? (
        <Alert tone="error">
          {messageOf(list.error, 'Não foi possível carregar as assinaturas agora.')}
        </Alert>
      ) : null}
      {list.data ? (
        <Table
          caption="Assinaturas"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyMessage="Nenhuma assinatura encontrada."
        />
      ) : null}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Carregar mais
        </Button>
      ) : null}

      <SubscriptionDrawer
        row={selected}
        canManage={session?.role === 'admin'}
        onClose={() => {
          setSelected(null);
        }}
      />
    </section>
  );
}

AssinaturasTab.tabId = 'assinaturas';
AssinaturasTab.tabLabel = 'Assinaturas';
