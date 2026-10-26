import { MapPin, Menu, User, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../features/auth/useSession';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { BrandLockup } from '../ui/Brand';
import { Button } from '../ui/Button';
import { cx, focusRing } from '../ui/cx';
import { Icon } from '../ui/Icon';

export const NAV_LINKS = [
  { to: '/salas', label: 'Salas' },
  { to: '/estrutura', label: 'Estrutura' },
  { to: '/precos', label: 'Preços & Planos' },
  { to: '/servicos-extras', label: 'Serviços Extras' },
  { to: '/contato', label: 'Contato' },
] as const;

const navLinkClasses =
  'font-small text-small text-on-surface-variant hover:text-bronze hover:bg-champagne/15 active:scale-95 active:bg-champagne/30 active:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bronze transition-all duration-200 ease-out py-space-xs px-space-sm rounded cursor-pointer';

export function Header() {
  const { session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(46,26,12,0.04)]">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="flex items-center justify-between h-20">
          <div className="flex items-center gap-space-lg">
            <Link to="/" aria-label="Bravô Clinic - Salas Inteligentes" className="rounded">
              <BrandLockup variant="header" />
            </Link>
            <div className="hidden xl:flex items-center gap-space-xs text-ink-muted pl-space-md border-l border-hairline/40">
              <Icon as={MapPin} size={16} className="text-bronze" />
              <span className="font-small text-small text-ink-muted">Praia Brava - Itajaí</span>
            </div>
          </div>

          <nav aria-label="Principal" className="hidden lg:flex items-center gap-space-md">
            {NAV_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className={navLinkClasses}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-space-sm">
            <ThemeToggle />
            <Button
              asChild
              size="sm"
              leadingIcon={User}
              className="shadow-[0_2px_10px_rgba(122,70,29,0.2)]"
            >
              <Link to={session ? '/app' : '/login'}>{session ? 'Minha conta' : 'Login'}</Link>
            </Button>
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
              className={cx(
                'lg:hidden inline-flex h-10 w-10 items-center justify-center rounded text-ink-muted transition-colors hover:bg-champagne/15 hover:text-bronze',
                focusRing,
              )}
            >
              <Icon as={menuOpen ? X : Menu} />
            </button>
          </div>
        </div>
      </div>

      {menuOpen ? (
        <nav
          id="mobile-menu"
          aria-label="Menu móvel"
          className="lg:hidden border-t border-hairline/40 bg-surface"
        >
          <div className="max-w-7xl mx-auto px-gutter py-space-md flex flex-col gap-space-xs">
            {NAV_LINKS.map((link) => (
              <Link key={link.to} to={link.to} onClick={closeMenu} className={navLinkClasses}>
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
