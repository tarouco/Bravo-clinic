import type { CreateBookingInput, LocalDate, QuoteRequest } from '@bravo/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookingSummary } from '../../components/booking/BookingSummary';
import { PolicyAcceptance } from '../../components/booking/PolicyAcceptance';
import { whatsappHref } from '../../components/layout/WhatsAppButton';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Slot } from '../../extensions/slots';
import { ApiError } from '../../lib/api';
import { track, valueBucketOf } from '../../lib/analytics';
import { newIdempotencyKey } from '../../lib/query-string';
import { useSession } from '../auth/useSession';
import { availabilityKeys, useDayAvailability } from '../availability/api';
import { useCatalog, catalogKeys, usePolicies } from '../catalog/api';
import { useClinicConfig } from '../config/useClinicConfig';
import { bookingKeys, useCreateBooking, useQuote } from './api';
import { optionsToRequest, type CheckoutOptions } from './checkout-options';
import type { FlowSelection } from './flow-params';

export interface SummaryStepProps {
  selection: FlowSelection;
  onBack: () => void;
  /** Goes back to Horário; `notice` explains why (shown above the step). */
  onChooseAnotherTime: (notice?: string) => void;
}

/** Quote request for the selection; a block is priced over the window the API reports for it. */
function useQuoteRequest(
  selection: FlowSelection,
  addons: Record<string, unknown>,
  options: CheckoutOptions,
) {
  const day = useDayAvailability(selection.sala ?? undefined, selection.data ?? undefined);
  const { sala, data, bloco, inicio, fim } = selection;
  if (!sala || !data) return { request: null, pending: false };

  let startMinute = inicio;
  let endMinute = fim;
  if (bloco) {
    const option = day.data?.blockOptions.find((candidate) => candidate.categoryId === bloco);
    startMinute = option?.startMinute ?? null;
    endMinute = option?.endMinute ?? null;
  }
  if (startMinute === null || endMinute === null) {
    return { request: null, pending: Boolean(bloco) && day.isPending };
  }
  const request: QuoteRequest = {
    roomSlug: sala,
    date: data as LocalDate,
    startMinute,
    endMinute,
    ...(bloco ? { blockCategoryId: bloco } : {}),
    ...optionsToRequest(options),
    ...(Object.keys(addons).length > 0 ? { addons } : {}),
  };
  return { request, pending: false };
}

const apiMessage = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

