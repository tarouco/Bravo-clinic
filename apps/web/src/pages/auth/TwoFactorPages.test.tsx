import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../features/auth/useSession';
import { renderWithProviders } from '../../test/render-with-providers';
import { TwoFactorVerifyPage } from './TwoFactorPages';

const tenant: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: true, verified: false },
};
const admin: Session = { ...tenant, role: 'admin', email: 'admin@example.com' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** `/api/app/me` answers with the session; every other call goes to `handler`. */
function stubFetch(session: Session, handler: (url: string) => Response) {
  const fetchMock = vi
    .fn()
    .mockImplementation((url: string) =>
      Promise.resolve(url === '/api/app/me' ? json(200, session) : handler(url)),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const verifyCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/app/auth/totp/verify') as [
    string,
    RequestInit,
  ][];

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/login/2fa" element={<TwoFactorVerifyPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    route,
  );
}

/** Waits for the session to load (the staff eyebrow) so the role-based destination is known. */
const staffLoaded = () => screen.findByText('Área restrita');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TwoFactorVerifyPage', () => {
  it('posts the code and navigates staff to /admin when it is valid', async () => {
    const fetchMock = stubFetch(admin, () => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPage('/login/2fa');
    await staffLoaded();

    await user.type(screen.getByLabelText('Código de verificação'), '123 456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin$/);
    const [call] = verifyCalls(fetchMock);
    expect(call?.[1].body).toBe(JSON.stringify({ code: '123456' }));
  });

  it('navigates a tenant to /app and never calls the area "Área restrita" (AD-037)', async () => {
    const fetchMock = stubFetch(tenant, () => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPage('/login/2fa');

    expect(await screen.findByText('Área do cliente')).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/app/me')).toBe(true),
    );
    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/app$/);
    expect(screen.queryByText('Área restrita')).not.toBeInTheDocument();
    expect(verifyCalls(fetchMock)).toHaveLength(1);
  });

  it('posts a recovery code normalized to upper case and navigates to /admin (FND-113)', async () => {
    const fetchMock = stubFetch(admin, () => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPage('/login/2fa');
    await staffLoaded();

    await user.type(screen.getByLabelText('Código de verificação'), 'abcd-efgh');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin$/);
    const calls = verifyCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1].method).toBe('POST');
    expect(calls[0]?.[1].body).toBe(JSON.stringify({ code: 'ABCD-EFGH' }));
  });

  it('shows "Código inválido" when the API answers 401', async () => {
    stubFetch(admin, () => json(401, { error: { code: 'INVALID_CODE', message: 'x' } }));
    const user = userEvent.setup();
    renderPage('/login/2fa');

    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido');
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('shows the wait time when the API answers 429', async () => {
    stubFetch(
      admin,
      () =>
        new Response(JSON.stringify({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'x' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '600' },
        }),
    );
    const user = userEvent.setup();
    renderPage('/login/2fa');

    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Tente novamente em 10 minutos.',
    );
  });

  it('rejects a malformed code without calling the API', async () => {
    const fetchMock = stubFetch(admin, () => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPage('/login/2fa');

    await user.type(screen.getByLabelText('Código de verificação'), '12');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByText('Código inválido')).toBeInTheDocument();
    expect(verifyCalls(fetchMock)).toHaveLength(0);
  });

  it('navigates to a safe next path instead of the default', async () => {
    stubFetch(tenant, () => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPage('/login/2fa?next=/app/agenda');

    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/app\/agenda$/);
  });
});
