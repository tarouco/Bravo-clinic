import { HOLDING_STATUSES, formatBRL, type BookingDetail } from '@bravo/core';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookingSummary } from '../../components/booking/BookingSummary';
import { PolicyAcceptance } from '../../components/booking/PolicyAcceptance';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useBooking, usePay } from '../../features/booking/api';
import { PaymentMethodPanel, type PayChoice } from '../../features/payments/PaymentMethodPanel';
import { ApiError } from '../../lib/api';
import { track, valueBucketOf } from '../../lib/analytics';
import { usePageTitle } from '../../lib/usePageTitle';
import { NotFoundPage } from './NotFoundPage';

const isHolding = (status: BookingDetail['status']): boolean =>
  (HOLDING_STATUSES as readonly string[]).includes(status);

/** Time left until `iso`, ticking every second; `null` when there is no deadline. */
function useCountdown(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (iso === null) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [iso]);
  return iso === null ? null : Math.max(0, new Date(iso).getTime() - now);
}

const clock = (ms: number): string => {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Where to pick a new time for the same room after a hold expired. */
const newTimePath = (booking: BookingDetail): string =>
  `/reservar?sala=${encodeURIComponent(booking.roomSlug)}`;

/** True the first time per browser tab, so reloading the confirmation does not count twice. */
function firstPurchaseReport(code: string): boolean {
  const key = `purchase-reported:${code}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {
    // Storage blocked: report anyway; the ref below still limits it to once per mount.
  }
  return true;
}

function Confirmed({ booking }: { booking: BookingDetail }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!firstPurchaseReport(booking.code)) return;
    track('purchase', {
      roomSlug: booking.roomSlug,
      paymentMethod: booking.charges.find((charge) => charge.status === 'approved')?.method,
      valueBucket: valueBucketOf(booking.paidCents),
    });
  }, [booking.code, booking.paidCents, booking.roomSlug, booking.charges]);

  return (
    <div className="space-y-space-lg">
      <Alert tone="success">
        <p className="font-medium">Reserva confirmada</p>
        <p>
          Código <strong>{booking.code}</strong>. Enviamos os detalhes e o convite de calendário
          para o seu e-mail.
        </p>
      </Alert>
      <BookingSummary booking={booking} />
      <Button asChild>
        <Link to="/app/minhas-reservas">Ver minhas reservas</Link>
      </Button>
    </div>
  );
}

function Expired({ booking }: { booking: BookingDetail }) {
  return (
    <div className="space-y-space-md">
      <Alert tone="error">Tempo esgotado. O horário foi liberado.</Alert>
      <Button asChild>
        <Link to={newTimePath(booking)}>Escolher outro horário</Link>
      </Button>
    </div>
  );
}

function PayStep({ booking }: { booking: BookingDetail }) {
  const pay = usePay(booking.id);
  const remaining = useCountdown(booking.holdExpiresAt);
  const staffCreated = booking.source === 'admin' || booking.source === 'mcp';
  const [accepted, setAccepted] = useState(false);

  const latest = [...booking.charges].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const rejectedChargeId = latest?.status === 'rejected' ? latest.id : null;
  const payNowCents =
    booking.paymentMode === 'deposit_balance'
      ? booking.depositCents
      : booking.totalCents - booking.creditAppliedCents;

  const onPay = (choice: PayChoice) =>
    pay.mutateAsync({
      body: {
        ...choice,
        ...(staffCreated ? { acceptPolicy: true, policyVersion: booking.policy.version } : {}),
      },
    });

  if (remaining === 0) return <Expired booking={booking} />;

  return (
    <div className="space-y-space-lg">
      {remaining !== null ? (
        <p aria-live="off" className="font-small text-small text-ink-muted">
          Tempo para pagar: <strong className="text-ink">{clock(remaining)}</strong>. Depois disso o
          horário é liberado.
        </p>
      ) : null}
      <BookingSummary booking={booking} />
      {staffCreated ? (
        <PolicyAcceptance
          sections={booking.policy.sections}
          version={booking.policy.version}
          checked={accepted}
          onChange={setAccepted}
        />
      ) : null}
      <section aria-labelledby="checkout-pay" className="space-y-space-md">
        <h2 id="checkout-pay" className="font-heading-mobile text-heading-mobile text-ink">
          Pagamento de {formatBRL(payNowCents)}
        </h2>
        <PaymentMethodPanel
          amountCents={payNowCents}
          onPay={onPay}
          rejectedChargeId={rejectedChargeId}
          disabled={staffCreated && !accepted}
        />
      </section>
    </div>
  );
}

/** `/checkout/:bookingId`: countdown, payment methods, 2 s status polling, confirmation. */
export function CheckoutPage() {
  usePageTitle('Pagamento');
  const { bookingId } = useParams();
  const [poll, setPoll] = useState(true);
  const query = useBooking(bookingId, { poll });
  const booking = query.data;

  // Stop polling once the booking leaves the holding statuses (confirmed, expired, cancelled).
  const holding = booking ? isHolding(booking.status) : true;
  useEffect(() => {
    if (!holding) setPoll(false);
  }, [holding]);

  if (query.isPending) {
    return (
      <div className="flex justify-center py-space-hero">
        <Spinner label="Carregando reserva" />
      </div>
    );
  }
  if (query.error instanceof ApiError && query.error.status === 404) return <NotFoundPage />;
  if (!booking) {
    return (
      <div className="mx-auto max-w-3xl px-gutter py-space-3xl">
        <Alert tone="error">Não foi possível carregar a reserva agora.</Alert>
      </div>
    );
  }

  let body;
  if (booking.status === 'confirmed' || booking.status === 'paid') {
    body = <Confirmed booking={booking} />;
  } else if (booking.status === 'expired') {
    body = <Expired booking={booking} />;
  } else if (isHolding(booking.status)) {
    body = <PayStep booking={booking} />;
  } else {
    body = (
      <div className="space-y-space-md">
        <Alert>Esta reserva não está aguardando pagamento.</Alert>
        <Button asChild variant="secondary">
          <Link to="/app/minhas-reservas">Ver minhas reservas</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-space-xl px-gutter py-space-xl md:py-space-3xl">
      <header className="space-y-space-xs">
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l">
          Pagamento
        </h1>
        <p className="font-small text-small text-ink-muted">Reserva {booking.code}</p>
      </header>
      {body}
    </div>
  );
}
