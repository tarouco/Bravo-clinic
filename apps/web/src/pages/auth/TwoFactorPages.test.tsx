import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { TwoFactorEnrollPage, TwoFactorVerifyPage } from './TwoFactorPages';

// jsdom has no canvas, which the browser build of qrcode draws on.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QRCODE') },
}));

const QR_ALT = 'QR code para o aplicativo autenticador';
const OTPAUTH_URI =
  'otpauth://totp/Brav%C3%B4%20Clinic:admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Brav%C3%B4%20Clinic';
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `ABCD-EF${String(i + 2)}H`);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string) => Response) {
  const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(handler(url)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderPages(route: string, strict = false) {
  const routes = (
    <Routes>
      <Route path="/login/2fa" element={<TwoFactorVerifyPage />} />
      <Route path="/login/2fa/configurar" element={<TwoFactorEnrollPage />} />
      <Route path="*" element={<Where />} />
    </Routes>
  );
  return renderWithProviders(strict ? <StrictMode>{routes}</StrictMode> : routes, route);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TwoFactorVerifyPage', () => {
  it('posts the code and navigates to /admin when it is valid', async () => {
    const fetchMock = stubFetch(() => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPages('/login/2fa');

    await user.type(screen.getByLabelText('Código de verificação'), '123 456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin$/);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/app/auth/totp/verify');
    expect(init.body).toBe(JSON.stringify({ code: '123456' }));
  });

  it('shows "Código inválido" when the API answers 401', async () => {
    stubFetch(() => json(401, { error: { code: 'INVALID_CODE', message: 'x' } }));
    const user = userEvent.setup();
    renderPages('/login/2fa');

    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido');
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('shows the wait time when the API answers 429', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'x' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '600' },
        }),
    );
    const user = userEvent.setup();
    renderPages('/login/2fa');

    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Tente novamente em 10 minutos.',
    );
  });

  it('rejects a malformed code without calling the API', async () => {
    const fetchMock = stubFetch(() => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPages('/login/2fa');

    await user.type(screen.getByLabelText('Código de verificação'), '12');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByText('Código inválido')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('navigates to a safe next path instead of /admin', async () => {
    stubFetch(() => json(200, { ok: true }));
    const user = userEvent.setup();
    renderPages('/login/2fa?next=/admin/cupons');

    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin\/cupons$/);
  });
});

describe('TwoFactorEnrollPage', () => {
  it('enrolls once, shows the QR code and secret, then the 10 recovery codes and continues to /admin', async () => {
    const fetchMock = stubFetch((url) =>
      url === '/api/app/auth/totp/enroll'
        ? json(200, { otpauthUri: OTPAUTH_URI })
        : json(200, { recoveryCodes: RECOVERY_CODES }),
    );
    const user = userEvent.setup();
    renderPages('/login/2fa/configurar', true);

    const qr = await screen.findByRole('img', { name: QR_ALT });
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,QRCODE');
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/app/auth/totp/enroll'),
    ).toHaveLength(1);

    await user.type(screen.getByLabelText('Código de 6 dígitos'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    const list = await screen.findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(10);
    expect(items.map((item) => item.textContent)).toEqual(RECOVERY_CODES);
    const confirmCall = fetchMock.mock.calls.find(
      ([url]) => url === '/api/app/auth/totp/confirm',
    ) as [string, RequestInit];
    expect(confirmCall[1].body).toBe(JSON.stringify({ code: '123456' }));

    await user.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/admin$/);
  });

  it('shows "Código inválido" when confirming with a wrong code', async () => {
    stubFetch((url) =>
      url === '/api/app/auth/totp/enroll'
        ? json(200, { otpauthUri: OTPAUTH_URI })
        : json(401, { error: { code: 'INVALID_CODE', message: 'x' } }),
    );
    const user = userEvent.setup();
    renderPages('/login/2fa/configurar');

    await user.type(await screen.findByLabelText('Código de 6 dígitos'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido');
  });
});
