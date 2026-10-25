import { adminSectionMeta, type AdminSection } from '@bravo/core';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { PublicLayout } from './components/layout/PublicLayout';
import { ComingSoon } from './components/ui/Feedback';
import {
  AdminIndexRedirect,
  RequireAuth,
  RequireSection,
  RequireStaff,
} from './features/auth/guards';
import { AppHomePage } from './pages/app/AppHomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { ForgotPasswordPage } from './pages/auth/password/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/password/ResetPasswordPage';
import { SignupPage } from './pages/auth/SignupPage';
import { TwoFactorEnrollPage, TwoFactorVerifyPage } from './pages/auth/TwoFactorPages';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { HomePage } from './pages/public/home/HomePage';
import { NotFoundPage } from './pages/public/NotFoundPage';

type PlaceholderRoute = readonly [path: string, title: string];

/** Public pages that ship with later features (docs/architecture.md section 9.1). */
const publicPlaceholders: PlaceholderRoute[] = [
  ['salas', 'Salas'],
  ['salas/:slug', 'Sala'],
  ['precos', 'Preços e pacotes'],
  ['servicos-extras', 'Serviços extras'],
  ['politicas', 'Políticas'],
  ['contato', 'Contato'],
  ['termos', 'Termos de uso'],
  ['privacidade', 'Política de privacidade'],
  ['reservar', 'Reservar'],
  ['checkout/:bookingId', 'Pagamento'],
  ['pagamento/sandbox/:chargeId', 'Pagamento de teste'],
  ['pre-reserva/:token', 'Pré-reserva'],
  ['assinar/:categoryId', 'Assinar plano'],
];

/** Tenant area pages that ship with later features. */
const appPlaceholders: PlaceholderRoute[] = [
  ['reservar', 'Reservar'],
  ['minhas-reservas', 'Minhas reservas'],
  ['minhas-reservas/:id', 'Reserva'],
  ['agenda', 'Agenda'],
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
      ...publicPlaceholders.map(placeholder),
      { path: 'login', element: <LoginPage /> },
      { path: 'cadastro', element: <SignupPage /> },
      { path: 'verificar-email', element: <VerifyEmailPage /> },
      { path: 'esqueci-senha', element: <ForgotPasswordPage /> },
      { path: 'redefinir-senha', element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
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
      { index: true, element: <AppHomePage /> },
      ...appPlaceholders.map(placeholder),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: 'admin',
    element: <RequireAuth />,
    children: [
      {
        element: <RequireStaff />,
        children: [
          { index: true, element: <AdminIndexRedirect /> },
          ...adminSections.map(adminSectionRoute),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(appRoutes);
