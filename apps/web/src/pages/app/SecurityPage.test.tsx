import { totpDisableResponseSchema } from '@bravo/core';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../features/auth/useSession';
import { renderWithProviders } from '../../test/render-with-providers';
import { SecurityPage } from './SecurityPage';

// jsdom has no canvas, which the browser build of qrcode draws on.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QRCODE') },
}));

const QR_ALT = 'QR code para o aplicativo autenticador';
const OTPAUTH_URI =
  'otpauth://totp/Brav%C3%B4%20Clinic:ana%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Brav%C3%B4%20Clinic';
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `ABCD-EF${String(i + 2)}H`);

const tenant: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};
const enrolled: Session = { ...tenant, mfa: { enrolled: true, verified: true } };

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Handler = (init: RequestInit) => Response;

/** `/api/app/me` answers with the session; the TOTP endpoints with the given handlers. */
function stubApi(session: Session, handlers: Record<string, Handler> = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit = {}) => {
    if (url === '/api/app/me') return Promise.resolve(json(200, session));
    const handler = handlers[url];
    return Promise.resolve(
      handler ? handler(init) : json(404, { error: { code: 'NOT_FOUND', message: 'x' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    callsTo: (url: string) =>
      fetchMock.mock.calls.filter(([called]) => called === url) as [string, RequestInit][],
  };
}

const ENROLL = '/api/app/auth/totp/enroll';
const CONFIRM = '/api/app/auth/totp/confirm';
const DISABLE = '/api/app/auth/totp/disable';

function renderPage(strict = false) {
  const page = strict ? (
    <StrictMode>
      <SecurityPage />
    </StrictMode>
  ) : (
    <SecurityPage />
  );
  return renderWithProviders(page, '/app/perfil/seguranca');
}

const section = () => screen.getByRole('region', { name: 'Verificação em duas etapas' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SecurityPage: turning two-factor authentication on (FND-135)', () => {
  it('shows it off with "Ativar", and enrollment never starts on its own', async () => {
    const { callsTo } = stubApi(tenant);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Ativar' })).toBeInTheDocument();
    expect(within(section()).getByText('Desativada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
    expect(callsTo(ENROLL)).toHaveLength(0);
  });

  it('runs the enrollment inline: one enroll call, QR and key, confirm, recovery codes once, then "on"', async () => {
    const { callsTo } = stubApi(tenant, {
      [ENROLL]: () => json(200, { otpauthUri: OTPAUTH_URI }),
      [CONFIRM]: () => json(200, { recoveryCodes: RECOVERY_CODES }),
    });
    const user = userEvent.setup();
    renderPage(true);

    await user.click(await screen.findByRole('button', { name: 'Ativar' }));

    const qr = await screen.findByRole('img', { name: QR_ALT });
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,QRCODE');
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(callsTo(ENROLL)).toHaveLength(1);

    await user.type(screen.getByLabelText('Código de 6 dígitos'), '123 456');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    const list = await screen.findByRole('list', { name: 'Códigos de recuperação' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(RECOVERY_CODES);
    expect(callsTo(CONFIRM)[0]?.[1].body).toBe(JSON.stringify({ code: '123456' }));

    await user.click(screen.getByRole('button', { name: 'Já guardei os códigos' }));

    expect(await screen.findByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    expect(within(section()).getByText('Ativada')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Códigos de recuperação' })).not.toBeInTheDocument();
    expect(callsTo(ENROLL)).toHaveLength(1);
  });

  it('shows "Código inválido" when the first code is wrong and stays in the enrollment', async () => {
    stubApi(tenant, {
      [ENROLL]: () => json(200, { otpauthUri: OTPAUTH_URI }),
      [CONFIRM]: () => json(401, { error: { code: 'INVALID_CODE', message: 'x' } }),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Ativar' }));
    await user.type(await screen.findByLabelText('Código de 6 dígitos'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido');
    expect(within(section()).getByText('Desativada')).toBeInTheDocument();
  });
});

describe('SecurityPage: turning two-factor authentication off (FND-136)', () => {
  it('asks for a code, posts it normalized and comes back "off"', async () => {
    const { callsTo } = stubApi(enrolled, {
      [DISABLE]: () =>
        json(200, totpDisableResponseSchema.parse({ mfa: { enrolled: false, verified: false } })),
    });
    const user = userEvent.setup();
    renderPage();

    expect(
      within(await screen.findByRole('region', { name: 'Verificação em duas etapas' })).getByText(
        'Ativada',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desativar' }));
    await user.type(screen.getByLabelText('Código de verificação'), 'abcd-efgh');
    await user.click(screen.getByRole('button', { name: 'Desativar verificação' }));

    expect(await screen.findByRole('button', { name: 'Ativar' })).toBeInTheDocument();
    expect(within(section()).getByText('Desativada')).toBeInTheDocument();
    expect(screen.getByText('A verificação em duas etapas foi desativada.')).toBeInTheDocument();
    const [call] = callsTo(DISABLE);
    expect(call?.[1].method).toBe('POST');
    expect(call?.[1].body).toBe(JSON.stringify({ code: 'ABCD-EFGH' }));
  });

  it('keeps it on with "Código inválido" when the API refuses the code', async () => {
    stubApi(enrolled, {
      [DISABLE]: () => json(401, { error: { code: 'INVALID_CODE', message: 'x' } }),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Desativar' }));
    await user.type(screen.getByLabelText('Código de verificação'), '123456');
    await user.click(screen.getByRole('button', { name: 'Desativar verificação' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido');
    expect(within(section()).getByText('Ativada')).toBeInTheDocument();
  });

  it('rejects a malformed code without calling the API, and "Cancelar" goes back', async () => {
    const { callsTo } = stubApi(enrolled, { [DISABLE]: () => json(200, {}) });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Desativar' }));
    await user.type(screen.getByLabelText('Código de verificação'), '12');
    await user.click(screen.getByRole('button', { name: 'Desativar verificação' }));
    expect(await screen.findByText('Código inválido')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Código de verificação')).not.toBeInTheDocument();
    expect(callsTo(DISABLE)).toHaveLength(0);
  });
});

describe('SecurityPage: way back', () => {
  it('links a tenant back to the profile and staff back to the panel', async () => {
    stubApi(tenant);
    const { unmount } = renderPage();
    expect(await screen.findByRole('link', { name: 'Voltar ao perfil' })).toHaveAttribute(
      'href',
      '/app/perfil',
    );
    unmount();
    vi.unstubAllGlobals();

    stubApi({ ...tenant, role: 'reception' });
    renderPage();
    expect(await screen.findByRole('link', { name: 'Voltar ao painel' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});
