import type { SavedCard } from '@bravo/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Checkbox, Input } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import {
  usePaymentConfig,
  useCards,
  useDeleteCard,
  useSaveCard,
} from '../../features/payments/api';
import { tokenizerFor, type CardInput } from '../../features/payments/tokenizers';
import { useProfile } from '../../features/profile/api';
import { ApiError } from '../../lib/api';
import { usePageTitle } from '../../lib/usePageTitle';

export const CONSENT_TEXT = 'Autorizo cobranças automáticas deste cartão para saldos e renovações.';

const brandName = (brand: string): string => brand.charAt(0).toUpperCase() + brand.slice(1);
const cardLabel = (card: SavedCard): string =>
  `${brandName(card.brand)} final ${card.last4} · ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear)}`;

const EMPTY_CARD: Omit<CardInput, 'document'> = {
  number: '',
  holder: '',
  expMonth: '',
  expYear: '',
  cvv: '',
};

function AddCardForm() {
  const config = usePaymentConfig();
  const profile = useProfile();
  const save = useSaveCard();
  const [card, setCard] = useState(EMPTY_CARD);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof EMPTY_CARD) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setCard((current) => ({ ...current, [key]: event.target.value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!config.data) return;
    setError(null);
    setDone(false);
    try {
      // The number and CVV go to the provider tokenizer only; the API gets the token.
      const cardToken = await tokenizerFor(config.data)({
        ...card,
        document: profile.data?.document ?? '',
      });
      await save.mutateAsync({ cardToken, recurringConsent: true });
      setCard(EMPTY_CARD);
      setConsent(false);
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : 'Não foi possível salvar o cartão. Tente novamente.',
      );
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="bv-card space-y-space-md"
      aria-label="Adicionar cartão"
    >
      <h2 className="font-heading-mobile text-heading-mobile text-ink">Adicionar cartão</h2>
      {config.data?.provider === 'sandbox' ? (
        <Alert>Ambiente de demonstração: use qualquer número de cartão de teste.</Alert>
      ) : null}
      {done ? <Alert tone="success">Cartão salvo.</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Input
        label="Número do cartão"
        inputMode="numeric"
        autoComplete="cc-number"
        value={card.number}
        onChange={set('number')}
      />
      <Input
        label="Nome impresso no cartão"
        autoComplete="cc-name"
        value={card.holder}
        onChange={set('holder')}
      />
      <div className="grid grid-cols-3 gap-space-sm">
        <Input
          label="Mês"
          inputMode="numeric"
          maxLength={2}
          autoComplete="cc-exp-month"
          value={card.expMonth}
          onChange={set('expMonth')}
        />
        <Input
          label="Ano"
          inputMode="numeric"
          maxLength={4}
          autoComplete="cc-exp-year"
          value={card.expYear}
          onChange={set('expYear')}
        />
        <Input
          label="CVV"
          inputMode="numeric"
          maxLength={4}
          autoComplete="cc-csc"
          value={card.cvv}
          onChange={set('cvv')}
        />
      </div>
      <Checkbox
        label={CONSENT_TEXT}
        checked={consent}
        onChange={(event) => {
          setConsent(event.target.checked);
        }}
      />
      <Button
        type="submit"
        block
        disabled={!consent || !config.data || card.number.trim() === ''}
        loading={save.isPending}
      >
        Adicionar cartão
      </Button>
    </form>
  );
}

/** `/app/perfil/cartoes`: saved cards, removal with confirmation, tokenized add (NUC-194). */
export function CardsPage() {
  usePageTitle('Meus cartões');
  const cards = useCards();
  const remove = useDeleteCard();
  const [toRemove, setToRemove] = useState<SavedCard | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const confirmRemove = async () => {
    if (!toRemove) return;
    setRemoveError(null);
    try {
      await remove.mutateAsync(toRemove.id);
      setToRemove(null);
    } catch {
      setRemoveError('Não foi possível remover o cartão. Tente novamente.');
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-space-lg">
      <div className="space-y-space-xs">
        <Link
          to="/app/perfil"
          className="font-small text-small text-accent underline underline-offset-4"
        >
          Perfil
        </Link>
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
          Meus cartões
        </h1>
      </div>

      {cards.isPending ? (
        <Spinner label="Carregando cartões" />
      ) : cards.isError ? (
        <Alert tone="error">Não foi possível carregar seus cartões agora.</Alert>
      ) : cards.data.items.length === 0 ? (
        <p className="font-body text-body text-ink-muted">Você não tem cartões salvos.</p>
      ) : (
        <ul className="space-y-space-sm">
          {cards.data.items.map((card) => (
            <li
              key={card.id}
              className="flex items-center justify-between gap-space-md rounded-md bg-surface-raised py-space-sm pl-space-lg pr-space-sm font-small text-small text-ink shadow-card"
            >
              <span>{cardLabel(card)}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remover ${cardLabel(card)}`}
                onClick={() => {
                  setToRemove(card);
                }}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AddCardForm />

      <Modal
        open={toRemove !== null}
        onClose={() => {
          setToRemove(null);
        }}
        title="Remover cartão"
      >
        <div className="space-y-space-md">
          <p className="font-small text-small text-ink">
            Remover {toRemove ? cardLabel(toRemove) : ''}? Ele não será mais cobrado.
          </p>
          {removeError ? <Alert tone="error">{removeError}</Alert> : null}
          <div className="bv-modal-actions flex-wrap">
            <Button
              variant="secondary"
              onClick={() => {
                setToRemove(null);
              }}
            >
              Manter cartão
            </Button>
            <Button loading={remove.isPending} onClick={() => void confirmRemove()}>
              Confirmar remoção
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
