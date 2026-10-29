import { Link, Navigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useSession } from '../../features/auth/useSession';
import { useBooking, usePreReservation } from '../../features/booking/api';
import { ApiError } from '../../lib/api';
import { usePageTitle } from '../../lib/usePageTitle';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-gutter py-space-3xl">
      <div className="bv-card space-y-space-md rounded-xl sm:p-space-xl">{children}</div>
    </div>
  );
}

/**
 * `/pre-reserva/:token` (NUC-171): the link e-mailed to a customer for a staff-created booking.
 * Anonymous visitors log in first; the owner continues to the checkout of that booking.
 */
export function PreReservationPage() {
  usePageTitle('Pré-reserva');
  const { token } = useParams();
  const { session, isLoading: sessionLoading } = useSession();
  const preReservation = usePreReservation(token);
  const booking = useBooking(session ? preReservation.data?.bookingId : undefined);

  if (preReservation.isPending || sessionLoading) {
    return (
      <Centered>
        <Spinner label="Carregando pré-reserva" />
      </Centered>
    );
  }
  if (!preReservation.data) {
    const notFound =
      preReservation.error instanceof ApiError && preReservation.error.status === 404;
    return (
      <Centered>
        <Alert tone={notFound ? 'info' : 'error'}>
          {notFound
            ? 'Este link de pré-reserva não existe ou já expirou. Fale com a recepção.'
            : 'Não foi possível carregar a pré-reserva agora.'}
        </Alert>
        <Button asChild variant="secondary">
          <Link to="/contato">Falar com a recepção</Link>
        </Button>
      </Centered>
    );
  }
  if (!session) {
    return (
      <Navigate to={`/login?next=${encodeURIComponent(`/pre-reserva/${token ?? ''}`)}`} replace />
    );
  }
  if (booking.isPending) {
    return (
      <Centered>
        <Spinner label="Abrindo sua reserva" />
      </Centered>
    );
  }
  if (booking.error instanceof ApiError && booking.error.status === 404) {
    return (
      <Centered>
        <Alert tone="error">Este link pertence a outra conta.</Alert>
        <p className="font-small text-small text-ink-muted">
          Entre com a conta que recebeu o link para continuar.
        </p>
        <Button asChild variant="secondary">
          <Link to="/contato">Falar com a recepção</Link>
        </Button>
      </Centered>
    );
  }
  if (!booking.data) {
    return (
      <Centered>
        <Alert tone="error">Não foi possível abrir a reserva agora.</Alert>
      </Centered>
    );
  }
  return <Navigate to={`/checkout/${booking.data.id}`} replace />;
}
