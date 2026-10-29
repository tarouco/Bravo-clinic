import { adminSectionMeta, adminSectionsFor, type Role } from '@bravo/core';
import { LogOut, ShieldCheck } from 'lucide-react';
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

/** Section pills: the current one sinks (deboss) in weight 600, the others shade on hover. */
const sectionLinkClasses = ({ isActive }: { isActive: boolean }): string =>
  cx(
    'shrink-0 whitespace-nowrap rounded-pill px-space-md py-2 font-small text-small transition-colors',
    focusRing,
    isActive
      ? 'bg-surface-deboss font-semibold text-ink shadow-deboss'
      : 'text-ink-muted hover:bg-glass-hover hover:text-ink',
  );

/**
 * Staff shell: section menu from `access.ts` (a glass panel inset 16px on the left from `lg`, a
 * scrolling strip of pills below it) and a pearl top bar with the account actions. Compact
 * density is allowed in the Admin only (DESIGN-v3.md).
 */
export function AdminShell() {
  const { session } = useSession();
  const { signOut, isPending, failed } = useSignOut();
  const sections = session ? adminSectionsFor(session.role) : [];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="pointer-events-none sticky top-0 z-30 px-4 pt-3 lg:pl-[18rem] lg:pr-6 lg:pt-4">
        <div className="bv-navbar pointer-events-auto gap-space-sm pl-5 sm:pl-6">
          <Link
            to="/admin"
            className="rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <BrandLockup variant="header" />
            <span className="sr-only">, painel administrativo</span>
          </Link>
          <span className="bv-navbar-spacer" />
          {session ? (
            <div className="mr-space-xs hidden flex-col items-end sm:flex">
              <span className="font-small text-small text-ink">{session.name}</span>
              <span className="font-caption text-caption text-ink-muted">
                {ROLE_LABELS[session.role]}
              </span>
            </div>
          ) : null}
          <ThemeToggle />
          {/* The user's own preferences, e.g. the optional two-factor toggle (AD-037). Icon-only
              on phones so the bar fits; the text stays as the accessible name. */}
          <Button
            asChild
            variant="ghost"
            size="sm"
            leadingIcon={ShieldCheck}
            className="max-sm:w-10 max-sm:px-0"
          >
            <Link to="/app/perfil/seguranca">
              <span className="max-sm:sr-only">Segurança</span>
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={LogOut}
            loading={isPending}
            onClick={signOut}
            className="max-sm:w-10 max-sm:px-0"
          >
            <span className="max-sm:sr-only">Sair</span>
          </Button>
        </div>
      </header>

      <nav
        aria-label="Seções do painel"
        className={cx(
          'flex gap-space-xs overflow-x-auto px-4 pb-space-xs pt-3',
          'lg:fixed lg:inset-y-4 lg:left-4 lg:z-40 lg:w-64 lg:flex-col lg:overflow-y-auto lg:rounded-xl lg:bg-glass lg:p-3 lg:shadow-panel lg:backdrop-blur-glass',
        )}
      >
        <p className="bv-menu-label hidden lg:block">Painel</p>
        {sections.map((section) => {
          const { label, path } = adminSectionMeta[section];
          return (
            <NavLink key={section} to={path} className={sectionLinkClasses}>
              {label}
            </NavLink>
          );
        })}
      </nav>

      <main className="min-w-0 px-4 py-space-lg lg:pl-[18rem] lg:pr-6">
        {failed ? (
          <Alert tone="error" className="mb-space-md">
            Não foi possível sair. Tente novamente.
          </Alert>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
