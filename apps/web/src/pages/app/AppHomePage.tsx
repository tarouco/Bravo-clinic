import type { BookingSummary } from '@bravo/core';
import { Link, useLocation } from 'react-router-dom';
import { Eyebrow } from '../../components/ui/Brand';
import { Button, buttonClasses } from '../../components/ui/Button';
import { cx, focusRing } from '../../components/ui/cx';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { useMyBookings } from '../../features/booking/api';
import { BookingRow, RoomThumb } from '../../features/booking/BookingRow';
import { bookingWhen } from '../../lib/booking-time';
import { usePageTitle } from '../../lib/usePageTitle';

const HOME_LIMIT = 3;

/** The next booking: the screen's one colored card, emerald with the room photo tilted over it. */
function NextBookingCard({ booking }: { booking: BookingSummary }) {
  return (
    <Link
      to={`/app/minhas-reservas/${booking.id}`}
      className={cx('bv-card bv-card--emerald block min-h-44 pr-36', focusRing)}
    >
      <span className="block font-eyebrow text-eyebrow uppercase text-gold">Próxima reserva</span>
      <span className="bv-card-title mt-space-sm block text-heading font-light">
        {booking.roomName}
      </span>
      <span className="block font-caption text-caption text-on-emerald/85">
        {bookingWhen(booking.startsAt, booking.endsAt)}
      </span>
      <span className="block font-caption text-caption text-on-emerald/85">
        {booking.code} · {booking.statusLabel}
      </span>
      <span
        aria-hidden="true"
        className={cx(buttonClasses({ variant: 'gold', size: 'sm' }), 'mt-space-md')}
      >
        Ver
      </span>
      <RoomThumb
        slug={booking.roomSlug}
        className="absolute -bottom-4 -right-4 h-36 w-36 -rotate-[8deg] rounded-lg shadow-lift-3"
      />
    </Link>
  );
}

/** `/app`: the next three bookings and the way to book (NUC-191); e-mail banner after signup. */
export function AppHomePage() {
  usePageTitle('Minha área');
  const state = useLocation().state as { signupBanner?: boolean } | null;
  const upcoming = useMyBookings('upcoming');
  const items = (upcoming.data?.pages[0]?.items ?? []).slice(0, HOME_LIMIT);
  const [next, ...rest] = items;

  return (
    <div className="mx-auto max-w-3xl space-y-space-md">
      {state?.signupBanner ? (
        <Alert tone="info">Enviamos um link de confirmação para o seu e-mail.</Alert>
      ) : null}
      <header className="space-y-space-xs pb-space-xs">
        <Eyebrow>Minha área</Eyebrow>
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink lg:font-display-l lg:text-display-l">
          Próximas reservas
        </h1>
      </header>
      {upcoming.isPending ? (
        <Spinner label="Carregando reservas" />
      ) : upcoming.isError ? (
        <Alert tone="error">Não foi possível carregar suas reservas agora.</Alert>
      ) : !next ? (
        <p className="font-body text-body text-ink-muted">Você não tem reservas próximas.</p>
      ) : (
        <>
          <NextBookingCard booking={next} />
          {rest.length > 0 ? (
            <ul className="space-y-space-md">
              {rest.map((booking) => (
                <BookingRow key={booking.id} booking={booking} />
              ))}
            </ul>
          ) : null}
          <Link
            to="/app/minhas-reservas"
            className={cx(buttonClasses({ variant: 'link' }), 'font-small text-small')}
          >
            Ver todas as reservas
          </Link>
        </>
      )}
      <Button asChild block>
        <Link to="/app/reservar">Reservar</Link>
      </Button>
    </div>
  );
}
