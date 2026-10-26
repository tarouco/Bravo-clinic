import {
  bookingStatusLabel,
  couponUseStatusLabel,
  creditSourceLabel,
  customerNotesSchema,
  extraLotSourceLabel,
  formatBRL,
  formatDateBR,
  formatDateTimeBR,
  subscriptionStatusLabel,
} from '@bravo/core';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Textarea } from '../../../components/ui/form';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useToast } from '../../../components/ui/Toast';
import {
  fetchCustomerBookings,
  useCustomer,
  useSaveCustomerNotes,
} from '../../../features/admin-customers/api';
import { AnonymizeModal } from '../../../features/admin-customers/AnonymizeModal';
import type { CustomerBooking, CustomerDetail } from '../../../features/admin-customers/contracts';
import { CustomerEditModal } from '../../../features/admin-customers/CustomerEditModal';
import { consentLabel, formatPhone } from '../../../features/admin-customers/format';
import { QUOTE_STATUS_LABELS } from '../../../features/admin-extras/labels';
import { useSession } from '../../../features/auth/useSession';
import { messageOf } from '../../../lib/api-errors';
import { formatDuration, formatLocalDateBR } from '../../../lib/format';
import { usePageTitle } from '../../../lib/usePageTitle';

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-space-md rounded-card border border-hairline bg-surface-raised p-space-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id={headingId} className="font-heading text-heading-mobile text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const dateOrNone = (date: string | null): string =>
  date ? formatLocalDateBR(date) : 'Sem validade';

const dateOrDash = (date: string | null): string => (date ? formatLocalDateBR(date) : '—');

const bookingColumns: readonly TableColumn<CustomerBooking>[] = [
  { id: 'code', header: 'Código', cell: (b) => b.code },
  { id: 'room', header: 'Sala', cell: (b) => b.roomName },
  { id: 'start', header: 'Início', cell: (b) => formatDateTimeBR(new Date(b.startsAt)) },
  { id: 'status', header: 'Situação', cell: (b) => bookingStatusLabel[b.status] },
  { id: 'total', header: 'Total', align: 'right', cell: (b) => formatBRL(b.totalCents) },
];

function BookingsSection({ customerId, detail }: { customerId: string; detail: CustomerDetail }) {
  const [more, setMore] = useState<{ items: CustomerBooking[]; nextCursor: string | null } | null>(
    null,
  );
  const next = more ? more.nextCursor : detail.bookings.nextCursor;
  const items = [...detail.bookings.items, ...(more?.items ?? [])];
  const load = useMutation({
    mutationFn: (cursor: string) => fetchCustomerBookings(customerId, cursor),
    onSuccess: (page) => {
      setMore((current) => ({
        items: [...(current?.items ?? []), ...page.items],
        nextCursor: page.nextCursor,
      }));
    },
  });

  return (
    <Section title="Reservas">
      <Table
        caption="Reservas do cliente"
        columns={bookingColumns}
        rows={items}
        rowKey={(b) => b.id}
        emptyMessage="Nenhuma reserva."
      />
      {load.isError ? (
        <Alert tone="error">
          {messageOf(load.error, 'Não foi possível carregar as reservas.')}
        </Alert>
      ) : null}
      {next ? (
        <Button
          variant="secondary"
          loading={load.isPending}
          onClick={() => {
            load.mutate(next);
          }}
        >
          Carregar mais reservas
        </Button>
      ) : null}
    </Section>
  );
}

function NotesSection({ customerId, notes }: { customerId: string; notes: string | null }) {
  const save = useSaveCustomerNotes(customerId);
  const { toast } = useToast();
  const [value, setValue] = useState(notes ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="Anotações da equipe">
      <form
        noValidate
        className="space-y-space-sm"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = customerNotesSchema.safeParse({ notes: value });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Anotações inválidas');
            return;
          }
          setError(null);
          save.mutate(parsed.data.notes, {
            onSuccess: () => {
              toast({ message: 'Anotações salvas.' });
            },
            onError: (failure) => {
              setError(messageOf(failure, 'Não foi possível salvar as anotações.'));
            },
          });
        }}
      >
        <Textarea
          label="Anotações"
          rows={4}
          value={value}
          error={error ?? undefined}
          help="Visíveis só para a equipe. Até 4000 caracteres."
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <Button type="submit" loading={save.isPending}>
          Salvar anotações
        </Button>
      </form>
    </Section>
  );
}

