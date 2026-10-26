import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useMyBookings } from '../../features/booking/api';
import { BookingRow } from '../../features/booking/BookingRow';
import { usePageTitle } from '../../lib/usePageTitle';

const HOME_LIMIT = 3;

/** `/app`: the next three bookings and the way to book (NUC-191); e-mail banner after signup. */
export function AppHomePage() {
  usePageTitle('Minha área');
  const state = useLocation().state as { signupBanner?: boolean } | null;
  const upcoming = useMyBookings('upcoming');
  const items = (upcoming.data?.pages[0]?.items ?? []).slice(0, HOME_LIMIT);

  return (
    <div className="mx-auto max-w-3xl space-y-space-lg">
      {state?.signupBanner ? (
        <Alert tone="info">Enviamos um link de confirmação para o seu e-mail.</Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="font-heading text-heading-mobile text-ink md:text-heading">
          Próximas reservas
        </h1>
        <Button asChild>
          <Link to="/app/reservar">Reservar</Link>
        </Button>
      </div>
      {upcoming.isPending ? (
        <Spinner label="Carregando reservas" />
      ) : upcoming.isError ? (
        <Alert tone="error">Não foi possível carregar suas reservas agora.</Alert>
      ) : items.length === 0 ? (
        <p className="font-body text-body text-ink-muted">Você não tem reservas próximas.</p>
      ) : (
        <ul className="space-y-space-sm">
          {items.map((booking) => (
            <BookingRow key={booking.id} booking={booking} />
          ))}
        </ul>
      )}
      {items.length > 0 ? (
        <Link
          to="/app/minhas-reservas"
          className="inline-block font-small text-small text-bronze underline underline-offset-4"
        >
          Ver todas as reservas
        </Link>
      ) : null}
    </div>
  );
}
