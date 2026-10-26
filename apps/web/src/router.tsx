import { adminSectionMeta, type AdminSection } from '@bravo/core';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AdminShell } from './components/layout/AdminShell';
import { AppShell } from './components/layout/AppShell';
import { PublicLayout } from './components/layout/PublicLayout';
import { ComingSoon } from './components/ui/Feedback';
import {
  AdminIndexRedirect,
  RequireAuth,
  RequireSection,
  RequireStaff,
} from './features/auth/guards';
import { BookingFlowPage } from './features/booking/BookingFlowPage';
import { CalendarConfigPage } from './pages/admin/calendar/CalendarConfigPage';
import { CuponsPage } from './pages/admin/cupons/CuponsPage';
import { FinancePage } from './pages/admin/finance/FinancePage';
import { IntegrationsPage } from './pages/admin/integrations/IntegrationsPage';
import { BookingsListPage } from './pages/admin/reservations/BookingsListPage';
import { PoliciesRoute } from './pages/admin/reservations/PoliciesPanel';
import { ReservationsCalendar } from './pages/admin/reservations/ReservationsCalendar';
import { ReservationsPage, ReservationsSlotTab } from './pages/admin/reservations/ReservationsPage';
import { AgendaPage } from './pages/app/AgendaPage';
import { AppHomePage } from './pages/app/AppHomePage';
import { BookingDetailPage } from './pages/app/BookingDetailPage';
import { CardsPage } from './pages/app/CardsPage';
import { ComprasLayout, ComprasPage } from './pages/app/compras/ComprasPage';
import { CreditosPage, HistoricoPage } from './pages/app/compras/CreditosHistoricoPages';
import { HorasExtrasPage } from './pages/app/compras/HorasExtrasPage';
import { MyBookingsPage } from './pages/app/MyBookingsPage';
import { ProfilePage } from './pages/app/ProfilePage';
import { LoginPage } from './pages/auth/LoginPage';
import { ForgotPasswordPage } from './pages/auth/password/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/password/ResetPasswordPage';
import { SignupPage } from './pages/auth/SignupPage';
import { TwoFactorEnrollPage, TwoFactorVerifyPage } from './pages/auth/TwoFactorPages';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { HomePage } from './pages/public/home/HomePage';
import { NotFoundPage } from './pages/public/NotFoundPage';
import { ContactPage } from './pages/public/ContactPage';
import { LegalPage } from './pages/public/LegalPage';
import { CheckoutPage } from './pages/public/CheckoutPage';
import { PoliciesPage } from './pages/public/PoliciesPage';
import { PreReservationPage } from './pages/public/PreReservationPage';
import { SandboxCheckoutPage } from './pages/public/SandboxCheckoutPage';
import { SubscribePage } from './pages/public/SubscribePage';
import { PricingPage } from './pages/public/PricingPage';
import { RoomPage } from './pages/public/rooms/RoomPage';
import { RoomsPage } from './pages/public/rooms/RoomsPage';

type PlaceholderRoute = readonly [path: string, title: string];

/** Public pages that ship with later features (docs/architecture.md section 9.1). */
const publicPlaceholders: PlaceholderRoute[] = [['servicos-extras', 'Serviços extras']];

/** Tenant area pages that ship with later features. */
const appPlaceholders: PlaceholderRoute[] = [
  ['orcamentos', 'Orçamentos'],
  ['perfil/notificacoes', 'Notificações'],
  ['perfil/privacidade', 'Privacidade'],
  ['perfil/seguranca', 'Segurança'],
];

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
  if (section === 'clientes') children.push(placeholder([':id', 'Cliente']));
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
      { path: 'precos', element: <PricingPage /> },
      { path: 'politicas', element: <PoliciesPage /> },
      { path: 'contato', element: <ContactPage /> },
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
          { path: 'perfil', element: <ProfilePage /> },
          { path: 'perfil/cartoes', element: <CardsPage /> },
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
