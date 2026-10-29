import {
  formatBRL,
  utcToLocal,
  type LocalDate,
  type SubscriptionPurchaseInput,
  type SubscriptionQuoteInput,
} from '@bravo/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CouponFieldView } from '../../components/revenue/CouponField';
import { CreditsToggleView } from '../../components/revenue/CreditsToggle';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Checkbox } from '../../components/ui/form';
import { Stepper } from '../../components/ui/Stepper';
import { useSession } from '../../features/auth/useSession';
import {
  purchaseKeys,
  useOccurrenceCheck,
  usePackages,
  usePurchaseSubscription,
  useSubscription,
  useSubscriptionQuote,
} from '../../features/purchases/api';
import { FixedSchedulePicker, PICKER_PARAMS } from '../../features/purchases/FixedSchedulePicker';
import {
  formatIncludedHours,
  formatPeriodPrice,
  formatWeekdayDate,
  periodLabel,
} from '../../features/purchases/format';
import { StartDateCalendar } from '../../features/purchases/StartDateCalendar';
import {
  localSummary,
  periodText,
  renewalSentence,
  type SummaryValues,
} from '../../features/purchases/subscribe-summary';
import type { PackageOffer, Subscription } from '../../features/purchases/types';
import { useRooms } from '../../features/catalog/api';
import { PaymentMethodPanel, type PayChoice } from '../../features/payments/PaymentMethodPanel';
import { ApiError } from '../../lib/api';
import { track, valueBucketOf } from '../../lib/analytics';
import { newIdempotencyKey } from '../../lib/query-string';
import { usePageTitle } from '../../lib/usePageTitle';
import { NotFoundPage } from './NotFoundPage';

type Stage = 'pick' | 'summary' | 'pay';

const HOUR_STEPS = ['Resumo', 'Login', 'Pagamento'] as const;
const FIXED_STEPS = ['Sala e início', 'Resumo', 'Login', 'Pagamento'] as const;

/** REC-12 text, used when the API answers a 409 `CONFLICT` without a message. */
const HAS_PACKAGE_MESSAGE = 'Você já tem um pacote de horas. Use “Trocar pacote” em Compras.';

const COUPON_PARAM = 'cupom';
const CREDITS_PARAM = 'creditos';

interface ConflictLine {
  date: string | null;
  text: string;
}

/** Dates named by a 409 `OCCURRENCE_CONFLICT` (`details[]` = `{ path: 'date', message, date }`). */
function conflictLines(error: ApiError): ConflictLine[] {
  if (!Array.isArray(error.details)) return [];
  return error.details.map((detail) => {
    const date = (detail as { date?: unknown }).date;
    return { date: typeof date === 'string' ? date : null, text: detail.message };
  });
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-space-md py-space-xs">
      <dt className="font-small text-small text-ink-muted">{label}</dt>
      <dd className="text-right font-small text-small text-ink">{value}</dd>
    </div>
  );
}

interface FlowProps {
  offer: PackageOffer;
}

