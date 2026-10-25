import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { AppHomePage } from '../app/AppHomePage';
import { SignupPage } from './SignupPage';

const created = {
  user: {
    id: 'u1',
    name: 'Ana Souza',
    email: 'ana@example.com',
    role: 'tenant',
    emailVerified: false,
    docType: 'cpf',
    mfa: { enrolled: false, verified: false },
  },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubSignup(response: () => Response) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSignup() {
  return renderWithProviders(
    <Routes>
      <Route path="/cadastro" element={<SignupPage />} />
      <Route path="/app" element={<AppHomePage />} />
    </Routes>,
    '/cadastro',
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function fillForm(user: User, document = '529.982.247-25') {
  await user.type(screen.getByLabelText('Nome completo'), 'Ana Souza');
  await user.type(screen.getByLabelText('CPF ou CNPJ'), document);
  await user.type(screen.getByLabelText('E-mail'), 'Ana@Example.com');
  await user.type(screen.getByLabelText('Telefone'), '47999990000');
  await user.type(screen.getByLabelText('Senha'), 'Senha1234');
}

async function acceptBoth(user: User) {
  await user.click(screen.getByRole('checkbox', { name: /Termos de uso/ }));
  await user.click(screen.getByRole('checkbox', { name: /Política de privacidade/ }));
}

const submitButton = () => screen.getByRole('button', { name: 'Criar conta' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignupPage', () => {
  it('shows "CPF ou CNPJ inválido" under the field and makes no API call for a wrong check digit', async () => {
    const fetchMock = stubSignup(() => json(201, created));
    const user = userEvent.setup();
    renderSignup();

    await fillForm(user, '529.982.247-24');
    await acceptBoth(user);
    await user.click(submitButton());

    const message = await screen.findByText('CPF ou CNPJ inválido');
    expect(screen.getByLabelText('CPF ou CNPJ')).toHaveAttribute('aria-describedby', message.id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps submit disabled until both checkboxes are checked and links the legal pages', async () => {
    stubSignup(() => json(201, created));
    const user = userEvent.setup();
    renderSignup();

    expect(submitButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Termos de uso/ }));
    expect(submitButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Política de privacidade/ }));
    expect(submitButton()).toBeEnabled();

    expect(screen.getByRole('link', { name: 'Termos de uso' })).toHaveAttribute('href', '/termos');
    expect(screen.getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute(
      'href',
      '/privacidade',
    );
  });

  it('navigates to /app with the confirmation banner on 201 and posts the normalized values', async () => {
    const fetchMock = stubSignup(() => json(201, created));
    const user = userEvent.setup();
    renderSignup();

    await fillForm(user);
    await acceptBoth(user);
    await user.click(submitButton());

    expect(
      await screen.findByText('Enviamos um link de confirmação para o seu e-mail.'),
    ).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/public/auth/signup');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Ana Souza',
      document: '529.982.247-25',
      email: 'ana@example.com',
      phone: '+5547999990000',
      password: 'Senha1234',
      acceptTerms: true,
      acceptPrivacy: true,
    });
  });

  it('shows "Este e-mail já está cadastrado." under the e-mail field on 409 EMAIL_TAKEN', async () => {
    stubSignup(() => json(409, { error: { code: 'EMAIL_TAKEN', message: 'x' } }));
    const user = userEvent.setup();
    renderSignup();

    await fillForm(user);
    await acceptBoth(user);
    await user.click(submitButton());

    const message = await screen.findByText('Este e-mail já está cadastrado.');
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-describedby', message.id);
  });

  it('shows "Este CPF/CNPJ já está cadastrado." under the document field on 409 DOCUMENT_TAKEN', async () => {
    stubSignup(() => json(409, { error: { code: 'DOCUMENT_TAKEN', message: 'x' } }));
    const user = userEvent.setup();
    renderSignup();

    await fillForm(user);
    await acceptBoth(user);
    await user.click(submitButton());

    const message = await screen.findByText('Este CPF/CNPJ já está cadastrado.');
    expect(screen.getByLabelText('CPF ou CNPJ')).toHaveAttribute('aria-describedby', message.id);
  });
});
