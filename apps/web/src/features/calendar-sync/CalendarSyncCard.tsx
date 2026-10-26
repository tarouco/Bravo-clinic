import { utcToLocal } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CopyField } from '../../components/ui/CopyField';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { messageOf } from '../../lib/api-errors';
import { formatLocalDateBR } from '../../lib/format';
import { useCalendarFeed, useIssueCalendarFeed } from './api';

/** How to add the link to the two most used calendars. */
function Instructions() {
  return (
    <div className="grid gap-space-md font-small text-small text-ink-muted md:grid-cols-2">
      <div>
        <h3 className="font-body text-body font-semibold text-ink">Google Agenda</h3>
        <ol className="list-decimal space-y-space-xs pl-space-lg">
          <li>No computador, abra o Google Agenda e vá em "Outras agendas" e "+".</li>
          <li>Escolha "Por URL" e cole o link.</li>
          <li>Toque em "Adicionar agenda".</li>
        </ol>
      </div>
      <div>
        <h3 className="font-body text-body font-semibold text-ink">Outlook</h3>
        <ol className="list-decimal space-y-space-xs pl-space-lg">
          <li>Abra o Outlook e vá em "Adicionar agenda".</li>
          <li>Escolha "Assinar da Web" e cole o link.</li>
          <li>Dê um nome à agenda e confirme.</li>
        </ol>
      </div>
    </div>
  );
}

/**
 * Personal calendar link on `/app/agenda` (GES-45): generate, copy and regenerate. The API gives
 * the URL only once, so it is held in memory here and gone when the page is left.
 */
export function CalendarSyncCard() {
  const feed = useCalendarFeed();
  const issue = useIssueCalendarFeed();
  const [url, setUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    issue.mutate(undefined, {
      onSuccess: (issued) => {
        setUrl(issued.url);
        setConfirming(false);
      },
      onError: (failure) => {
        setConfirming(false);
        setError(messageOf(failure, 'Não foi possível gerar o link agora.'));
      },
    });
  };

  const active = feed.data?.active === true;

  return (
    <section
      aria-labelledby="calendar-sync-title"
      className="space-y-space-md rounded-card border border-hairline bg-surface-raised p-space-lg"
    >
      <div className="space-y-space-xs">
        <h2
          id="calendar-sync-title"
          className="font-heading-mobile text-heading-mobile text-ink md:font-heading md:text-heading"
        >
          Agenda no seu calendário
        </h2>
        <p className="font-small text-small text-ink-muted">
          Veja suas reservas no Google Agenda ou no Outlook. O link é pessoal: quem o tiver vê suas
          reservas, então não o compartilhe.
        </p>
      </div>

      {feed.isPending ? <Spinner label="Carregando link da agenda" /> : null}
      {feed.isError ? (
        <Alert tone="error">Não foi possível carregar o link da agenda agora.</Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {url ? (
        <div className="space-y-space-sm">
          <Alert tone="success">Este link aparece só agora. Copie e guarde antes de sair.</Alert>
          <CopyField label="Link da sua agenda" value={url} buttonLabel="Copiar link" />
        </div>
      ) : null}

      {feed.isSuccess && !url && active ? (
        <p className="font-small text-small text-ink">
          {`Você já tem um link ativo (começa com ${feed.data.prefix ?? ''}`}
          {feed.data.createdAt
            ? `, criado em ${formatLocalDateBR(utcToLocal(new Date(feed.data.createdAt)).date)}`
            : ''}
          ). Por segurança, ele não é exibido de novo. Gere um novo link se precisar copiá-lo.
        </p>
      ) : null}

      {feed.isSuccess ? (
        <div>
          {active ? (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Gerar novo link
            </Button>
          ) : (
            <Button loading={issue.isPending} onClick={generate}>
              Gerar link da agenda
            </Button>
          )}
        </div>
      ) : null}

      {url || active ? <Instructions /> : null}

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Gerar novo link"
      >
        <div className="space-y-space-md">
          <p className="font-body text-body text-ink">
            O link atual deixa de funcionar e as agendas que o usam param de atualizar. Você precisa
            adicionar o novo link nelas.
          </p>
          <div className="flex flex-wrap justify-end gap-space-sm">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancelar
            </Button>
            <Button loading={issue.isPending} onClick={generate}>
              Gerar novo link
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
