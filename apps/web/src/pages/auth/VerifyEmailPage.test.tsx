import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../features/auth/useSession';
import { renderWithProviders } from '../../test/render-with-providers';
import { VerifyEmailPage } from './VerifyEmailPage';

const session: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: false,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const invalidToken = () =>
  json(400, { error: { code: 'INVALID_TOKEN', message: 'Link inválido ou expirado' } });

/** Routes the calls the page makes: verify, resend and the session lookup. */
function stubApi({ verify, signedIn }: { verify: () => Response; signedIn: boolean }) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/public/auth/verify-email') return Promise.resolve(verify());
    if (url === '/api/app/auth/verify-email/resend') return Promise.resolve(json(202, {}));
    if (url === '/api/app/me') {
      return Promise.resolve(
        signedIn
          ? json(200, session)
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
      );
    }
    return Promise.resolve(json(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const callsTo = (fetchMock: ReturnType<typeof vi.fn>, url: string) =>
  fetchMock.mock.calls.filter(([called]) => called === url) as [string, RequestInit][];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VerifyEmailPage', () => {
  it('sends exactly one verify request with the token (even under StrictMode) and shows "E-mail confirmado"', async () => {
    const fetchMock = stubApi({ verify: () => json(200, { verified: true }), signedIn: false });
    renderWithProviders(
      <StrictMode>
        <VerifyEmailPage />
      </StrictMode>,
      '/verificar-email?token=abc123',
    );

    expect(await screen.findByText('E-mail confirmado')).toBeInTheDocument();
    const verifyCalls = callsTo(fetchMock, '/api/public/auth/verify-email');
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]?.[1].body).toBe(JSON.stringify({ token: 'abc123' }));
    expect(screen.getByRole('link', { name: 'Ir para minha área' })).toHaveAttribute(
      'href',
      '/app',
    );
  });

  it('shows "Link inválido ou expirado" on 400 and, with a session, a "Reenviar e-mail" button that calls resend', async () => {
    const fetchMock = stubApi({ verify: invalidToken, signedIn: true });
    const user = userEvent.setup();
    renderWithProviders(<VerifyEmailPage />, '/verificar-email?token=old');

    expect(await screen.findByText('Link inválido ou expirado')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Reenviar e-mail' }));

    await waitFor(() =>
      expect(callsTo(fetchMock, '/api/app/auth/verify-email/resend')).toHaveLength(1),
    );
  });

  it('links to /login instead of offering resend when there is no session', async () => {
    const fetchMock = stubApi({ verify: invalidToken, signedIn: false });
    renderWithProviders(<VerifyEmailPage />, '/verificar-email?token=old');

    expect(await screen.findByText('Link inválido ou expirado')).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, '/api/app/me')).toHaveLength(1));
    expect(screen.getByRole('link', { name: /Entrar/ })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: 'Reenviar e-mail' })).not.toBeInTheDocument();
  });
});
