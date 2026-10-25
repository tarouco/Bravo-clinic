import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundPage } from '../../pages/public/NotFoundPage';
import { createQueryClient } from '../../lib/query-client';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { PublicLayout } from './PublicLayout';

const scrollToMock = vi.fn();

beforeEach(() => {
  scrollToMock.mockClear();
  vi.stubGlobal('scrollTo', scrollToMock);
  // Anonymous visitor, config unavailable: the layout must still render everything.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), {
        status: 401,
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<p>Conteúdo da home</p>} />
              <Route path="/salas" element={<p>Conteúdo das salas</p>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('PublicLayout', () => {
  it('renders header, footer, WhatsApp link and the 404 page with a link to / for an unknown path', () => {
    renderAt('/nao-existe');

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Concierge WhatsApp/ })).toHaveAttribute(
      'href',
      'https://wa.me/',
    );
    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  });

  it('shows the WhatsApp link on two different child routes', () => {
    const home = renderAt('/');
    expect(screen.getByText('Conteúdo da home')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Concierge WhatsApp/ })).toBeInTheDocument();
    home.unmount();

    renderAt('/salas');
    expect(screen.getByText('Conteúdo das salas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Concierge WhatsApp/ })).toBeInTheDocument();
  });

  it('wraps the page content in main with the header offset', () => {
    renderAt('/salas');
    const main = screen.getByRole('main');
    expect(main).toHaveClass('w-full', 'pt-20', 'bg-surface');
    expect(main).toHaveTextContent('Conteúdo das salas');
  });

  it('scrolls the element named by the URL hash into view', () => {
    const scrollIntoView = vi.fn();
    const target = document.createElement('div');
    target.id = 'estrutura';
    target.scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    renderAt('/#estrutura');

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    target.remove();
  });

  it('scrolls to the top when the route has no hash', () => {
    renderAt('/salas');
    expect(scrollToMock).toHaveBeenCalledWith({ top: 0 });
  });
});
