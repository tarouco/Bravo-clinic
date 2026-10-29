import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicConfig } from '../../features/config/useClinicConfig';
import { Footer } from './Footer';

const configState: { config: ClinicConfig } = {
  config: { googleEnabled: false, whatsappE164: '' },
};

vi.mock('../../features/config/useClinicConfig', () => ({
  useClinicConfig: () => configState.config,
}));

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  configState.config = { googleEnabled: false, whatsappE164: '' };
});

describe('Footer', () => {
  it('renders the Navegação, Diretrizes and Atendimento headings', () => {
    renderFooter();
    expect(screen.getByRole('heading', { name: 'Navegação' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Diretrizes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Atendimento' })).toBeInTheDocument();
  });

  it('shows the Praia Brava address and the corrected hours, with no São Paulo or Jardins', () => {
    renderFooter();
    expect(screen.getByText('Praia Brava, Itajaí – SC')).toBeInTheDocument();
    expect(
      screen.getByText('Seg a sex 07:00–00:00 · Sáb, dom e feriados 09:00–00:00'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/São Paulo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Jardins/)).not.toBeInTheDocument();
  });

  it('is the emerald-deep band with on-emerald text and gold headings', () => {
    renderFooter();
    expect(screen.getByRole('contentinfo')).toHaveClass('bg-emerald-deep', 'text-on-emerald');
    expect(screen.getByRole('heading', { name: 'Navegação' })).toHaveClass('text-gold');
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toHaveClass('hover:text-gold');
  });

  it('shows the copyright text', () => {
    renderFooter();
    expect(
      screen.getByText(
        '© 2026 Bravô Clinic • Salas Inteligentes. Todos os direitos reservados. Saúde • Beleza • Bem-estar.',
      ),
    ).toBeInTheDocument();
  });

  it('maps the footer links to the site routes', () => {
    renderFooter();
    const expected: Record<string, string> = {
      'Salas Clínicas': '/salas',
      'Estrutura & Amenidades': '/estrutura',
      'Preços & Assinaturas': '/precos',
      'Serviços Extras & Apoio': '/servicos-extras',
      'Regras de Reserva & Cancelamento': '/politicas',
      'Termos de Uso': '/termos',
      'Política de Privacidade (LGPD)': '/privacidade',
      'Área do Profissional Locatário': '/login',
      'Ouvidoria & Atendimento': '/contato',
    };
    for (const [name, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('shows the e-mail from the config only when present', () => {
    const { unmount } = renderFooter();
    expect(screen.queryByText('contato@bravoclinic.com.br')).not.toBeInTheDocument();
    unmount();

    configState.config = {
      googleEnabled: false,
      whatsappE164: '',
      contactEmail: 'contato@bravoclinic.com.br',
    };
    renderFooter();
    expect(screen.getByText('contato@bravoclinic.com.br')).toBeInTheDocument();
  });
});
