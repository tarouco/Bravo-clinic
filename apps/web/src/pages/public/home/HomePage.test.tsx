import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../../lib/query-client';
import { appRoutes } from '../../../router';
import { stubClinicConfig } from '../../../test/render-with-providers';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import { HOME_TITLE } from './HomePage';

const scrollIntoViewMock = vi.fn();

beforeEach(() => {
  scrollIntoViewMock.mockReset();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
  vi.stubGlobal('scrollTo', vi.fn());
  stubClinicConfig('+5547999990000');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderHome() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** True when `later` comes after `earlier` in document order. */
const follows = (earlier: Element, later: Element) =>
  Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('HomePage', () => {
  it('mounts at / inside the public layout and sets the document title', () => {
    renderHome();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(document.title).toBe(HOME_TITLE);
    expect(HOME_TITLE).toBe('Bravô Clinic – Salas Inteligentes | Praia Brava, Itajaí');
  });

  it('renders the sections in spec order: hero, estrutura, salas, simulador, extras, comodidade, políticas, CTA', () => {
    const { container } = renderHome();

    const ordered = [
      screen.getByRole('heading', { level: 1, name: /Saúde, beleza e bem-estar/ }),
      container.querySelector('#estrutura'),
      container.querySelector('#salas'),
      container.querySelector('#simulador'),
      screen.getByRole('heading', { name: 'Potencialize sua marca e captação de clientes.' }),
      screen.getByRole('heading', { name: 'Estrutura completa para você focar no atendimento.' }),
      screen.getByRole('heading', { name: 'Políticas de reserva, sinal e cancelamento' }),
      screen.getByRole('heading', { name: 'Pronto para elevar o padrão dos seus atendimentos?' }),
    ];

    ordered.forEach((node, index) => {
      expect(node).not.toBeNull();
      const previous = ordered[index - 1];
      if (index > 0 && previous && node) expect(follows(previous, node)).toBe(true);
    });
  });

  it('contains no reference to São Paulo or Jardins', () => {
    const { container } = renderHome();

    expect(container.textContent).not.toMatch(/São Paulo|Sao Paulo|Jardins/);
  });

  it('"Reservar Sala" on Sala Terceira scrolls smoothly to #simulador', async () => {
    renderHome();
    const card = screen
      .getByRole('heading', { level: 3, name: 'Sala Terceira' })
      .closest('article');
    if (!card) throw new Error('Sala Terceira card not found');

    await userEvent.click(within(card).getByRole('button', { name: 'Reservar Sala' }));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' });
    const target = scrollIntoViewMock.mock.contexts[0] as HTMLElement;
    expect(target.id).toBe('simulador');
  });
});
