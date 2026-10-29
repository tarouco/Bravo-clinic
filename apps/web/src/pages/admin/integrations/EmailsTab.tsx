import {
  formatDateTimeBR,
  notificationEventsSchema,
  notificationRecipientSchema,
  STAFF_EVENT_KEYS,
  type NotificationEventsInput,
} from '@bravo/core';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../../components/ui/form';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { useToast } from '../../../components/ui/Toast';
import {
  useAddRecipient,
  useDeleteRecipient,
  useNotifications,
  useOutbox,
  useSaveEvents,
  useSendTestEmail,
  useSetRecipientActive,
} from '../../../features/admin-integrations/api';
import type {
  EmailRecipient,
  OutboxRow,
  OutboxStatus,
  TestEmailResult,
} from '../../../features/admin-integrations/contracts';
import {
  OUTBOX_STATUS_LABELS,
  STAFF_EVENT_LABELS,
} from '../../../features/admin-integrations/labels';
import { messageOf } from '../../../lib/api-errors';

const MISSING_PROVIDER =
  'Provedor de e-mail não configurado — mensagens ficam registradas no histórico';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-space-md rounded-lg bg-surface-raised shadow-card p-space-lg"
    >
      <h2 id={headingId} className="font-heading text-heading-mobile text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RecipientRow({ recipient }: { recipient: EmailRecipient }) {
  const setActive = useSetRecipientActive();
  const remove = useDeleteRecipient();
  const [error, setError] = useState<string | null>(null);
  const fail = (failure: Error) => {
    setError(messageOf(failure, 'Não foi possível salvar a alteração.'));
  };

  return (
    <li className="space-y-space-xs border-b border-hairline/60 py-space-sm last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <span className="flex items-center gap-space-sm font-small text-small text-ink">
          {recipient.email}
          {recipient.active ? null : <Badge tone="neutral">Pausado</Badge>}
        </span>
        <span className="flex gap-space-xs">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${recipient.active ? 'Pausar' : 'Reativar'} ${recipient.email}`}
            disabled={setActive.isPending}
            onClick={() => {
              setError(null);
              setActive.mutate({ id: recipient.id, active: !recipient.active }, { onError: fail });
            }}
          >
            {recipient.active ? 'Pausar' : 'Reativar'}
          </Button>
          <Button
            className="text-danger"
            variant="ghost"
            size="sm"
            aria-label={`Remover ${recipient.email}`}
            disabled={remove.isPending}
            onClick={() => {
              setError(null);
              remove.mutate(recipient.id, { onError: fail });
            }}
          >
            Remover
          </Button>
        </span>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </li>
  );
}

/** Destinatários: who receives the clinic notices (GES-65). */
function RecipientsSection({ recipients }: { recipients: readonly EmailRecipient[] }) {
  const add = useAddRecipient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = notificationRecipientSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'E-mail inválido');
      return;
    }
    setError(null);
    add.mutate(parsed.data, {
      onSuccess: () => {
        setEmail('');
      },
      onError: (failure) => {
        setError(messageOf(failure, 'Não foi possível adicionar o destinatário.'));
      },
    });
  };

  return (
    <Section title="Destinatários">
      <p className="font-small text-small text-ink-muted">
        Os avisos da equipe são enviados a todos os destinatários ativos (até 10).
      </p>
      {recipients.length === 0 ? (
        <p className="font-small text-small text-ink-muted">Nenhum destinatário cadastrado.</p>
      ) : (
        <ul aria-label="Destinatários cadastrados">
          {recipients.map((recipient) => (
            <RecipientRow key={recipient.id} recipient={recipient} />
          ))}
        </ul>
      )}
      <form
        noValidate
        className="space-y-space-xs"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label="Novo destinatário"
          type="email"
          value={email}
          error={error ?? undefined}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <Button type="submit" size="sm" loading={add.isPending}>
          Adicionar destinatário
        </Button>
      </form>
    </Section>
  );
}

/** Avisos para a equipe: one toggle per staff event (GES-66). */
function EventsSection({ events }: { events: NotificationEventsInput }) {
  const save = useSaveEvents();
  const { toast } = useToast();
  const [draft, setDraft] = useState<NotificationEventsInput>(events);
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="Avisos para a equipe">
      <form
        noValidate
        className="space-y-space-sm"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = notificationEventsSchema.safeParse(draft);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Avisos inválidos');
            return;
          }
          setError(null);
          save.mutate(parsed.data, {
            onSuccess: () => {
              toast({ message: 'Avisos salvos.' });
            },
            onError: (failure) => {
              setError(messageOf(failure, 'Não foi possível salvar os avisos.'));
            },
          });
        }}
      >
        {STAFF_EVENT_KEYS.map((key) => (
          <Checkbox
            key={key}
            label={STAFF_EVENT_LABELS[key]}
            checked={draft[key]}
            onChange={(event) => {
              setDraft((current) => ({ ...current, [key]: event.target.checked }));
            }}
          />
        ))}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" loading={save.isPending}>
          Salvar avisos
        </Button>
      </form>
    </Section>
  );
}

/** E-mail de teste: queues `system.test` and lists the final status per address (GES-70). */
function TestEmailSection() {
  const send = useSendTestEmail();
  const [to, setTo] = useState('');
  const [result, setResult] = useState<TestEmailResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="E-mail de teste">
      <Input
        label="Enviar para (opcional)"
        type="email"
        value={to}
        help="Em branco, o teste vai para todos os destinatários ativos."
        onChange={(event) => {
          setTo(event.target.value);
        }}
      />
      <Button
        variant="secondary"
        loading={send.isPending}
        onClick={() => {
          setError(null);
          setResult(null);
          send.mutate(to.trim() === '' ? {} : { to: to.trim() }, {
            onSuccess: setResult,
            onError: (failure) => {
              setError(messageOf(failure, 'Não foi possível enviar o e-mail de teste.'));
            },
          });
        }}
      >
        Enviar e-mail de teste
      </Button>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {result ? (
        <ul aria-label="Resultado do envio" className="font-small text-small text-ink">
          {result.results.map((row) => (
            <li key={row.to}>
              {row.to}: {OUTBOX_STATUS_LABELS[row.status]}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

const STATUS_TONE = {
  sent: 'emerald',
  pending: 'gold',
  failed: 'danger',
  not_sent: 'neutral',
} as const;

const outboxColumns: readonly TableColumn<OutboxRow>[] = [
  { id: 'createdAt', header: 'Data', cell: (r) => formatDateTimeBR(new Date(r.createdAt)) },
  { id: 'to', header: 'Destinatário', cell: (r) => r.to },
  { id: 'template', header: 'Modelo', cell: (r) => r.template },
  { id: 'subject', header: 'Assunto', cell: (r) => r.subject },
  {
    id: 'status',
    header: 'Situação',
    cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{OUTBOX_STATUS_LABELS[r.status]}</Badge>,
  },
  { id: 'attempts', header: 'Tentativas', align: 'right', cell: (r) => String(r.attempts) },
  { id: 'lastError', header: 'Último erro', cell: (r) => r.lastError ?? '—' },
];

/** Histórico de envios: the outbox of the last 30 days (GES-71). */
function OutboxSection() {
  const [status, setStatus] = useState<OutboxStatus | ''>('');
  const outbox = useOutbox(status);
  const rows = outbox.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Section title="Histórico de envios">
      <Select
        label="Situação"
        value={status}
        onChange={(event) => {
          setStatus(event.target.value as OutboxStatus | '');
        }}
      >
        <option value="">Todas</option>
        {(Object.keys(OUTBOX_STATUS_LABELS) as OutboxStatus[]).map((value) => (
          <option key={value} value={value}>
            {OUTBOX_STATUS_LABELS[value]}
          </option>
        ))}
      </Select>
      {outbox.isPending ? <Spinner label="Carregando o histórico" /> : null}
      {outbox.isError ? (
        <Alert tone="error">
          <p>{messageOf(outbox.error, 'Não foi possível carregar o histórico de envios.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void outbox.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {outbox.data ? (
        <Table
          density="compact"
          caption="E-mails dos últimos 30 dias"
          columns={outboxColumns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyMessage="Nenhum e-mail no período."
        />
      ) : null}
      {outbox.hasNextPage ? (
        <Button
          variant="secondary"
          loading={outbox.isFetchingNextPage}
          onClick={() => {
            void outbox.fetchNextPage();
          }}
        >
          Carregar mais
        </Button>
      ) : null}
    </Section>
  );
}

/** E-mails tab: recipients, per-event notices, test e-mail and the outbox (GES-65..GES-74). */
export function EmailsTab() {
  const notifications = useNotifications();

  if (notifications.isPending) return <Spinner label="Carregando as notificações" />;
  if (notifications.isError) {
    return (
      <Alert tone="error">
        <p>{messageOf(notifications.error, 'Não foi possível carregar as notificações.')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-space-sm"
          onClick={() => {
            void notifications.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </Alert>
    );
  }

  const { providerConfigured, recipients, events } = notifications.data;
  return (
    <div className="space-y-space-lg">
      {providerConfigured ? null : <Alert tone="info">{MISSING_PROVIDER}</Alert>}
      <RecipientsSection recipients={recipients} />
      <EventsSection key={JSON.stringify(events)} events={events} />
      <TestEmailSection />
      <OutboxSection />
    </div>
  );
}
