import { quoteStatusUpdateSchema } from '@bravo/core';
import { useState, type ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Textarea } from '../../components/ui/form';
import { useToast } from '../../components/ui/Toast';
import { messageOf } from '../../lib/api-errors';
import { formatLocalDateBR } from '../../lib/format';
import { useUpdateQuoteRequest } from './api';
import type { QuoteRequest } from './contracts';
import { QUOTE_STATUS_LABELS } from './labels';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
        {term}
      </dt>
      <dd className="font-small text-small text-ink">{children}</dd>
    </div>
  );
}

export interface QuoteDrawerProps {
  quote: QuoteRequest;
  onClose: () => void;
}

/** Detail of a quote request: contact, service, linked booking and editable staff notes (GES-96). */
export function QuoteDrawer({ quote, onClose }: QuoteDrawerProps) {
  const update = useUpdateQuoteRequest();
  const { toast } = useToast();
  const [notes, setNotes] = useState(quote.staffNotes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const parsed = quoteStatusUpdateSchema.safeParse({ staffNotes: notes });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Anotações inválidas');
      return;
    }
    setError(null);
    update.mutate(
      { id: quote.id, body: parsed.data },
      {
        onSuccess: () => {
          toast({ message: 'Anotações salvas.' });
        },
        onError: (failure) => {
          setError(messageOf(failure, 'Não foi possível salvar as anotações.'));
        },
      },
    );
  };

  return (
    <Drawer open onClose={onClose} title={`Pedido de ${quote.name}`}>
      <div className="space-y-space-md">
        <Badge>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
        <dl className="space-y-space-sm">
          <Row term="Serviço">{quote.serviceName}</Row>
          <Row term="Telefone">{quote.phone}</Row>
          <Row term="E-mail">{quote.email ?? '—'}</Row>
          <Row term="Data desejada">
            {quote.desiredOn ? formatLocalDateBR(quote.desiredOn) : '—'}
          </Row>
          <Row term="Reserva vinculada">{quote.bookingCode ?? '—'}</Row>
          <Row term="O que a pessoa precisa">{quote.description}</Row>
        </dl>
        <form
          noValidate
          className="space-y-space-sm"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Textarea
            label="Anotações da equipe"
            rows={5}
            value={notes}
            error={error ?? undefined}
            help="Visíveis só para a equipe. Até 2000 caracteres."
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
          <Button type="submit" loading={update.isPending}>
            Salvar anotações
          </Button>
        </form>
      </div>
    </Drawer>
  );
}
