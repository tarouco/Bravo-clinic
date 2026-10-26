import { chargeStatusLabel, formatBRL, type BookingDetail } from '@bravo/core';
import { Download, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookingSummary } from '../../components/booking/BookingSummary';
import { StatusBadge } from '../../components/booking/StatusBadge';
import { whatsappHref } from '../../components/layout/WhatsAppButton';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useBooking, usePayBalance } from '../../features/booking/api';
import { CancelModal } from '../../features/booking/CancelModal';
import { RescheduleModal } from '../../features/booking/RescheduleModal';
import { useClinicConfig } from '../../features/config/useClinicConfig';
import { PaymentMethodPanel, type PayChoice } from '../../features/payments/PaymentMethodPanel';
import { Slot } from '../../extensions/slots';
import { ApiError } from '../../lib/api';
import { usePageTitle } from '../../lib/usePageTitle';
import { NotFoundPage } from '../public/NotFoundPage';

const PURPOSE_LABEL: Record<string, string> = {
  booking_deposit: 'Sinal',
  booking_balance: 'Saldo',
  booking_full: 'Pagamento integral',
  booking_difference: 'Diferença do reagendamento',
};
const METHOD_LABEL: Record<string, string> = {
  pix: 'Pix',
  card: 'Cartão',
  saved_card: 'Cartão salvo',
  credit: 'Crédito',
};
const BLOCKED_TEXT: Record<string, string> = {
  too_late: 'O prazo para reagendar online terminou.',
  limit_reached: 'O limite de reagendamentos desta reserva foi atingido.',
  payment_mode: 'Esta reserva não pode ser reagendada online.',
  status: 'Esta reserva não pode mais ser reagendada.',
};

const dateTimeBR = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });

