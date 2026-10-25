import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../features/auth/useSession';
import { renderWithProviders } from '../../test/render-with-providers';
import { LoginPage } from './LoginPage';

const tenant: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};
const staff: Session = { ...tenant, role: 'admin', mfa: { enrolled: true, verified: false } };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** `login` answers `POST /api/public/auth/login`; the config endpoint reports `googleEnabled`. */
function stubApi(login: () => Response, googleEnabled = false) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/public/config') {
      return Promise.resolve(json(200, { googleEnabled, whatsappE164: '' }));
    }
    return Promise.resolve(login());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderLogin(route = '/login') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    route,
  );
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail'), 'ana@example.com');
  await user.type(screen.getByLabelText('Senha'), 'Senha1234');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('shows "E-mail ou senha incorretos" on a 401 response', async () => {
    stubApi(() =>
      json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos' } }),
    );
    const user = userEvent.setup();
    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos');
  });

  it('shows the wait time in minutes on a 429 response with Retry-After', async () => {
    stubApi(() =>
      json(
        429,
        { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Muitas tentativas' } },
        { 'Retry-After': '720' },
      ),
    );
    const user = userEvent.setup();
    renderLogin();

    await submit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Tente novamente em 12 minutos.',
    );
  });

  it('navigates a tenant to /app after a successful login', async () => {
    const fetchMock = stubApi(() => json(200, { user: tenant, mfaRequired: false }));
    const user = userEvent.setup();
    renderLogin();

    await submit(user);

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/app$/);
    const loginCall = fetchMock.mock.calls.find(([url]) => url === '/api/public/auth/login') as [
      string,
      RequestInit,
    ];
    expect(loginCall[1].body).toBe(
      JSON.stringify({ email: 'ana@example.com', password: 'Senha1234' }),
    );
  });

  it('navigates staff to /admin after a successful login', async () => {
    stubApi(() =>
      json(200, {
        user: { ...staff, mfa: { enrolled: true, verified: true } },
        mfaRequired: false,
      }),
    );
    const user = userEvent.setup();
    renderLogin();

    await submit(user);

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin$/);
  });

  it('navigates to the next path when it is an in-site path', async () => {
    stubApi(() => json(200, { user: tenant, mfaRequired: false }));
    const user = userEvent.setup();
    renderLogin('/login?next=/app/agenda');

    await submit(user);

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/app\/agenda$/);
  });

  it('ignores next=//evil.com and navigates to /app', async () => {
    stubApi(() => json(200, { user: tenant, mfaRequired: false }));
    const user = userEvent.setup();
    renderLogin('/login?next=//evil.com');

    await submit(user);

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/app$/);
  });

  it('navigates to /login/2fa when the response says mfaRequired', async () => {
    stubApi(() => json(200, { user: staff, mfaRequired: true }));
    const user = userEvent.setup();
    renderLogin();

    await submit(user);

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/login\/2fa$/);
  });

  it('carries a safe next path over to /login/2fa when mfaRequired', async () => {
    stubApi(() => json(200, { user: staff, mfaRequired: true }));
    const user = userEvent.setup();
    renderLogin('/login?next=/admin/cupons');

    await submit(user);

    expect(await screen.findByTestId('where')).toHaveTextContent(
      /^\/login\/2fa\?next=%2Fadmin%2Fcupons$/,
    );
  });

  it('links to the password reset and signup pages', () => {
    stubApi(() => json(200, {}));
    renderLogin();

    expect(screen.getByRole('link', { name: 'Esqueci minha senha' })).toHaveAttribute(
      'href',
      '/esqueci-senha',
    );
    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/cadastro');
  });

  it('does not render the Google button when googleEnabled is false', async () => {
    const fetchMock = stubApi(() => json(200, {}), false);
    renderLogin();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/public/config', expect.anything()),
    );
    expect(screen.queryByRole('link', { name: /google/i })).not.toBeInTheDocument();
  });

  it('links the Google button to /api/public/auth/google/start when googleEnabled is true', async () => {
    stubApi(() => json(200, {}), true);
    renderLogin();

    expect(await screen.findByRole('link', { name: /google/i })).toHaveAttribute(
      'href',
      '/api/public/auth/google/start',
    );
  });
});
