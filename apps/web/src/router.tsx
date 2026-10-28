import { adminSectionMeta, type AdminSection } from '@bravo/core';
import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { PublicLayout } from './components/layout/PublicLayout';
import { ComingSoon, Spinner } from './components/ui/Feedback';
import {
  AdminIndexRedirect,
  RequireAuth,
  RequireSection,
  RequireStaff,
} from './features/auth/guards';
import { HomePage } from './pages/public/home/HomePage';
import { NotFoundPage } from './pages/public/NotFoundPage';
import { ContactPage } from './pages/public/ContactPage';
import { ExtrasPage } from './pages/public/ExtrasPage';
import { LegalPage } from './pages/public/LegalPage';
import { PoliciesPage } from './pages/public/PoliciesPage';
import { PricingPage } from './pages/public/PricingPage';
import { StructurePage } from './pages/public/StructurePage';
import { RoomPage } from './pages/public/rooms/RoomPage';
import { RoomsPage } from './pages/public/rooms/RoomsPage';

/**
 * Route-level code splitting (GES-143): the entry chunk carries only the public marketing pages;
 * the booking, checkout, auth, tenant and admin areas each load on first visit.
 */
const lazyLoaders: (() => Promise<ComponentType>)[] = [];

/** Loads every lazy route module now (tests warm them so module loading stays out of their waits). */
export function preloadLazyRoutes(): Promise<unknown> {
  return Promise.all(lazyLoaders.map((load) => load()));
}

function lazyPage(load: () => Promise<ComponentType>): ComponentType {
  lazyLoaders.push(load);
  const Page = lazy(async () => ({ default: await load() }));
  return function LazyPage() {
    return (
      <Suspense
        fallback={
          <div className="flex justify-center py-space-hero">
            <Spinner label="Carregando página" />
          </div>
        }
      >
        <Page />
      </Suspense>
    );
  };
}

