import { formatDateBR } from '@bravo/core';
import { useId, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { CopyField } from '../../../components/ui/CopyField';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/Toast';
import {
  useCalendarFeeds,
  useIssueFeed,
  useRevokeFeed,
} from '../../../features/admin-integrations/api';
import type { CalendarFeed } from '../../../features/admin-integrations/contracts';
import { messageOf } from '../../../lib/api-errors';

interface FeedControlProps {
  scope: 'clinic' | 'room';
  roomId?: string;
  /** What the link shows ("a agenda da clínica", "a Sala Aurora"), used in the dialogs. */
  subject: string;
  feed: CalendarFeed | null;
}

/**
 * Generate, regenerate and revoke the secret link of one feed (GES-42, GES-43). The full URL
 * exists only in this component's state, right after it was issued.
 */
function FeedControl({ scope, roomId, subject, feed }: FeedControlProps) {
  const issue = useIssueFeed();
  const revoke = useRevokeFeed();
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'regenerate' | 'revoke' | null>(null);

  const generate = () => {
    setError(null);
    issue.mutate(roomId ? { scope, roomId } : { scope }, {
      onSuccess: (issued) => {
        setUrl(issued.url);
        setDialog(null);
      },
      onError: (failure) => {
        setDialog(null);
        setError(messageOf(failure, 'Não foi possível gerar o link.'));
      },
    });
  };

  const remove = () => {
    if (!feed) return;
    setError(null);
    revoke.mutate(feed.id, {
      onSuccess: () => {
        setUrl(null);
        setDialog(null);
        toast({ message: 'Link revogado.' });
      },
      onError: (failure) => {
        setDialog(null);
        setError(messageOf(failure, 'Não foi possível revogar o link.'));
      },
    });
  };

  return (
    <div className="space-y-space-sm">
      <p className="font-small text-small text-ink">
        {feed ? (
          <>
            <span>Link ativo: {feed.prefix}…</span>{' '}
            <span className="text-ink-muted">
              (gerado em {formatDateBR(new Date(feed.createdAt))})
            </span>
          </>
        ) : (
          <span className="text-ink-muted">Sem link</span>
        )}
      </p>

      {url ? (
        <div className="space-y-space-sm">
          <Alert tone="info">Copie agora: o link não será exibido de novo</Alert>
          <CopyField label="Link do calendário" value={url} buttonLabel="Copiar link" />
        </div>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-space-sm">
        {feed ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDialog('regenerate');
              }}
            >
              Gerar novo link
            </Button>
            <Button
              className="text-danger"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDialog('revoke');
              }}
            >
              Revogar
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" loading={issue.isPending} onClick={generate}>
            Gerar link
          </Button>
        )}
      </div>

      <Modal
        open={dialog === 'regenerate'}
        onClose={() => {
          setDialog(null);
        }}
        title="Gerar novo link"
      >
        <p className="font-body text-body text-ink">
          O link atual deixa de funcionar na hora para {subject}. Quem o usa no Google Agenda ou no
          Outlook precisará assinar o novo link.
        </p>
        <div className="mt-space-lg flex flex-wrap justify-end gap-space-sm">
          <Button
            variant="secondary"
            onClick={() => {
              setDialog(null);
            }}
          >
            Cancelar
          </Button>
          <Button loading={issue.isPending} onClick={generate}>
            Gerar novo link
          </Button>
        </div>
      </Modal>
      <Modal
        open={dialog === 'revoke'}
        onClose={() => {
          setDialog(null);
        }}
        title="Revogar link"
      >
        <p className="font-body text-body text-ink">
          O link de {subject} deixa de funcionar na hora e as agendas que o assinam param de se
          atualizar.
        </p>
        <div className="mt-space-lg flex flex-wrap justify-end gap-space-sm">
          <Button
            variant="secondary"
            onClick={() => {
              setDialog(null);
            }}
          >
            Cancelar
          </Button>
          <Button variant="danger" loading={revoke.isPending} onClick={remove}>
            Revogar link
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** Calendário tab: the clinic feed, one feed per room and the subscription instructions (GES-42). */
export function CalendarTab() {
  const feeds = useCalendarFeeds();
  const clinicHeading = useId();
  const roomsHeading = useId();
  const helpHeading = useId();

  if (feeds.isPending) return <Spinner label="Carregando os links de calendário" />;
  if (feeds.isError) {
    return (
      <Alert tone="error">
        <p>{messageOf(feeds.error, 'Não foi possível carregar os links de calendário.')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-space-sm"
          onClick={() => {
            void feeds.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </Alert>
    );
  }

  const { feeds: list, rooms } = feeds.data;
  const clinicFeed = list.find((f) => f.scope === 'clinic') ?? null;

  return (
    <div className="space-y-space-lg">
      <section
        aria-labelledby={clinicHeading}
        className="space-y-space-sm rounded-lg bg-surface-raised shadow-card p-space-lg"
      >
        <h2 id={clinicHeading} className="font-heading text-heading-mobile text-ink">
          Agenda da clínica
        </h2>
        <p className="font-small text-small text-ink-muted">
          Todas as reservas e bloqueios, de todas as salas, em um link secreto de leitura.
        </p>
        <FeedControl scope="clinic" subject="a agenda da clínica" feed={clinicFeed} />
      </section>

      <section aria-labelledby={roomsHeading} className="space-y-space-sm">
        <h2 id={roomsHeading} className="font-heading text-heading-mobile text-ink">
          Agendas por sala
        </h2>
        <ul className="space-y-space-md">
          {rooms.map((room) => (
            <li
              key={room.id}
              aria-label={room.name}
              className="space-y-space-xs rounded-lg bg-surface-raised shadow-card p-space-lg"
            >
              <p className="font-medium text-ink">{room.name}</p>
              <FeedControl
                scope="room"
                roomId={room.id}
                subject={`a ${room.name}`}
                feed={list.find((f) => f.scope === 'room' && f.roomId === room.id) ?? null}
              />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby={helpHeading}
        className="space-y-space-sm rounded-lg bg-surface-deboss shadow-deboss p-space-lg"
      >
        <h2 id={helpHeading} className="font-heading text-heading-mobile text-ink">
          Como assinar no Google Agenda e no Outlook
        </h2>
        <ol className="list-decimal space-y-space-xs pl-space-lg font-small text-small text-ink">
          <li>Gere o link e copie-o: ele aparece uma única vez.</li>
          <li>
            No Google Agenda, abra &quot;Outras agendas&quot; (+), escolha &quot;Do URL&quot; e cole
            o link.
          </li>
          <li>
            No Outlook, escolha &quot;Adicionar calendário&quot;, depois &quot;Assinar da Web&quot;,
            e cole o link.
          </li>
        </ol>
        <p className="font-caption text-caption text-ink-muted">
          O Google e o Outlook atualizam a agenda assinada a cada algumas horas. Quem tem o link vê
          os eventos: revogue-o se ele for compartilhado por engano.
        </p>
      </section>
    </div>
  );
}
