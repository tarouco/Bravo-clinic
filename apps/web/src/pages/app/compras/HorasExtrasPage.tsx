import { extraLotSourceLabel, formatBRL, type ExtraHoursPurchaseInput } from '@bravo/core';
import { Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CreditsToggleView } from '../../../components/revenue/CreditsToggle';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { PaymentMethodPanel, type PayChoice } from '../../../features/payments/PaymentMethodPanel';
import { useCredits, useExtraHours, usePurchaseExtraHours } from '../../../features/purchases/api';
import { formatDay, formatMinutes } from '../../../features/purchases/format';
import type { ExtraHoursSummary } from '../../../features/purchases/types';
import { messageOf } from '../../../lib/api-errors';
import { newIdempotencyKey } from '../../../lib/query-string';

/** Lots with minutes left: "300 min · vence em 08/02/2027" (REC-62). */
function LotsList({ lots }: { lots: ExtraHoursSummary['lots'] }) {
  const open = lots.filter((lot) => lot.minutesRemaining > 0);
  if (open.length === 0) {
    return (
      <p className="font-small text-small text-ink-muted">Você não tem horas extras no momento.</p>
    );
  }
  return (
    <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface-raised">
      {open.map((lot) => (
        <li key={lot.id} className="flex flex-col gap-0.5 px-space-md py-space-sm">
          <span className="font-small text-small text-ink">
            {`${formatMinutes(lot.minutesRemaining)} · vence em ${formatDay(lot.expiresAt)}`}
          </span>
          <span className="font-caption text-caption text-ink-muted">
            {extraLotSourceLabel[lot.source]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Purchase({
  summary,
  unitPriceCents,
}: {
  summary: ExtraHoursSummary;
  unitPriceCents: number;
}) {
  const [hours, setHours] = useState(summary.minHours);
  const [creditsOn, setCreditsOn] = useState(false);
  const [bought, setBought] = useState<{ hours: number; lotIds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const credits = useCredits();
  const purchase = usePurchaseExtraHours();
  const watched = useExtraHours({ poll: bought !== null });
  // One Idempotency-Key per distinct attempt: retrying the same body replays the same key.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const totalCents = hours * unitPriceCents;
  const availableCredit = credits.data?.availableCents ?? 0;
  const appliedCredit = creditsOn ? Math.min(availableCredit, totalCents) : 0;
  const payNowCents = totalCents - appliedCredit;

  const confirmed =
    bought !== null && (watched.data?.lots ?? []).some((lot) => !bought.lotIds.includes(lot.id));

  const submit = async (choice: PayChoice) => {
    const body: ExtraHoursPurchaseInput = {
      hours,
      paymentMethod: choice.method,
      ...(choice.savedCardId ? { savedCardId: choice.savedCardId } : {}),
      ...(creditsOn ? { useCredits: true } : {}),
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) {
      attempt.current = { body: serialized, key: newIdempotencyKey() };
    }
    const result = await purchase.mutateAsync({ body, idempotencyKey: attempt.current.key });
    setBought({ hours, lotIds: summary.lots.map((lot) => lot.id) });
    return result;
  };

  const onPay = async (choice: PayChoice) => {
    const result = await submit(choice);
    if (!result.charge) throw new Error('A compra não gerou cobrança.');
    return result.charge;
  };

  const payWithCredits = async () => {
    setError(null);
    try {
      await submit({ method: 'pix' });
    } catch (caught) {
      setError(messageOf(caught, 'Não foi possível concluir a compra.'));
    }
  };

  if (confirmed && bought) {
    return (
      <Alert tone="success">
        <p className="font-medium">Horas extras compradas</p>
        <p>{`${String(bought.hours)} ${bought.hours === 1 ? 'hora foi somada' : 'horas foram somadas'} ao seu saldo de horas extras.`}</p>
      </Alert>
    );
  }

  const locked = bought !== null;
  return (
    <section aria-labelledby="extra-buy" className="space-y-space-md">
      <h2 id="extra-buy" className="font-heading-mobile text-heading-mobile text-ink">
        Comprar horas extras
      </h2>
      <div role="group" aria-label="Quantidade de horas" className="flex items-center gap-space-md">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Diminuir uma hora"
          className="w-10 px-0"
          disabled={locked || hours <= summary.minHours}
          onClick={() => {
            setHours((current) => Math.max(summary.minHours, current - 1));
          }}
        >
          <Icon as={Minus} />
        </Button>
        <output
          aria-live="polite"
          className="min-w-16 text-center font-heading-mobile text-heading-mobile text-ink"
        >
          {`${String(hours)} ${hours === 1 ? 'hora' : 'horas'}`}
        </output>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Aumentar uma hora"
          className="w-10 px-0"
          disabled={locked || hours >= summary.maxHours}
          onClick={() => {
            setHours((current) => Math.min(summary.maxHours, current + 1));
          }}
        >
          <Icon as={Plus} />
        </Button>
      </div>
      <p className="font-body text-body text-ink">
        {`${String(hours)} × ${formatBRL(unitPriceCents)} = ${formatBRL(totalCents)}`}
      </p>
      <p className="font-small text-small text-ink-muted">
        {`De ${String(summary.minHours)} a ${String(summary.maxHours)} horas por compra.`}
      </p>

      {!locked ? (
        <CreditsToggleView
          availableCents={availableCredit}
          appliedCents={appliedCredit}
          checked={creditsOn}
          onChange={setCreditsOn}
        />
      ) : null}

      {appliedCredit > 0 ? (
        <p className="font-small text-small text-ink">{`Pagar agora: ${formatBRL(payNowCents)}`}</p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {payNowCents > 0 ? (
        <PaymentMethodPanel amountCents={payNowCents} onPay={onPay} />
      ) : (
        <Button
          loading={purchase.isPending}
          disabled={locked}
          onClick={() => void payWithCredits()}
        >
          Pagar com créditos
        </Button>
      )}
      {locked ? (
        <p role="status" className="font-small text-small text-ink-muted">
          Aguardando a confirmação do pagamento…
        </p>
      ) : null}
    </section>
  );
}

/**
 * `/app/compras/horas-extras`: buy extra hours at the package's hourly value and list the lots
 * with their expiry. Tenants without an active hour package go back to Compras (REC-63, REC-69).
 */
export function HorasExtrasPage() {
  const extra = useExtraHours();

  if (extra.isPending) {
    return (
      <div className="flex justify-center py-space-2xl">
        <Spinner label="Carregando horas extras" />
      </div>
    );
  }
  if (extra.isError)
    return <Alert tone="error">Não foi possível carregar suas horas extras agora.</Alert>;
  const summary = extra.data;
  if (!summary.eligible || summary.unitPriceCents === undefined) {
    return <Navigate to="/app/compras" replace />;
  }

  return (
    <div className="space-y-space-xl">
      <section aria-labelledby="extra-lots" className="space-y-space-sm">
        <h2 id="extra-lots" className="font-heading-mobile text-heading-mobile text-ink">
          Suas horas extras
        </h2>
        <LotsList lots={summary.lots} />
      </section>
      <Purchase summary={summary} unitPriceCents={summary.unitPriceCents} />
    </div>
  );
}