function ProfileSection({ detail, isAdmin }: { detail: CustomerDetail; isAdmin: boolean }) {
  const { profile } = detail;
  const [editing, setEditing] = useState(false);
  const rows: [string, string][] = [
    ['E-mail', profile.email],
    ['Telefone', formatPhone(profile.phone)],
    ['Documento', profile.docMasked ?? '—'],
    ['Profissão', profile.profession ?? '—'],
    ['Registro profissional', profile.professionalRegistry ?? '—'],
    ['Cliente desde', formatDateBR(new Date(profile.createdAt))],
  ];

  return (
    <Section
      title="Cadastro"
      action={
        isAdmin ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(true);
            }}
          >
            Editar cadastro
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-space-sm sm:grid-cols-2">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
              {term}
            </dt>
            <dd className="font-small text-small text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {editing ? (
        <CustomerEditModal
          profile={profile}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </Section>
  );
}

const subscriptionColumns: readonly TableColumn<CustomerDetail['subscriptions'][number]>[] = [
  {
    id: 'plan',
    header: 'Plano',
    cell: (s) => (s.roomName ? `${s.categoryName} (${s.roomName})` : s.categoryName),
  },
  { id: 'status', header: 'Situação', cell: (s) => subscriptionStatusLabel[s.status] },
  { id: 'base', header: 'Data base', cell: (s) => formatLocalDateBR(s.baseOn) },
  { id: 'next', header: 'Próxima cobrança', cell: (s) => dateOrDash(s.nextChargeOn) },
  { id: 'balance', header: 'Saldo de horas', cell: (s) => formatDuration(s.balanceMinutes) },
];

const lotColumns: readonly TableColumn<CustomerDetail['extraLots'][number]>[] = [
  { id: 'source', header: 'Origem', cell: (l) => extraLotSourceLabel[l.source] },
  { id: 'balance', header: 'Saldo', cell: (l) => formatDuration(l.remainingMinutes) },
  { id: 'expires', header: 'Validade', cell: (l) => dateOrNone(l.expiresOn) },
];

const creditColumns: readonly TableColumn<CustomerDetail['credits'][number]>[] = [
  { id: 'source', header: 'Origem', cell: (c) => creditSourceLabel[c.source] },
  { id: 'balance', header: 'Saldo', align: 'right', cell: (c) => formatBRL(c.remainingCents) },
  { id: 'expires', header: 'Validade', cell: (c) => dateOrNone(c.expiresOn) },
];

const couponColumns: readonly TableColumn<CustomerDetail['couponUses'][number]>[] = [
  { id: 'code', header: 'Cupom', cell: (c) => c.code },
  { id: 'status', header: 'Situação', cell: (c) => couponUseStatusLabel[c.status] },
  { id: 'discount', header: 'Desconto', align: 'right', cell: (c) => formatBRL(c.discountCents) },
  { id: 'usedAt', header: 'Usado em', cell: (c) => formatDateBR(new Date(c.usedAt)) },
];

const consentColumns: readonly TableColumn<CustomerDetail['consents'][number]>[] = [
  { id: 'kind', header: 'Consentimento', cell: (c) => consentLabel(c.kind) },
  { id: 'version', header: 'Versão', cell: (c) => c.version },
  { id: 'acceptedAt', header: 'Aceito em', cell: (c) => formatDateBR(new Date(c.acceptedAt)) },
];

const quoteColumns: readonly TableColumn<CustomerDetail['quoteRequests'][number]>[] = [
  { id: 'service', header: 'Serviço', cell: (q) => q.serviceName },
  { id: 'status', header: 'Situação', cell: (q) => QUOTE_STATUS_LABELS[q.status] },
  { id: 'createdAt', header: 'Pedido em', cell: (q) => formatDateBR(new Date(q.createdAt)) },
];

