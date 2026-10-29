import { MapPin, Menu, User, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useSession } from '../../features/auth/useSession';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { BrandLockup } from '../ui/Brand';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

export const NAV_LINKS = [
  { to: '/salas', label: 'Salas' },
  { to: '/estrutura', label: 'Estrutura' },
  { to: '/precos', label: 'Preços & Planos' },
  { to: '/servicos-extras', label: 'Serviços Extras' },
  { to: '/contato', label: 'Contato' },
] as const;

/** Glass menu rows; the current page is bold in a debossed pill, like the NavBar link. */
const menuItemClasses =
  'bv-menu-item no-underline aria-[current=page]:bg-surface-deboss aria-[current=page]:font-semibold aria-[current=page]:shadow-deboss';

/**
 * The site's floating NavBar (guias/NavBar.md): a pearl pill 16px below the top edge with the
 * name in type, section links whose current one sinks (`aria-current` from the router), the
 * theme switch and one emerald action. Below `lg` the links move to a glass menu under the bar.
 */
export function Header() {
  const { session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 px-4">
      <div className="bv-navbar pointer-events-auto mx-auto max-w-[1180px] gap-space-sm pl-5 sm:pl-6">
        <Link
          to="/"
          className="rounded-pill focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <BrandLockup variant="header" />
        </Link>
        <div className="hidden xl:flex items-center gap-space-xs border-l border-hairline pl-space-md">
          <Icon as={MapPin} size={16} className="text-accent" />
          <span className="font-small text-small text-ink-muted">Praia Brava - Itajaí</span>
        </div>

        <span className="bv-navbar-spacer" />

        <nav aria-label="Principal" className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className="bv-navbar-link">
              {link.label}
            </NavLink>
          ))}
        </nav>

        <span className="bv-navbar-spacer hidden lg:block" />

        <ThemeToggle />
        {/* Icon-only on phones so the bar fits 375px; the text stays as the accessible name. */}
        <Button asChild size="sm" leadingIcon={User} className="max-sm:w-10 max-sm:px-0">
          <Link to={session ? '/app' : '/login'}>
            <span className="max-sm:sr-only">{session ? 'Minha conta' : 'Login'}</span>
          </Link>
        </Button>
        <IconButton
          icon={menuOpen ? X : Menu}
          label="Menu"
          size="sm"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="lg:hidden"
        />
      </div>

      {menuOpen ? (
        <nav
          id="mobile-menu"
          aria-label="Menu móvel"
          className="bv-menu pointer-events-auto mx-auto mt-space-sm max-w-[1180px] lg:hidden"
        >
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} onClick={closeMenu} className={menuItemClasses}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