function Payments({ booking }: { booking: BookingDetail }) {
  if (booking.charges.length === 0 && booking.refunds.length === 0) return null;
  return (
    <section aria-labelledby="detail-payments" className="space-y-space-sm">
      <h2 id="detail-payments" className="font-heading-mobile text-heading-mobile text-ink">
        Pagamentos
      </h2>
      <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface-raised font-small text-small">
        {booking.charges.map((charge) => (
          <li
            key={charge.id}
            className="flex flex-wrap items-baseline justify-between gap-space-sm p-space-md"
          >
            <span className="text-ink">
              {PURPOSE_LABEL[charge.purpose] ?? 'Pagamento'} ·{' '}
              {METHOD_LABEL[charge.method] ?? charge.method} · {formatBRL(charge.amountCents)}
            </span>
            <span className="text-ink-muted">
              {chargeStatusLabel[charge.status]} ·{' '}
              {dateTimeBR(charge.approvedAt ?? charge.createdAt)}
            </span>
          </li>
        ))}
        {booking.refunds.map((refund) => (
          <li
            key={refund.id}
            className="flex flex-wrap items-baseline justify-between gap-space-sm p-space-md"
          >
            <span className="text-ink">Reembolso · {formatBRL(refund.amountCents)}</span>
            <span className="text-ink-muted">
              {refund.status === 'approved'
                ? 'Concluído'
                : refund.status === 'failed'
                  ? 'Falhou'
                  : 'Em andamento'}{' '}
              · {dateTimeBR(refund.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PayBalance({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const payBalance = usePayBalance(booking.id);
  const onPay = (choice: PayChoice) => payBalance.mutateAsync({ body: choice });
  return (
    <section aria-labelledby="detail-pay-balance" className="space-y-space-md">
      <h2 id="detail-pay-balance" className="font-heading-mobile text-heading-mobile text-ink">
        Pagar saldo de {formatBRL(booking.balanceCents)}
      </h2>
      <PaymentMethodPanel amountCents={booking.balanceCents} onPay={onPay} />
      <Button variant="ghost" size="sm" onClick={onClose}>
        Fechar pagamento
      </Button>
    </section>
  );
}

/** `/app/minhas-reservas/:id`: summary, payments, calendar file, pay balance, reschedule, cancel. */
export function BookingDetailPage() {
  const { id } = useParams();
  const [payingBalance, setPayingBalance] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { whatsappE164 } = useClinicConfig();

  // While a balance or difference payment is in flight the page follows the booking every 2 s.
  const query = useBooking(id, { poll: payingBalance });
  const booking = query.data;
  usePageTitle(booking ? `Reserva ${booking.code}` : 'Reserva');

  // The balance is settled (webhook processed): close the payment panel and say so.
  const balanceOpen = booking?.actions.canPayBalance ?? true;
  useEffect(() => {
    if (payingBalance && !balanceOpen) {
      setPayingBalance(false);
      setNotice('Saldo pago. Obrigado!');
    }
  }, [payingBalance, balanceOpen]);

  if (query.isPending) {
    return (
      <div className="flex justify-center py-space-hero">
        <Spinner label="Carregando reserva" />
      </div>
    );
  }
  if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundPage />;
  if (!booking) {
    return <Alert tone="error">Não foi possível carregar a reserva agora.</Alert>;
  }

  const { actions } = booking;
  const active = booking.status !== 'expired' && actions.canCancel;

  return (
    <div className="mx-auto max-w-3xl space-y-space-lg">
      <header className="space-y-space-xs">
        <Link
          to="/app/minhas-reservas"
          className="font-small text-small text-bronze underline underline-offset-4"
        >
          Minhas reservas
        </Link>
        <h1 className="font-heading text-heading-mobile text-ink md:text-heading">
          Reserva {booking.code}
        </h1>
        <StatusBadge status={booking.status} paymentStatus={booking.paymentStatus} />
      </header>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {booking.pendingReschedule ? (
        <Alert>
          Há um reagendamento aguardando o pagamento da diferença. Ele vale até{' '}
          {dateTimeBR(booking.pendingReschedule.expiresAt)}.
        </Alert>
      ) : null}

      <BookingSummary booking={booking} />
      <Payments booking={booking} />

      <div className="flex flex-wrap gap-space-sm">
        {actions.canPay ? (
          <Button asChild>
            <Link to={`/checkout/${booking.id}`}>Ir para o pagamento</Link>
          </Button>
        ) : null}
        {actions.canPayBalance && !payingBalance ? (
          <Button
            onClick={() => {
              setPayingBalance(true);
            }}
          >
            Pagar saldo
          </Button>
        ) : null}
        {actions.canReschedule ? (
          <Button
            variant="secondary"
            onClick={() => {
              setRescheduling(true);
            }}
          >
            Reagendar
          </Button>
        ) : null}
        {actions.canCancel ? (
          <Button
            variant="secondary"
            onClick={() => {
              setCancelling(true);
            }}
          >
            Cancelar reserva
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <a href={`/api/app/bookings/${booking.id}/ics`} download={`${booking.code}.ics`}>
            <Download aria-hidden="true" size={16} />
            Adicionar ao calendário
          </a>
        </Button>
      </div>

      {!actions.canReschedule && active ? (
        <div className="space-y-space-xs rounded-card border border-hairline bg-surface-stone p-space-md font-small text-small">
          <p className="text-ink">
            {BLOCKED_TEXT[actions.rescheduleBlockedReason ?? 'status'] ?? BLOCKED_TEXT['status']}
          </p>
          <a
            href={whatsappHref(whatsappE164)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-space-xs text-bronze underline underline-offset-4"
          >
            <MessageCircle aria-hidden="true" size={16} />
            Fale com a recepção
          </a>
        </div>
      ) : null}

      {payingBalance ? (
        <PayBalance
          booking={booking}
          onClose={() => {
            setPayingBalance(false);
          }}
        />
      ) : null}

      <section aria-labelledby="detail-policy" className="space-y-space-xs">
        <h2 id="detail-policy" className="font-heading-mobile text-heading-mobile text-ink">
          Política desta reserva
        </h2>
        <details className="rounded-card border border-hairline bg-surface-raised p-space-md font-small text-small text-ink-muted">
          <summary className="cursor-pointer text-ink">
            Ver política aceita (versão {booking.policy.version})
          </summary>
          <div className="mt-space-sm space-y-space-sm">
            {booking.policy.sections.map((section) => (
              <section key={section.title}>
                <h3 className="font-medium text-ink">{section.title}</h3>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>
        </details>
      </section>

      <Slot name="booking.detail.extra" props={{ booking }} />

      <RescheduleModal
        booking={booking}
        open={rescheduling}
        onClose={() => {
          setRescheduling(false);
        }}
        onRescheduled={({ creditCents }) => {
          setNotice(
            creditCents > 0
              ? `Reserva reagendada. Crédito de ${formatBRL(creditCents)} registrado.`
              : 'Reserva reagendada.',
          );
        }}
      />
      <CancelModal
        booking={booking}
        open={cancelling}
        onClose={() => {
          setCancelling(false);
        }}
        onCancelled={() => {
          setNotice('Reserva cancelada.');
        }}
      />
    </div>
  );
}
