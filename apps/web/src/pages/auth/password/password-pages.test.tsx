import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/render-with-providers';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ForgotPasswordPage', () => {
  it.each(['cadastrado@example.com', 'desconhecido@example.com'])(
    'shows the neutral message after the API answers 202 for %s',
    async (email) => {
      const fetchMock = stubFetch(() => json(202, {}));
      const user = userEvent.setup();
      renderWithProviders(<ForgotPasswordPage />, '/esqueci-senha');

      await user.type(screen.getByLabelText('E-mail'), email);
      await user.click(screen.getByRole('button', { name: 'Enviar link' }));

      expect(
        await screen.findByText(
          'Se o e-mail estiver cadastrado, você receberá um link em instantes.',
        ),
      ).toBeInTheDocument();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/public/auth/password-reset/request');
      expect(init.body).toBe(JSON.stringify({ email }));
    },
  );
});

describe('ResetPasswordPage', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, password: string, again: string) {
    await user.type(screen.getByLabelText('Nova senha'), password);
    await user.type(screen.getByLabelText('Confirmar nova senha'), again);
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
  }

  it('shows "As senhas não conferem" and makes no API call when the confirmation differs', async () => {
    const fetchMock = stubFetch(() => json(200, {}));
    const user = userEvent.setup();
    renderWithProviders(<ResetPasswordPage />, '/redefinir-senha?token=tok');

    await fill(user, 'Senha1234', 'Senha12345');

    expect(await screen.findByText('As senhas não conferem')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the token and new password, then shows "Senha alterada" with a link to /login', async () => {
    const fetchMock = stubFetch(() => json(200, {}));
    const user = userEvent.setup();
    renderWithProviders(<ResetPasswordPage />, '/redefinir-senha?token=tok');

    await fill(user, 'Senha1234', 'Senha1234');

    expect(await screen.findByText('Senha alterada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/public/auth/password-reset/confirm');
    expect(init.body).toBe(JSON.stringify({ token: 'tok', password: 'Senha1234' }));
  });

  it('shows "Link inválido ou expirado" when the API answers 400', async () => {
    stubFetch(() =>
      json(400, { error: { code: 'INVALID_TOKEN', message: 'Link inválido ou expirado' } }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ResetPasswordPage />, '/redefinir-senha?token=old');

    await fill(user, 'Senha1234', 'Senha1234');

    expect(await screen.findByText('Link inválido ou expirado')).toBeInTheDocument();
  });
});
