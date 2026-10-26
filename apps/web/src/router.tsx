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
import { AppHomePage } from './pages/app/AppHomePage';
import { AgendaPage } from './pages/app/AgendaPage';
import { BookingDetailPage } from './pages/app/BookingDetailPage';
import { MyBookingsPage } from './pages/app/MyBookingsPage';
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
import { PricingPage } from './pages/public/PricingPage';
import { RoomPage } from './pages/public/rooms/RoomPage';
import { RoomsPage } from './pages/public/rooms/RoomsPage';

type PlaceholderRoute = readonly [path: string, title: string];

/** Public pages that ship with later features (docs/architecture.md section 9.1). */
const publicPlaceholders: PlaceholderRoute[] = [
  ['servicos-extras', 'Serviços extras'],
  ['assinar/:categoryId', 'Assinar plano'],
];

/** Tenant area pages that ship with later features. */
const appPlaceholders: PlaceholderRoute[] = [
  ['compras', 'Compras'],
  ['compras/horas-extras', 'Horas extras'],
  ['compras/creditos', 'Créditos'],
  ['compras/historico', 'Histórico de compras'],
  ['orcamentos', 'Orçamentos'],
  ['perfil', 'Perfil'],
  ['perfil/cartoes', 'Cartões'],
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
          { path: 'agenda', element: <AgendaPage /> },
          { path: 'minhas-reservas/:id', element: <BookingDetailPage /> },
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