const AdminShell = lazyPage(() =>
  import('./components/layout/AdminShell').then((m) => m.AdminShell),
);
const AppShell = lazyPage(() => import('./components/layout/AppShell').then((m) => m.AppShell));
const BookingFlowPage = lazyPage(() =>
  import('./features/booking/BookingFlowPage').then((m) => m.BookingFlowPage),
);
const CalendarConfigPage = lazyPage(() =>
  import('./pages/admin/calendar/CalendarConfigPage').then((m) => m.CalendarConfigPage),
);
const CuponsPage = lazyPage(() =>
  import('./pages/admin/cupons/CuponsPage').then((m) => m.CuponsPage),
);
const CustomerDetailPage = lazyPage(() =>
  import('./pages/admin/customers/CustomerDetailPage').then((m) => m.CustomerDetailPage),
);
const CustomersPage = lazyPage(() =>
  import('./pages/admin/customers/CustomersPage').then((m) => m.CustomersPage),
);
const ExtrasAdminPage = lazyPage(() =>
  import('./pages/admin/extras/ExtrasAdminPage').then((m) => m.ExtrasAdminPage),
);
const FinancePage = lazyPage(() =>
  import('./pages/admin/finance/FinancePage').then((m) => m.FinancePage),
);
const IntegrationsPage = lazyPage(() =>
  import('./pages/admin/integrations/IntegrationsPage').then((m) => m.IntegrationsPage),
);
const AuditPage = lazyPage(() => import('./pages/admin/audit/AuditPage').then((m) => m.AuditPage));
const RoomEditPage = lazyPage(() =>
  import('./pages/admin/rooms/RoomEditPage').then((m) => m.RoomEditPage),
);
const RoomsAdminPage = lazyPage(() =>
  import('./pages/admin/rooms/RoomsPage').then((m) => m.RoomsPage),
);
const UsersPage = lazyPage(() => import('./pages/admin/users/UsersPage').then((m) => m.UsersPage));
const BookingsListPage = lazyPage(() =>
  import('./pages/admin/reservations/BookingsListPage').then((m) => m.BookingsListPage),
);
const PoliciesRoute = lazyPage(() =>
  import('./pages/admin/reservations/PoliciesPanel').then((m) => m.PoliciesRoute),
);
const ReservationsCalendar = lazyPage(() =>
  import('./pages/admin/reservations/ReservationsCalendar').then((m) => m.ReservationsCalendar),
);
const ReservationsPage = lazyPage(() =>
  import('./pages/admin/reservations/ReservationsPage').then((m) => m.ReservationsPage),
);
const ReservationsSlotTab = lazyPage(() =>
  import('./pages/admin/reservations/ReservationsPage').then((m) => m.ReservationsSlotTab),
);
const AgendaPage = lazyPage(() => import('./pages/app/AgendaPage').then((m) => m.AgendaPage));
const AppHomePage = lazyPage(() => import('./pages/app/AppHomePage').then((m) => m.AppHomePage));
const BookingDetailPage = lazyPage(() =>
  import('./pages/app/BookingDetailPage').then((m) => m.BookingDetailPage),
);
const CardsPage = lazyPage(() => import('./pages/app/CardsPage').then((m) => m.CardsPage));
const ComprasLayout = lazyPage(() =>
  import('./pages/app/compras/ComprasPage').then((m) => m.ComprasLayout),
);
const ComprasPage = lazyPage(() =>
  import('./pages/app/compras/ComprasPage').then((m) => m.ComprasPage),
);
const CreditosPage = lazyPage(() =>
  import('./pages/app/compras/CreditosHistoricoPages').then((m) => m.CreditosPage),
);
const HistoricoPage = lazyPage(() =>
  import('./pages/app/compras/CreditosHistoricoPages').then((m) => m.HistoricoPage),
);
const HorasExtrasPage = lazyPage(() =>
  import('./pages/app/compras/HorasExtrasPage').then((m) => m.HorasExtrasPage),
);
const MyBookingsPage = lazyPage(() =>
  import('./pages/app/MyBookingsPage').then((m) => m.MyBookingsPage),
);
const NotificationSettingsPage = lazyPage(() =>
  import('./pages/app/NotificationSettingsPage').then((m) => m.NotificationSettingsPage),
);
const PrivacyPage = lazyPage(() => import('./pages/app/PrivacyPage').then((m) => m.PrivacyPage));
const ProfilePage = lazyPage(() => import('./pages/app/ProfilePage').then((m) => m.ProfilePage));
const QuotesPage = lazyPage(() => import('./pages/app/QuotesPage').then((m) => m.QuotesPage));
const LoginPage = lazyPage(() => import('./pages/auth/LoginPage').then((m) => m.LoginPage));
const ForgotPasswordPage = lazyPage(() =>
  import('./pages/auth/password/ForgotPasswordPage').then((m) => m.ForgotPasswordPage),
);
const ResetPasswordPage = lazyPage(() =>
  import('./pages/auth/password/ResetPasswordPage').then((m) => m.ResetPasswordPage),
);
const SignupPage = lazyPage(() => import('./pages/auth/SignupPage').then((m) => m.SignupPage));
const TwoFactorEnrollPage = lazyPage(() =>
  import('./pages/auth/TwoFactorPages').then((m) => m.TwoFactorEnrollPage),
);
const TwoFactorVerifyPage = lazyPage(() =>
  import('./pages/auth/TwoFactorPages').then((m) => m.TwoFactorVerifyPage),
);
const VerifyEmailPage = lazyPage(() =>
  import('./pages/auth/VerifyEmailPage').then((m) => m.VerifyEmailPage),
);
const CheckoutPage = lazyPage(() =>
  import('./pages/public/CheckoutPage').then((m) => m.CheckoutPage),
);
const PreReservationPage = lazyPage(() =>
  import('./pages/public/PreReservationPage').then((m) => m.PreReservationPage),
);
const SandboxCheckoutPage = lazyPage(() =>
  import('./pages/public/SandboxCheckoutPage').then((m) => m.SandboxCheckoutPage),
);
const SubscribePage = lazyPage(() =>
  import('./pages/public/SubscribePage').then((m) => m.SubscribePage),
);

type PlaceholderRoute = readonly [path: string, title: string];

/** Public pages that ship with later features (docs/architecture.md section 9.1). */
const publicPlaceholders: PlaceholderRoute[] = [];

/** Tenant area pages that ship with later features. */
const appPlaceholders: PlaceholderRoute[] = [['perfil/seguranca', 'Segurança']];

const placeholder = ([path, title]: PlaceholderRoute): RouteObject => ({
  path,
  element: <ComingSoon title={title} />,
});

