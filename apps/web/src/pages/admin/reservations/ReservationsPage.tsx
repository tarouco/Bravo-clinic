import { NavLink, Outlet, useParams } from 'react-router-dom';
import { cx, focusRing } from '../../../components/ui/cx';
import { slotComponents, Slot, type SlotComponent } from '../../../extensions/slots';
import { useSession } from '../../../features/auth/useSession';
import { usePageTitle } from '../../../lib/usePageTitle';
import { NotFoundPage } from '../../public/NotFoundPage';

/**
 * A component registered in `admin.reservations.tabs` is the body of one more sub-tab; it names
 * the tab with these static properties.
 */
export type ReservationsTabComponent = SlotComponent & { tabId?: string; tabLabel?: string };

const BASE = '/admin/reservas';

function extraTabs(): { id: string; label: string; Component: SlotComponent }[] {
  return (slotComponents('admin.reservations.tabs') as ReservationsTabComponent[]).flatMap(
    (Component) =>
      Component.tabId && Component.tabLabel
        ? [{ id: Component.tabId, label: Component.tabLabel, Component }]
        : [],
  );
}

/** Body of a sub-tab contributed through the `admin.reservations.tabs` slot. */
export function ReservationsSlotTab() {
  const { tabId } = useParams();
  const tab = extraTabs().find((t) => t.id === tabId);
  return tab ? <tab.Component /> : <NotFoundPage />;
}

/** `/admin/reservas`: sub-tabs Calendário, Lista and (admin) Políticas, plus those from slots. */
export function ReservationsPage() {
  usePageTitle('Gestão de Reservas');
  const { session } = useSession();
  const links = [
    { to: BASE, label: 'Calendário', end: true },
    { to: `${BASE}/lista`, label: 'Lista', end: false },
    ...(session?.role === 'admin'
      ? [{ to: `${BASE}/politicas`, label: 'Políticas', end: false }]
      : []),
    ...extraTabs().map((tab) => ({ to: `${BASE}/${tab.id}`, label: tab.label, end: false })),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-space-lg">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h1 className="font-heading text-heading-mobile text-ink md:text-heading">
          Gestão de Reservas
        </h1>
        <div className="flex flex-wrap gap-space-sm">
          <Slot name="admin.reservations.headerActions" />
        </div>
      </div>
      <nav
        aria-label="Seções de Gestão de Reservas"
        className="flex gap-space-lg border-b border-hairline"
      >
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              cx(
                '-mb-px border-b-2 px-space-xs py-space-sm font-small text-small transition-colors',
                isActive
                  ? 'border-bronze text-bronze'
                  : 'border-transparent text-ink-muted hover:text-ink',
                focusRing,
              )
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
