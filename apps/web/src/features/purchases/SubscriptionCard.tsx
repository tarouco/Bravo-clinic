import { formatBRL, subscriptionStatusLabel, type SubscriptionStatus } from '@bravo/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BalanceMeter } from '../../components/revenue/BalanceMeter';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { formatLocalDateBR } from '../../lib/format';
import { formatDateTime, formatWeekdayRange, formatWindow } from './format';
import type { PackageOffer, Subscription } from './types';

const TONES: Record<SubscriptionStatus, BadgeTone> = {
  awaiting_payment: 'champagne',
  active: 'bronze',
  suspended: 'error',
  ended: 'neutral',
  cancelled: 'neutral',
  switched: 'neutral',
  expired: 'neutral',
};

export interface SubscriptionCardProps {
  subscription: Subscription;
  /** Public offer of the same category: gives a fixed schedule its weekdays and window. */
  offer?: PackageOffer | undefined;
  onSwitch?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onLedger?: (() => void) | undefined;
}

/** "30/11/2026 · R$ 1.600,00 · cartão final 4242" (Pix when the next charge is a Pix). */
function nextChargeText(charge: NonNullable<Subscription['nextCharge']>): string {
  const method =
    charge.method === 'saved_card' && charge.cardLast4
      ? `cartão final ${charge.cardLast4}`
      : charge.method === 'saved_card'
        ? 'cartão salvo'
        : 'Pix';
  return `${formatLocalDateBR(charge.on)} · ${formatBRL(charge.amountCents)} · ${method}`;
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

/** One subscription of `/app/compras`: status, base date, next charge, balance and its actions (REC-143, REC-144). */
export function SubscriptionCard({
  subscription,
  offer,
  onSwitch,
  onCancel,
  onLedger,
}: SubscriptionCardProps) {
  const { status, category, room, balance, occurrences, nextCharge, currentPeriod } = subscription;
  const payPath = `/app/compras/assinaturas/${subscription.id}/pagar`;
  const fixedOffer = offer?.type === 'fixed_schedule' ? offer : undefined;

  return (
    <Card>
      <div className="space-y-space-md">
        <div className="flex flex-wrap items-start justify-between gap-space-sm">
          <h2 className="font-h3 text-h3 text-ink">{category.name}</h2>
          <Badge tone={TONES[status]}>{subscriptionStatusLabel[status]}</Badge>
        </div>

        <dl className="grid gap-space-md sm:grid-cols-2">
          <Detail label="Início">{formatLocalDateBR(subscription.baseOn)}</Detail>
          {currentPeriod ? (
            <Detail label="Período atual">
              {`${formatLocalDateBR(currentPeriod.startsOn)} a ${formatLocalDateBR(currentPeriod.endsOn)}`}
            </Detail>
          ) : null}
          {nextCharge ? (
            <Detail label="Próxima cobrança">{nextChargeText(nextCharge)}</Detail>
          ) : null}
          {room ? <Detail label="Sala">{room.name}</Detail> : null}
          {fixedOffer ? (
            <Detail label="Horário">
              {`${formatWeekdayRange(fixedOffer.weekdays)} · ${formatWindow(fixedOffer.startMinute, fixedOffer.endMinute)}`}
            </Detail>
          ) : null}
        </dl>

        {subscription.type === 'hour_package' && balance ? (
          <BalanceMeter
            packageMinutes={balance.packageMinutes}
            includedMinutes={balance.includedMinutes}
            extraMinutes={balance.extraMinutes}
          />
        ) : null}
        {subscription.type === 'fixed_schedule' && occurrences ? (
          <p className="font-small text-small text-ink">
            {`${String(occurrences.remainingInPeriod)} ${occurrences.remainingInPeriod === 1 ? 'ocorrência restante' : 'ocorrências restantes'} no período`}
            {occurrences.next ? ` · próxima em ${formatDateTime(occurrences.next.startsAt)}` : ''}
          </p>
        ) : null}

        {status === 'awaiting_payment' && subscription.holdExpiresAt ? (
          <p className="font-small text-small text-ink-muted">
            {`Pague até ${formatDateTime(subscription.holdExpiresAt)} para garantir o pacote.`}
          </p>
        ) : null}
        {status === 'suspended' ? (
          <p className="font-small text-small text-ink-muted">
            A renovação não foi paga e a assinatura está suspensa. Regularize para voltar a usar.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-space-sm">
          {status === 'active' ? (
            <>
              <Button variant="secondary" size="sm" onClick={onSwitch}>
                Trocar
              </Button>
              <Button variant="secondary" size="sm" onClick={onCancel}>
                Cancelar
              </Button>
              <Button variant="ghost" size="sm" onClick={onLedger}>
                Extrato
              </Button>
            </>
          ) : null}
          {status === 'suspended' ? (
            <Button asChild size="sm">
              <Link to={payPath}>Regularizar</Link>
            </Button>
          ) : null}
          {status === 'awaiting_payment' ? (
            <Button asChild size="sm">
              <Link to={payPath}>Pagar</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
