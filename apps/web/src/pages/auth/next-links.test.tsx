import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';

const NEXT = '/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200&etapa=resumo';
const encoded = encodeURIComponent(NEXT);

// NUC-101: an anonymous visitor who leaves Resumo for login or signup comes back to the same URL.
describe('login and signup keep the next path', () => {
  it('login links to signup with the same next', () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      `/login?next=${encoded}`,
    );

    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute(
      'href',
      `/cadastro?next=${encoded}`,
    );
  });

  it('login without next still links to plain /cadastro', () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      '/login',
    );

    expect(screen.getByRole('link', { name: 'Criar conta' })).toHaveAttribute('href', '/cadastro');
  });

  it('signup links back to login with the same next', () => {
    renderWithProviders(
      <Routes>
        <Route path="/cadastro" element={<SignupPage />} />
      </Routes>,
      `/cadastro?next=${encoded}`,
    );

    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      `/login?next=${encoded}`,
    );
  });
});
