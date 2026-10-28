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
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useResendVerification } from '../../features/auth/hooks';
import { useSession } from '../../features/auth/useSession';
import { useSignOut } from '../../features/auth/useSignOut';
import { usePageViews } from '../../lib/analytics';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { BrandLockup } from '../ui/Brand';
import { Button } from '../ui/Button';
import { cx, focusRing } from '../ui/cx';
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

/** Tenant area shell: sidebar from `lg`, bottom tab bar below it, header with the account actions. */
export function AppShell() {
  usePageViews();
  const { session } = useSession();
  const { signOut, isPending, failed } = useSignOut();
  const firstName = session?.name.trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-40 border-b border-hairline/40 bg-surface/90 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-gutter">
          <Link to="/app" className={cx('rounded', focusRing)}>
            <BrandLockup variant="header" />
            <span className="sr-only">, início da minha área</span>
          </Link>
          <div className="flex items-center gap-space-sm">
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
        </div>
      </header>

      <div className="lg:flex">
        <nav
          aria-label="Menu lateral"
          className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col gap-space-xs border-r border-hairline/40 bg-surface-container-low p-space-md lg:flex"
        >
          {appNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-space-sm rounded-control px-space-md py-space-sm font-small text-small transition-colors',
                  focusRing,
                  isActive
                    ? 'bg-champagne-soft text-on-champagne'
                    : 'text-ink-muted hover:bg-champagne/15 hover:text-bronze',
                )
              }
            >
              <NavIcon item={item} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1 px-gutter pb-28 pt-space-lg lg:pb-space-xl">
          {session && !session.emailVerified ? <EmailVerificationBanner /> : null}
          {failed ? (
            <Alert tone="error" className="mx-auto mb-space-md max-w-3xl">
              Não foi possível sair. Tente novamente.
            </Alert>
          ) : null}
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Menu inferior"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline/40 bg-surface/95 backdrop-blur-xl lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {appNav.map((item) => (
            <li key={item.path} className="list-none">
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  cx(
                    'flex h-16 flex-col items-center justify-start gap-space-xs px-1 pt-space-sm text-center font-caption text-caption leading-tight transition-colors',
                    focusRing,
                    isActive ? 'text-bronze' : 'text-ink-muted hover:text-bronze',
                  )
                }
              >
                <NavIcon item={item} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
