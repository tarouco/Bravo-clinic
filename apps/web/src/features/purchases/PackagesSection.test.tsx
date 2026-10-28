import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerRevenueSlots } from '../../extensions/receita';
import { preloadLazySlots, resetSlots } from '../../extensions/slots';
import { PricingPage } from '../../pages/public/PricingPage';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { spaced } from '../../test/text';
import { meioTurno, pacote20h, packageOffers } from './fixtures';
import { PackagesSection } from './PackagesSection';

// Slot bodies load lazily (GES-143): load them once up front, so a busy machine spends the
// module loading time here rather than inside a test's wait.
beforeAll(async () => {
  await preloadLazySlots();
}, 120_000);

afterEach(() => {
  resetSlots();
});

const stubPackages = (items: unknown[] = packageOffers.items) =>
  server.use(http.get('*/api/public/packages', () => HttpResponse.json({ items })));

const SKELETON = { name: 'Carregando pacotes' };

// REC-155: /precos lists the active public packages with an "Assinar" button.
describe('PackagesSection (REC-155)', () => {
  it('renders the "Pacotes de horas" and "Horário fixo" groups with the fixture cards', async () => {
    stubPackages();
    renderWithProviders(<PackagesSection />);

    expect(await screen.findByRole('heading', { name: 'Pacotes de horas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horário fixo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: pacote20h.name })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: meioTurno.name })).toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 1.600,00'))).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Assinar' })).toHaveLength(2);
  });

  it('shows a skeleton while the offers load', () => {
    server.use(http.get('*/api/public/packages', () => new Promise(() => undefined)));
    renderWithProviders(<PackagesSection />);

    expect(screen.getByRole('status', SKELETON)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pacotes de horas' })).not.toBeInTheDocument();
  });

  it('hides the whole section when no package is on offer', async () => {
    stubPackages([]);
    renderWithProviders(<PackagesSection />);

    await waitFor(() => {
      expect(screen.queryByRole('status', SKELETON)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows only the group that has offers', async () => {
    stubPackages([pacote20h]);
    renderWithProviders(<PackagesSection />);

    expect(await screen.findByRole('heading', { name: 'Pacotes de horas' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Horário fixo' })).not.toBeInTheDocument();
  });

  it('hides the section when the offers fail to load', async () => {
    server.use(
      http.get('*/api/public/packages', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'Erro' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<PackagesSection />);

    await waitFor(() => {
      expect(screen.queryByRole('status', SKELETON)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('PricingPage with receita slots (REC-155)', () => {
  it('shows the packages section after the avulsas section', async () => {
    stubPackages();
    registerRevenueSlots();
    renderWithProviders(<PricingPage />);

    const blocks = await screen.findByRole('table', { name: 'Blocos fechados' });
    const groups = await screen.findByRole('heading', { name: 'Pacotes de horas' });
    expect(blocks.compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
