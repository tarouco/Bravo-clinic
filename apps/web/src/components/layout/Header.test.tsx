import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../features/auth/useSession';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Header } from './Header';

const sessionState: { session: Session | null } = { session: null };

vi.mock('../../features/auth/useSession', () => ({
  useSession: () => ({ session: sessionState.session, isLoading: false }),
}));

const tenant: Session = {
  id: 'u1',
  name: 'Ana Souza',
  email: 'ana@example.com',
  role: 'tenant',
  emailVerified: true,
  docType: 'cpf',
  mfa: { enrolled: false, verified: false },
};

function renderHeader() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  sessionState.session = null;
});

describe('Header', () => {
  it('renders the nav links with their routes and the location text', () => {
    renderHeader();
    const nav = screen.getByRole('navigation', { name: 'Principal' });

    expect(within(nav).getByRole('link', { name: 'Salas' })).toHaveAttribute('href', '/salas');
    expect(within(nav).getByRole('link', { name: 'Estrutura' })).toHaveAttribute(
      'href',
      '/#estrutura',
    );
    expect(within(nav).getByRole('link', { name: 'Preços & Planos' })).toHaveAttribute(
      'href',
      '/precos',
    );
    expect(within(nav).getByRole('link', { name: 'Serviços Extras' })).toHaveAttribute(
      'href',
      '/servicos-extras',
    );
    expect(within(nav).getByRole('link', { name: 'Contato' })).toHaveAttribute('href', '/contato');
    expect(screen.getByText('Praia Brava - Itajaí')).toBeInTheDocument();
  });

  it('is fixed at the top with an 80px (h-20) bar', () => {
    renderHeader();
    expect(screen.getByRole('banner')).toHaveClass('fixed', 'top-0');
    expect(screen.getByRole('banner').querySelector('.h-20')).not.toBeNull();
  });

  it('links "Login" to /login when there is no session', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: 'Minha conta' })).not.toBeInTheDocument();
  });

  it('links "Minha conta" to /app when a session exists', () => {
    sessionState.session = tenant;
    renderHeader();
    expect(screen.getByRole('link', { name: 'Minha conta' })).toHaveAttribute('href', '/app');
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument();
  });

  it('toggles the menu button aria-expanded from false to true and reveals the links', async () => {
    renderHeader();
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Menu móvel' })).not.toBeInTheDocument();

    await userEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('navigation', { name: 'Menu móvel' });
    expect(within(panel).getByRole('link', { name: 'Salas' })).toHaveAttribute('href', '/salas');
    expect(within(panel).getByRole('link', { name: 'Contato' })).toHaveAttribute(
      'href',
      '/contato',
    );
    expect(within(panel).getAllByRole('link')).toHaveLength(5);
  });

  it('closes the mobile menu after a link is chosen', async () => {
    renderHeader();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const panel = screen.getByRole('navigation', { name: 'Menu móvel' });

    await userEvent.click(within(panel).getByRole('link', { name: 'Preços & Planos' }));

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  });
});