/** One guarded route per admin section; clients also has the detail page. */
const adminSectionRoute = (section: AdminSection): RouteObject => {
  const { label, path } = adminSectionMeta[section];
  const children: RouteObject[] = [{ index: true, element: <ComingSoon title={label} /> }];
  if (section === 'calendario') children[0] = { index: true, element: <CalendarConfigPage /> };
  if (section === 'cupons') children[0] = { index: true, element: <CuponsPage /> };
  if (section === 'financeiro') children[0] = { index: true, element: <FinancePage /> };
  if (section === 'integracoes') children[0] = { index: true, element: <IntegrationsPage /> };
  if (section === 'servicos-extras') children[0] = { index: true, element: <ExtrasAdminPage /> };
  if (section === 'reservas') {
    children.splice(0, children.length, {
      element: <ReservationsPage />,
      children: [
        { index: true, element: <ReservationsCalendar /> },
        { path: 'lista', element: <BookingsListPage /> },
        { path: 'politicas', element: <PoliciesRoute /> },
        { path: ':tabId', element: <ReservationsSlotTab /> },
      ],
    });
  }
  if (section === 'usuarios') children[0] = { index: true, element: <UsersPage /> };
  if (section === 'auditoria') children[0] = { index: true, element: <AuditPage /> };
  if (section === 'salas') {
    children[0] = { index: true, element: <RoomsAdminPage /> };
    children.push({ path: ':id', element: <RoomEditPage /> });
  }
  if (section === 'clientes') {
    children[0] = { index: true, element: <CustomersPage /> };
    children.push({ path: ':id', element: <CustomerDetailPage /> });
  }
  return {
    path: path.replace('/admin/', ''),
    element: <RequireSection section={section} />,
    children,
  };
};

const adminSections = Object.keys(adminSectionMeta) as AdminSection[];

export const appRoutes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'salas', element: <RoomsPage /> },
      { path: 'salas/:slug', element: <RoomPage /> },
      { path: 'estrutura', element: <StructurePage /> },
      { path: 'precos', element: <PricingPage /> },
      { path: 'politicas', element: <PoliciesPage /> },
      { path: 'contato', element: <ContactPage /> },
      { path: 'servicos-extras', element: <ExtrasPage /> },
      { path: 'termos', element: <LegalPage kind="termos" /> },
      { path: 'privacidade', element: <LegalPage kind="privacidade" /> },
      { path: 'reservar', element: <BookingFlowPage /> },
      { path: 'assinar/:categoryId', element: <SubscribePage /> },
      { path: 'pagamento/sandbox/:chargeId', element: <SandboxCheckoutPage /> },
      { path: 'pre-reserva/:token', element: <PreReservationPage /> },
      ...publicPlaceholders.map(placeholder),
      { path: 'login', element: <LoginPage /> },
      { path: 'cadastro', element: <SignupPage /> },
      { path: 'verificar-email', element: <VerifyEmailPage /> },
      { path: 'esqueci-senha', element: <ForgotPasswordPage /> },
      { path: 'redefinir-senha', element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'checkout/:bookingId', element: <CheckoutPage /> },
          { path: 'login/2fa', element: <TwoFactorVerifyPage /> },
          { path: 'login/2fa/configurar', element: <TwoFactorEnrollPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: 'app',
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <AppHomePage /> },
          { path: 'reservar', element: <BookingFlowPage /> },
          { path: 'minhas-reservas', element: <MyBookingsPage /> },
          { path: 'minhas-reservas/:id', element: <BookingDetailPage /> },
          { path: 'agenda', element: <AgendaPage /> },
          { path: 'orcamentos', element: <QuotesPage /> },
          { path: 'perfil', element: <ProfilePage /> },
          { path: 'perfil/cartoes', element: <CardsPage /> },
          { path: 'perfil/notificacoes', element: <NotificationSettingsPage /> },
          { path: 'perfil/privacidade', element: <PrivacyPage /> },
          {
            path: 'compras',
            element: <ComprasLayout />,
            children: [
              { index: true, element: <ComprasPage /> },
              { path: 'assinaturas/:id/pagar', element: <ComprasPage /> },
              { path: 'horas-extras', element: <HorasExtrasPage /> },
              { path: 'creditos', element: <CreditosPage /> },
              { path: 'historico', element: <HistoricoPage /> },
            ],
          },
          ...appPlaceholders.map(placeholder),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  {
    path: 'admin',
    element: <RequireAuth />,
    children: [
      {
        element: <RequireStaff />,
        children: [
          {
            element: <AdminShell />,
            children: [
              { index: true, element: <AdminIndexRedirect /> },
              ...adminSections.map(adminSectionRoute),
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(appRoutes);
