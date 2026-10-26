import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { registerSlot, resetSlots } from '../../extensions/slots';
import { clinic, policies } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { ContactPage, MAPS_URL } from './ContactPage';
import { LegalPage } from './LegalPage';
import { PoliciesPage } from './PoliciesPage';
import { PricingPage } from './PricingPage';

afterEach(() => {
  resetSlots();
});

/** Cell texts of the body rows of a table, with U+00A0 read as a plain space. */
function rowsOf(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => (cell.textContent ?? '').replace(/\u00a0/g, ' ')),
    );
}

describe('PricingPage (NUC-183)', () => {
  it('lists the 4 hourly categories with window, minimum duration and weekday/weekend rates', async () => {
    renderWithProviders(<PricingPage />);

    const table = await screen.findByRole('table', { name: 'Tarifas por hora' });
    expect(rowsOf(table)).toEqual([
      ['1 hora', '00:00–19:00', '1h', 'R$ 97,00/h', 'R$ 120,00/h'],
      ['2 horas ou mais', '00:00–19:00', '2h', 'R$ 80,00/h', 'R$ 99,00/h'],
      ['1 hora — noite', '19:00–00:00', '1h', 'R$ 120,00/h', 'R$ 120,00/h'],
      ['2 horas ou mais — noite', '19:00–00:00', '2h', 'R$ 99,00/h', 'R$ 99,00/h'],
    ]);
  });

  it('lists the block categories with their price and average hourly value', async () => {
    renderWithProviders(<PricingPage />);

    const table = await screen.findByRole('table', { name: 'Blocos fechados' });
    expect(rowsOf(table)[0]).toEqual([
      'Meio turno comercial',
      'Seg a sex',
      '07:00–09:30',
      'R$ 280,00',
      'R$ 112,00/h',
    ]);
  });

  it('renders the pricing.packages slot after the tables', async () => {
    registerSlot('pricing.packages', () => <section>Pacotes mensais (fake)</section>);
    renderWithProviders(<PricingPage />);

    const hourly = await screen.findByRole('table', { name: 'Tarifas por hora' });
    const packages = screen.getByText('Pacotes mensais (fake)');
    expect(
      hourly.compareDocumentPosition(packages) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('PoliciesPage (NUC-184)', () => {
  it('renders every section of the public policies and the version', async () => {
    renderWithProviders(<PoliciesPage />);

    for (const section of policies.sections) {
      expect(await screen.findByRole('heading', { name: section.title })).toBeInTheDocument();
      expect(screen.getByText(section.paragraphs[0] as string)).toBeInTheDocument();
    }
    expect(screen.getByText('Versão da política: 1')).toBeInTheDocument();
  });
});

describe('ContactPage (NUC-185)', () => {
  it('shows the address, the exact Google Maps link and the WhatsApp link', async () => {
    renderWithProviders(<ContactPage />);

    expect(await screen.findByText(/Praia Brava, Itajaí - SC/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir no Google Maps' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=Praia%20Brava%2C%20Itaja%C3%AD%20-%20SC',
    );
    expect(MAPS_URL).toBe(
      'https://www.google.com/maps/search/?api=1&query=Praia%20Brava%2C%20Itaja%C3%AD%20-%20SC',
    );
    expect(screen.getByRole('link', { name: 'Falar no WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/5547999990000',
    );
  });

  it('shows the contact e-mail and the opening hours of each day', async () => {
    renderWithProviders(<ContactPage />);

    expect(await screen.findByRole('link', { name: 'contato@bravoclinic.com.br' })).toHaveAttribute(
      'href',
      'mailto:contato@bravoclinic.com.br',
    );
    const hours = screen.getByRole('heading', { name: 'Horário de funcionamento' }).parentElement;
    const rows = within(hours as HTMLElement)
      .getAllByText(/-feira|Sábado|Domingo|Feriados/)
      .map((dt) => dt.parentElement?.textContent);
    expect(rows).toEqual([
      'Segunda-feira07:00 às 00:00',
      'Terça-feira07:00 às 00:00',
      'Quarta-feira07:00 às 00:00',
      'Quinta-feira07:00 às 00:00',
      'Sexta-feira07:00 às 00:00',
      'Sábado09:00 às 00:00',
      'DomingoFechado',
      'Feriados09:00 às 00:00',
    ]);
  });

  it('omits the e-mail line when the clinic has none', async () => {
    server.use(
      http.get('*/api/public/clinic', () => HttpResponse.json({ ...clinic, contactEmail: '' })),
    );
    renderWithProviders(<ContactPage />);

    await screen.findByText(/Praia Brava, Itajaí - SC/);
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
  });
});

describe('LegalPage (NUC-186)', () => {
  it('renders the terms with their version line', () => {
    renderWithProviders(<LegalPage kind="termos" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Termos de uso' })).toBeInTheDocument();
    expect(screen.getByText('Versão terms-2026-10')).toBeInTheDocument();
    expect(document.title).toContain('Termos de uso');
  });

  it('renders the privacy policy with its version line, list items and bold text', () => {
    const { container } = renderWithProviders(<LegalPage kind="privacidade" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Política de privacidade' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Versão privacy-2026-10')).toBeInTheDocument();
    expect(container.querySelectorAll('li').length).toBeGreaterThan(3);
    expect(container.querySelector('strong')).toHaveTextContent('Cadastro:');
  });
});
