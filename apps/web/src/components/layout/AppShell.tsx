import { appNav, type AppNavItem } from '@bravo/core';
import {
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Circle,
  LogOut,
  ShoppingBag,
  User,
  type LucideIcon,
} from 'lucide-react';
import { Fragment } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useResendVerification } from '../../features/auth/hooks';
import { useSession } from '../../features/auth/useSession';
import { useSignOut } from '../../features/auth/useSignOut';
import { usePageViews } from '../../lib/analytics';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { BrandLockup } from '../ui/Brand';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Feedback';
import { Icon } from '../ui/Icon';

/** `appNav` names its icons as strings so that core stays free of UI imports. */
const NAV_ICONS: Record<string, LucideIcon> = {
  CalendarPlus,
  CalendarCheck,
  CalendarDays,
  ShoppingBag,
  User,
};

function NavIcon({ item }: { item: AppNavItem }) {
  return <Icon as={NAV_ICONS[item.icon] ?? Circle} />;
}

function EmailVerificationBanner() {
  const resend = useResendVerification();

  return (
    <Alert tone="info" className="mx-auto mb-space-md max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <span>Confirme seu e-mail para reservar.</span>
        <Button
          variant="secondary"
          size="sm"
          loading={resend.isPending}
          onClick={() => resend.mutate()}
        >
          Reenviar e-mail
        </Button>
      </div>
      {resend.isSuccess ? (
        <p className="mt-space-xs">Enviamos um novo link para o seu e-mail.</p>
      ) : null}
      {resend.isError ? (
        <p className="mt-space-xs">Não foi possível reenviar o e-mail. Tente novamente.</p>
      ) : null}
    </Alert>
  );
}

/** The booking entry of `appNav` becomes the tab bar's FAB ("nova reserva", guias/TabBar.md). */
const isBooking = (item: AppNavItem): boolean => item.icon === 'CalendarPlus';

/**
 * Tenant area shell (PWA): a floating pearl NavBar on top (links from `lg`), content in a 768px
 * column on the névoa stage, and below `lg` a glass TabBar 14px above the bottom edge with four
 * icon tabs and the emerald FAB for a new booking.
 */
export function AppShell() {
  usePageViews();
  const { session } = useSession();
  const { signOut, isPending, failed } = useSignOut();
  const firstName = session?.name.trim().split(/\s+/)[0];
  const tabs = appNav.filter((item) => !isBooking(item));
  const booking = appNav.find(isBooking);
  const middle = Math.floor(tabs.length / 2);

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="pointer-events-none sticky top-0 z-40 px-4 pt-3 lg:pt-4">
        <div className="bv-navbar pointer-events-auto mx-auto max-w-[1180px] gap-space-sm pl-5 sm:pl-6">
          <Link
            to="/app"
            className="rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <BrandLockup variant="header" />
            <span className="sr-only">, início da minha área</span>
          </Link>
          <span className="bv-navbar-spacer" />
          <nav aria-label="Menu lateral" className="hidden items-center gap-1 lg:flex">
            {appNav.map((item) => (
              <NavLink key={item.path} to={item.path} className="bv-navbar-link">
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="bv-navbar-spacer hidden lg:block" />
          {firstName ? (
            <span className="hidden font-small text-small text-ink-muted sm:inline">
              Olá, {firstName}
            </span>
          ) : null}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={LogOut}
            loading={isPending}
            onClick={signOut}
          >
            Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-3xl px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-space-lg lg:pb-space-xl">
        {session && !session.emailVerified ? <EmailVerificationBanner /> : null}
        {failed ? (
          <Alert tone="error" className="mx-auto mb-space-md max-w-3xl">
            Não foi possível sair. Tente novamente.
          </Alert>
        ) : null}
        <Outlet />
      </main>

      <nav
        aria-label="Menu inferior"
        className="bv-tabbar fixed bottom-[calc(14px+env(safe-area-inset-bottom))] z-40 lg:hidden"
      >
        {tabs.map((item, index) => (
          <Fragment key={item.path}>
            {index === middle && booking ? (
              <NavLink to={booking.path} aria-label="Nova reserva" className="bv-fab">
                <NavIcon item={booking} />
              </NavLink>
            ) : null}
            <NavLink to={item.path} aria-label={item.label} className="bv-tab">
              <NavIcon item={item} />
            </NavLink>
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