function SubscribeFlow({ offer }: FlowProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const { session, isLoading: sessionLoading } = useSession();
  const rooms = useRooms();
  const today = utcToLocal(new Date()).date;

  const fixed = offer.type === 'fixed_schedule';
  const roomId = params.get(PICKER_PARAMS.room);
  const baseOnParam = params.get(PICKER_PARAMS.baseOn);
  const baseOn = baseOnParam ?? (fixed ? null : today);
  const couponCode = params.get(COUPON_PARAM) ?? undefined;
  const useCredits = params.get(CREDITS_PARAM) === '1';

  const [stage, setStage] = useState<Stage>(() =>
    fixed && !(roomId && baseOnParam) ? 'pick' : 'summary',
  );
  const [accepted, setAccepted] = useState({ terms: false, recurring: false });
  const [couponError, setCouponError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictLine[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const setParam = (key: string, value: string | null) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const needsRoom = fixed && !roomId;
  const quoteRequest: SubscriptionQuoteInput | null =
    session && baseOn && !needsRoom
      ? {
          categoryId: offer.id,
          baseOn: baseOn as LocalDate,
          ...(roomId ? { roomId } : {}),
          ...(couponCode ? { couponCode } : {}),
          ...(useCredits ? { useCredits: true } : {}),
        }
      : null;
  const quoteQuery = useSubscriptionQuote(quoteRequest);
  const check = useOccurrenceCheck(fixed ? offer.id : undefined, {
    ...(roomId ? { roomId } : {}),
    ...(baseOn ? { baseOn } : {}),
  });

  // The quote needs a session; until we know whether there is one the summary waits.
  const values: SummaryValues | null = sessionLoading
    ? null
    : session
      ? (quoteQuery.data ?? null)
      : baseOn && !needsRoom
        ? localSummary(offer, baseOn, check.data)
        : null;
  const rejection = couponError ?? quoteQuery.data?.couponRejection?.message;
  const quoteConflicts = quoteQuery.data?.conflicts ?? check.data?.conflicts ?? [];
  const occurrenceCount = check.data?.occurrences.length ?? quoteQuery.data?.occurrenceCount ?? 0;
  const roomName = rooms.data?.items.find((room) => room.id === roomId)?.name;

  const steps = fixed ? FIXED_STEPS : HOUR_STEPS;
  const current = stage === 'pick' ? 0 : stage === 'summary' ? (fixed ? 1 : 0) : steps.length - 1;

  const bothAccepted = accepted.terms && accepted.recurring;
  const canContinue =
    values !== null &&
    bothAccepted &&
    quoteConflicts.length === 0 &&
    (!fixed || occurrenceCount > 0);

  /** The summary URL with every chosen option, so login brings the visitor back to the same choices. */
  const returnPath = () => {
    const next = new URLSearchParams(params);
    if (baseOn) next.set(PICKER_PARAMS.baseOn, baseOn);
    return `${pathname}?${next.toString()}`;
  };

  const goToPayment = () => {
    if (!session) {
      void navigate(`/login?next=${encodeURIComponent(returnPath())}`);
      return;
    }
    setBlocked(null);
    setStage('pay');
  };

  const onPurchaseError = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (error.code === 'OCCURRENCE_CONFLICT') {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.packages });
      setConflicts(conflictLines(error));
      setStage('pick');
    } else if (error.code === 'COUPON_INVALID' || error.code === 'COUPON_EXHAUSTED') {
      setCouponError(
        (Array.isArray(error.details) ? error.details[0]?.message : undefined) ?? error.message,
      );
      setStage('summary');
    } else if (error.status === 409 && error.code === 'CONFLICT') {
      setBlocked(error.message || HAS_PACKAGE_MESSAGE);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-space-xl px-gutter py-space-xl md:py-space-3xl">
      <header className="space-y-space-md">
        <h1 className="font-display text-display-l-mobile text-ink md:text-display-l">
          {`Assinar ${offer.name}`}
        </h1>
        <p className="font-small text-small text-ink-muted">
          {offer.type === 'hour_package'
            ? `${formatIncludedHours(offer.includedMinutes)} · ${periodLabel(offer.period)} · ${formatBRL(offer.priceCents)}`
            : `${periodLabel(offer.period)} · ${formatBRL(offer.pricePerOccurrenceCents)} por ocorrência`}
        </p>
        <Stepper label="Etapas da assinatura" steps={steps} current={current} />
      </header>

      {stage === 'pick' ? (
        <div className="space-y-space-lg">
          {conflicts ? (
            <Alert tone="error">
              <p className="font-medium">
                Alguns horários foram ocupados enquanto você finalizava a compra:
              </p>
              <ul className="mt-space-xs list-disc space-y-1 pl-space-md">
                {conflicts.map((line) => (
                  <li key={`${line.date ?? ''}${line.text}`}>
                    {line.date ? `${formatWeekdayDate(line.date)}: ${line.text}` : line.text}
                  </li>
                ))}
              </ul>
              <p className="mt-space-xs">Escolha outra sala ou outra data de início.</p>
            </Alert>
          ) : null}
          <FixedSchedulePicker
            categoryId={offer.id}
            pricePerOccurrenceCents={fixed ? offer.pricePerOccurrenceCents : undefined}
            onContinue={() => {
              setConflicts(null);
              setStage('summary');
            }}
          />
        </div>
      ) : null}

      {stage === 'summary' ? (
        <div className="space-y-space-lg">
          {!fixed ? (
            <section aria-labelledby="sub-base" className="space-y-space-sm">
              <h2
                id="sub-base"
                className="font-heading text-heading-mobile text-ink md:text-heading"
              >
                Data de início
              </h2>
              <StartDateCalendar
                value={baseOn}
                onSelect={(date) => {
                  setParam(PICKER_PARAMS.baseOn, date);
                }}
              />
            </section>
          ) : (
            <section className="bv-card flex flex-wrap items-center justify-between gap-space-sm py-space-md">
              <p className="font-small text-small text-ink">
                {`${roomName ?? 'Sala escolhida'} · início em ${baseOn ? formatWeekdayDate(baseOn) : ''}`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStage('pick');
                }}
              >
                Alterar sala ou data
              </Button>
            </section>
          )}

          <section aria-labelledby="sub-summary" className="space-y-space-md">
            <h2
              id="sub-summary"
              className="font-heading text-heading-mobile text-ink md:text-heading"
            >
              Resumo
            </h2>
            {quoteQuery.isError ? (
              <Alert tone="error">
                {quoteQuery.error instanceof ApiError
                  ? quoteQuery.error.message
                  : 'Não foi possível calcular o valor agora.'}
              </Alert>
            ) : values === null ? (
              <Spinner label="Calculando o valor" />
            ) : (
              <>
                <dl className="divide-y divide-hairline rounded-md bg-surface-raised px-5 shadow-card">
                  <SummaryRow label="Pacote" value={offer.name} />
                  <SummaryRow label="Período" value={periodText(values)} />
                  {fixed && occurrenceCount > 0 ? (
                    <SummaryRow
                      label="Ocorrências"
                      value={formatPeriodPrice(occurrenceCount, offer.pricePerOccurrenceCents)}
                    />
                  ) : null}
                  <SummaryRow label="Preço" value={formatBRL(values.priceCents)} />
                  {values.discountCents > 0 ? (
                    <SummaryRow label="Desconto" value={`− ${formatBRL(values.discountCents)}`} />
                  ) : null}
                  {values.creditAppliedCents > 0 ? (
                    <SummaryRow
                      label="Créditos"
                      value={`− ${formatBRL(values.creditAppliedCents)}`}
                    />
                  ) : null}
                  <SummaryRow label="Pagar agora" value={formatBRL(values.payNowCents)} />
                </dl>
                <p className="font-small text-small text-ink">{renewalSentence(offer, values)}</p>
              </>
            )}

            {quoteConflicts.length > 0 ? (
              <Alert tone="error">
                <p className="font-medium">Alguns horários não estão disponíveis:</p>
                <ul className="mt-space-xs list-disc space-y-1 pl-space-md">
                  {quoteConflicts.map((conflict) => (
                    <li key={conflict.date}>
                      {formatWeekdayDate(conflict.date)}: {conflict.label}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-space-sm"
                  onClick={() => {
                    setStage('pick');
                  }}
                >
                  Escolher outra sala ou data
                </Button>
              </Alert>
            ) : null}
          </section>

          {session ? (
            <div className="space-y-space-md">
              <CouponFieldView
                appliedCode={couponCode}
                discountCents={values?.discountCents ?? 0}
                rejectionMessage={rejection}
                onApply={(code) => {
                  setCouponError(null);
                  setParam(COUPON_PARAM, code);
                }}
                onRemove={() => {
                  setCouponError(null);
                  setParam(COUPON_PARAM, null);
                }}
              />
              <CreditsToggleView
                availableCents={values?.creditAvailableCents ?? 0}
                appliedCents={values?.creditAppliedCents ?? 0}
                checked={useCredits}
                onChange={(checked) => {
                  setParam(CREDITS_PARAM, checked ? '1' : null);
                }}
              />
            </div>
          ) : (
            <p className="font-small text-small text-ink-muted">
              Cupom e créditos ficam disponíveis depois que você entrar na sua conta.
            </p>
          )}

          <div className="space-y-space-sm">
            <Checkbox
              label={
                <>
                  Li e aceito os{' '}
                  <Link
                    to="/termos"
                    className="text-accent underline underline-offset-4 hover:text-accent-deep"
                  >
                    Termos de uso
                  </Link>{' '}
                  e as{' '}
                  <Link
                    to="/politicas"
                    className="text-accent underline underline-offset-4 hover:text-accent-deep"
                  >
                    políticas de cancelamento
                  </Link>
                  .
                </>
              }
              checked={accepted.terms}
              onChange={(event) => {
                setAccepted((current) => ({ ...current, terms: event.target.checked }));
              }}
            />
            <Checkbox
              label="Autorizo a cobrança recorrente automática deste pacote a cada período, até eu cancelar."
              checked={accepted.recurring}
              onChange={(event) => {
                setAccepted((current) => ({ ...current, recurring: event.target.checked }));
              }}
            />
          </div>

          <Button disabled={!canContinue} onClick={goToPayment}>
            Continuar para pagamento
          </Button>
        </div>
      ) : null}

      {stage === 'pay' && values ? (
        <PayStage
          offer={offer}
          values={values}
          quoteRequest={quoteRequest}
          blocked={blocked}
          onBack={() => {
            setBlocked(null);
            setStage('summary');
          }}
          onError={onPurchaseError}
        />
      ) : null}
    </div>
  );
}

interface PayStageProps {
  offer: PackageOffer;
  values: SummaryValues;
  quoteRequest: SubscriptionQuoteInput | null;
  /** Message of a 409 `CONFLICT`: replaces the payment form with a link to Compras. */
  blocked: string | null;
  onBack: () => void;
  onError: (error: unknown) => void;
}

/** Payment method, charge creation and the wait for the gateway to confirm the subscription. */
function PayStage({ offer, values, quoteRequest, blocked, onBack, onError }: PayStageProps) {
  const purchase = usePurchaseSubscription();
  const [purchased, setPurchased] = useState<Subscription | null>(null);
  const [zeroError, setZeroError] = useState<string | null>(null);
  // One Idempotency-Key per distinct attempt: retrying the same body replays the same key.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const watched = useSubscription(purchased?.id, { poll: purchased?.status !== 'active' });
  const status = watched.data?.status ?? purchased?.status;

  // The subscription is paid and active: one funnel event per purchase.
  const reported = useRef(false);
  useEffect(() => {
    if (status !== 'active' || reported.current) return;
    reported.current = true;
    track('subscription_purchased', {
      categoryType: offer.type,
      valueBucket: valueBucketOf(values.priceCents),
    });
  }, [status, offer.type, values.priceCents]);

  const submit = async (choice: PayChoice) => {
    if (!quoteRequest) throw new Error('Quote missing');
    const body: SubscriptionPurchaseInput = {
      ...quoteRequest,
      paymentMethod: choice.method,
      ...(choice.savedCardId ? { savedCardId: choice.savedCardId } : {}),
      acceptTerms: true,
      acceptRecurring: true,
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) {
      attempt.current = { body: serialized, key: newIdempotencyKey() };
    }
    try {
      const result = await purchase.mutateAsync({ body, idempotencyKey: attempt.current.key });
      setPurchased(result.subscription);
      return result;
    } catch (error) {
      onError(error);
      throw error;
    }
  };

  const onPay = async (choice: PayChoice) => {
    const result = await submit(choice);
    if (!result.charge) throw new Error('A assinatura não gerou cobrança.');
    return result.charge;
  };

  const confirmWithoutPayment = async () => {
    setZeroError(null);
    try {
      await submit({ method: 'pix' });
    } catch (error) {
      setZeroError(
        error instanceof ApiError ? error.message : 'Não foi possível confirmar a assinatura.',
      );
    }
  };

  if (blocked) {
    return (
      <div className="space-y-space-md">
        <Alert tone="error">
          <p>{blocked}</p>
        </Alert>
        <Button asChild>
          <Link to="/app/compras">Ir para Compras</Link>
        </Button>
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div className="space-y-space-lg">
        <Alert tone="success">
          <p className="font-medium">Assinatura ativa</p>
          <p>{`Seu ${offer.name} já está valendo. Enviamos os detalhes para o seu e-mail.`}</p>
        </Alert>
        <Button asChild>
          <Link to="/app/compras">Ver minhas compras</Link>
        </Button>
      </div>
    );
  }

  const payNow = values.payNowCents;
  return (
    <section aria-labelledby="sub-pay" className="bv-card space-y-space-md">
      <h2 id="sub-pay" className="font-heading text-heading-mobile text-ink md:text-heading">
        {payNow > 0 ? `Pagamento de ${formatBRL(payNow)}` : 'Confirmar assinatura'}
      </h2>
      {status === 'expired' ? (
        <Alert tone="error">O prazo para pagar terminou. Volte ao resumo e tente novamente.</Alert>
      ) : null}
      {payNow > 0 ? (
        <PaymentMethodPanel amountCents={payNow} onPay={onPay} />
      ) : (
        <div className="space-y-space-sm">
          <p className="font-small text-small text-ink-muted">
            Nada a pagar agora: o desconto e os créditos cobrem este período.
          </p>
          {zeroError ? <Alert tone="error">{zeroError}</Alert> : null}
          <Button loading={purchase.isPending} onClick={() => void confirmWithoutPayment()}>
            Confirmar assinatura
          </Button>
        </div>
      )}
      {purchased ? (
        <p role="status" className="font-small text-small text-ink-muted">
          Aguardando a confirmação do pagamento…
        </p>
      ) : (
        <Button variant="ghost" size="sm" onClick={onBack}>
          Voltar ao resumo
        </Button>
      )}
    </section>
  );
}

/** `/assinar/:categoryId`: summary, login and payment of an hour package or a fixed schedule. */
export function SubscribePage() {
  usePageTitle('Assinar');
  const { categoryId } = useParams();
  const packages = usePackages();

  if (packages.isPending) {
    return (
      <div className="flex justify-center py-space-hero">
        <Spinner label="Carregando o pacote" />
      </div>
    );
  }
  const offer = packages.data?.items.find((candidate) => candidate.id === categoryId);
  if (!offer) {
    return packages.isError ? (
      <div className="mx-auto max-w-3xl px-gutter py-space-3xl">
        <Alert tone="error">Não foi possível carregar o pacote agora.</Alert>
      </div>
    ) : (
      <NotFoundPage />
    );
  }
  return <SubscribeFlow offer={offer} />;
}