/**
 * `/admin/clientes/:id`: profile, history and balances of one customer (GES-100). Staff write the
 * notes (GES-101); only the admin edits the profile or erases the data (GES-102, GES-127).
 */
export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const customer = useCustomer(id);
  const { session } = useSession();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [erasing, setErasing] = useState(false);
  const isAdmin = session?.role === 'admin';
  usePageTitle(customer.data?.profile.name ?? 'Cliente');

  if (customer.isPending) {
    return (
      <div className="flex justify-center py-space-3xl">
        <Spinner label="Carregando o cliente" />
      </div>
    );
  }
  if (customer.isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-space-md">
        <Link to="/admin/clientes" className="text-bronze underline underline-offset-4">
          Voltar para clientes
        </Link>
        <Alert tone="error">
          <p>{messageOf(customer.error, 'Não foi possível carregar o cliente.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void customer.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      </div>
    );
  }

  const detail = customer.data;
  const availableCents = detail.credits.reduce((sum, credit) => sum + credit.remainingCents, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-space-lg">
      <div>
        <Link
          to="/admin/clientes"
          className="font-small text-small text-bronze underline underline-offset-4"
        >
          Voltar para clientes
        </Link>
        <h1 className="mt-space-sm font-heading text-heading-mobile text-ink md:text-heading">
          {detail.profile.name}
        </h1>
      </div>

      <ProfileSection detail={detail} isAdmin={isAdmin} />
      <NotesSection customerId={id} notes={detail.profile.notes} />
      <BookingsSection customerId={id} detail={detail} />

      <Section title="Assinaturas">
        <Table
          caption="Assinaturas do cliente"
          columns={subscriptionColumns}
          rows={detail.subscriptions}
          rowKey={(s) => s.id}
          emptyMessage="Nenhuma assinatura."
        />
      </Section>
      <Section title="Horas extras">
        <Table
          caption="Horas extras do cliente"
          columns={lotColumns}
          rows={detail.extraLots}
          rowKey={(l) => l.id}
          emptyMessage="Nenhuma hora extra ativa."
        />
      </Section>
      <Section title="Créditos">
        <p className="font-small text-small text-ink">Disponível: {formatBRL(availableCents)}</p>
        <Table
          caption="Créditos do cliente"
          columns={creditColumns}
          rows={detail.credits}
          rowKey={(c) => c.id}
          emptyMessage="Nenhum crédito disponível."
        />
      </Section>
      <Section title="Cupons usados">
        <Table
          caption="Cupons usados pelo cliente"
          columns={couponColumns}
          rows={detail.couponUses}
          rowKey={(c) => c.id}
          emptyMessage="Nenhum cupom usado."
        />
      </Section>
      <Section title="Consentimentos">
        <Table
          caption="Consentimentos do cliente"
          columns={consentColumns}
          rows={detail.consents}
          rowKey={(c) => c.id}
          emptyMessage="Nenhum consentimento registrado."
        />
      </Section>
      <Section title="Pedidos de orçamento">
        <Table
          caption="Pedidos de orçamento do cliente"
          columns={quoteColumns}
          rows={detail.quoteRequests}
          rowKey={(q) => q.id}
          emptyMessage="Nenhum pedido de orçamento."
        />
      </Section>

      {isAdmin ? (
        <Section title="Privacidade (LGPD)">
          <p className="font-small text-small text-ink-muted">
            Apaga os dados pessoais deste cliente a pedido dele. Só é possível sem reservas futuras
            nem assinaturas em aberto.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setErasing(true);
            }}
          >
            Excluir dados (LGPD)
          </Button>
        </Section>
      ) : null}

      {erasing ? (
        <AnonymizeModal
          customerId={id}
          customerName={detail.profile.name}
          onClose={() => {
            setErasing(false);
          }}
          onDone={() => {
            toast({ message: 'Dados do cliente excluídos.' });
            void navigate('/admin/clientes');
          }}
        />
      ) : null}
    </div>
  );
}
