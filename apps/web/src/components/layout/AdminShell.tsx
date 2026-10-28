import { adminSectionMeta, adminSectionsFor, type Role } from '@bravo/core';
import { LogOut } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../../features/auth/useSession';
import { useSignOut } from '../../features/auth/useSignOut';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { BrandLockup } from '../ui/Brand';
import { Button } from '../ui/Button';
import { cx, focusRing } from '../ui/cx';
import { Alert } from '../ui/Feedback';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador geral',
  reception: 'Recepção',
  tenant: 'Locatário',
};

/** Staff shell: section menu from `access.ts` (sidebar from `lg`, scrolling strip below it), top bar. */
export function AdminShell() {
  const { session } = useSession();
  const { signOut, isPending, failed } = useSignOut();
  const sections = session ? adminSectionsFor(session.role) : [];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-40 border-b border-hairline/40 bg-surface/90 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between gap-space-md px-gutter">
          <Link to="/admin" className={cx('rounded', focusRing)}>
            <BrandLockup variant="header" />
            <span className="sr-only">, painel administrativo</span>
          </Link>
          <div className="flex items-center gap-space-sm">
            {session ? (
              <div className="hidden flex-col items-end sm:flex">
                <span className="font-small text-small text-ink">{session.name}</span>
                <span className="font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
                  {ROLE_LABELS[session.role]}
                </span>
              </div>
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
          aria-label="Seções do painel"
          className="flex gap-space-xs overflow-x-auto border-b border-hairline/40 bg-surface-container-low p-space-sm lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-space-md"
        >
          {sections.map((section) => {
            const { label, path } = adminSectionMeta[section];
            return (
              <NavLink
                key={section}
                to={path}
                className={({ isActive }) =>
                  cx(
                    'shrink-0 whitespace-nowrap rounded-control px-space-md py-space-sm font-small text-small transition-colors',
                    focusRing,
                    isActive
                      ? 'bg-champagne-soft text-on-champagne'
                      : 'text-ink-muted hover:bg-champagne/15 hover:text-bronze',
                  )
                }
              >
                {label}
              </NavLink>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 px-gutter py-space-lg">
          {failed ? (
            <Alert tone="error" className="mb-space-md">
              Não foi possível sair. Tente novamente.
            </Alert>
          ) : null}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