/** Step 3, "Resumo": calculation memory, policy acceptance and booking creation (NUC-100/101). */
export function SummaryStep({ selection, onBack, onChooseAnotherTime }: SummaryStepProps) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const queryClient = useQueryClient();
  const { session, isLoading: sessionLoading } = useSession();
  const { whatsappE164 } = useClinicConfig();

  const [addons, setAddons] = useState<Record<string, unknown>>({});
  // Coupon, credits and "pagar com pacote" chosen in the extension slots (receita).
  const [options, setOptions] = useState<CheckoutOptions>({});
  const changeOptions = (patch: CheckoutOptions) => {
    setOptions((current) => ({ ...current, ...patch }));
  };
  const { request, pending } = useQuoteRequest(selection, addons, options);
  const quoteQuery = useQuote(request);
  const catalog = useCatalog();
  const policies = usePolicies();
  const createBooking = useCreateBooking();

  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // One Idempotency-Key per distinct attempt: a retry of the same body replays the same key.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const quote = quoteQuery.data;
  const resumoUrl = `${pathname}${search}`;
  const pricesReviewed = catalog.data?.pricesReviewed ?? true;
  const ready = Boolean(quote) && Boolean(policies.data);
  const canContinue = ready && accepted && pricesReviewed && !createBooking.isPending;

  const refreshAfterConflict = () => {
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
    void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
  };

  const handleError = (error: unknown) => {
    setFormError(null);
    setNotice(null);
    if (!(error instanceof ApiError)) {
      setFormError('Não foi possível criar a reserva. Tente novamente.');
      return;
    }
    switch (error.code) {
      case 'PROFILE_INCOMPLETE':
        void navigate(`/app/perfil?completar=1&next=${encodeURIComponent(resumoUrl)}`);
        return;
      case 'SLOT_TAKEN':
        refreshAfterConflict();
        onChooseAnotherTime('Este horário acabou de ser reservado.');
        return;
      case 'SLOT_UNAVAILABLE':
      case 'NO_CATEGORY':
        refreshAfterConflict();
        onChooseAnotherTime(error.message);
        return;
      case 'PRICE_CHANGED':
        setAccepted(false);
        setNotice(error.message);
        void queryClient.invalidateQueries({ queryKey: ['public', 'quote'] });
        return;
      case 'POLICY_CHANGED':
        setAccepted(false);
        setNotice(error.message);
        void queryClient.invalidateQueries({ queryKey: catalogKeys.policies });
        return;
      default:
        setFormError(error.message);
    }
  };

  const onContinue = async () => {
    if (!quote || !policies.data || !request) return;
    if (!session) {
      void navigate(`/login?next=${encodeURIComponent(resumoUrl)}`);
      return;
    }
    const body: CreateBookingInput = {
      ...request,
      acceptPolicy: true,
      policyVersion: policies.data.version,
      expectedTotalCents: quote.netCents,
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) {
      attempt.current = { body: serialized, key: newIdempotencyKey() };
    }
    setFormError(null);
    setNotice(null);
    try {
      const booking = await createBooking.mutateAsync({
        body,
        idempotencyKey: attempt.current.key,
      });
      track('begin_checkout', {
        roomSlug: request.roomSlug,
        valueBucket: valueBucketOf(booking.totalCents),
      });
      void navigate(`/checkout/${booking.id}`);
    } catch (error) {
      handleError(error);
    }
  };

  if (request === null && !pending) {
    return <Alert tone="error">Escolha o horário antes de ver o resumo.</Alert>;
  }
  if (pending || quoteQuery.isPending || policies.isPending) {
    return (
      <div className="flex justify-center py-space-xl">
        <Spinner label="Calculando o valor" />
      </div>
    );
  }

  if (quoteQuery.isError || !quote || policies.isError || !policies.data) {
    return (
      <div className="space-y-space-md">
        <Alert tone="error">
          {apiMessage(
            quoteQuery.error ?? policies.error,
            'Não foi possível calcular o valor agora.',
          )}
        </Alert>
        <Button variant="secondary" onClick={() => onChooseAnotherTime()}>
          Escolher outro horário
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-space-lg">
      {!pricesReviewed ? (
        <Alert>
          <span>Reservas online abrem em breve. Fale com a recepção pelo WhatsApp.</span>{' '}
          {whatsappE164 ? (
            <a className="underline underline-offset-4" href={whatsappHref(whatsappE164)}>
              Abrir WhatsApp
            </a>
          ) : null}
        </Alert>
      ) : null}
      {notice ? <Alert tone="error">{notice}</Alert> : null}

      <BookingSummary quote={quote} />

      {quote.notices.length > 0 ? (
        <ul className="space-y-space-xs font-small text-small text-ink-muted">
          {quote.notices.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      ) : null}

      <Slot
        name="checkout.summary.discount"
        props={{ quote, options, onOptionsChange: changeOptions }}
      />
      <Slot
        name="checkout.summary.credits"
        props={{ quote, options, onOptionsChange: changeOptions }}
      />
      <Slot
        name="checkout.summary.payWith"
        props={{ quote, options, onOptionsChange: changeOptions }}
      />
      <Slot name="checkout.summary.extras" props={{ draft: quote, onChange: setAddons }} />

      <PolicyAcceptance
        sections={policies.data.sections}
        version={policies.data.version}
        checked={accepted}
        onChange={setAccepted}
      />

      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <div className="flex flex-col-reverse gap-space-sm sm:flex-row">
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
        <Button
          block
          disabled={!canContinue || sessionLoading}
          loading={createBooking.isPending}
          onClick={() => void onContinue()}
        >
          Continuar para pagamento
        </Button>
      </div>
    </div>
  );
}
