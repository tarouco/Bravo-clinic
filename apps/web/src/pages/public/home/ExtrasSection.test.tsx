import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, stubClinicConfig } from '../../../test/render-with-providers';
import { ExtrasSection } from './ExtrasSection';

const openMock = vi.fn();

beforeEach(() => {
  openMock.mockReset();
  vi.stubGlobal('open', openMock);
  stubClinicConfig('+5547999990000');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openVideomakerQuote() {
  const card = screen.getByRole('heading', { name: 'Videomaker Dedicado' }).closest('article');
  if (!card) throw new Error('Videomaker card not found');
  await userEvent.click(within(card).getByRole('button', { name: 'Solicitar Orçamento' }));
  return screen.getByRole('dialog');
}

describe('ExtrasSection', () => {
  it('renders the three services and the corrected "any room" chip, without Jardins', () => {
    const { container } = renderWithProviders(<ExtrasSection />);

    expect(screen.getByRole('heading', { name: 'Pacote Filmagem & Gravação' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Videomaker Dedicado' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Marketing para Saúde' })).toBeInTheDocument();
    expect(screen.getByText('Disponível em qualquer sala')).toBeInTheDocument();
    expect(screen.queryByText(/Exclusivo Salas/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Jardins|São Paulo|Sao Paulo/);
    expect(container.textContent).toMatch(/Praia Brava, Itajaí e região/);
    expect(screen.getAllByRole('button', { name: 'Solicitar Orçamento' })).toHaveLength(3);
  });

  it('opens a dialog titled with the service when "Solicitar Orçamento" is clicked', async () => {
    renderWithProviders(<ExtrasSection />);

    const dialog = await openVideomakerQuote();

    expect(
      within(dialog).getByRole('heading', { name: 'Videomaker Dedicado' }),
    ).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName('Videomaker Dedicado');
  });

  it('submits to WhatsApp in a new tab with service, name and details, then closes', async () => {
    renderWithProviders(<ExtrasSection />);
    await openVideomakerQuote();
    // The number comes from /api/public/config, requested once the form is on screen.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText('Seu Nome Completo'), 'Dra. Mariana Costa');
    await userEvent.type(screen.getByLabelText('WhatsApp de Contato'), '47987654321');
    await userEvent.type(screen.getByLabelText(/Detalhes do Atendimento/), '4 horas de gravação');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar Pedido pelo WhatsApp' }));

    expect(openMock).toHaveBeenCalledTimes(1);
    const [url, target, features] = openMock.mock.calls[0] as [string, string, string];
    expect(url.startsWith('https://wa.me/')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/5547999990000');
    expect(parsed.searchParams.get('text')).toBe(
      'Olá! Quero um orçamento de Videomaker Dedicado.\n' +
        'Nome: Dra. Mariana Costa\n' +
        'WhatsApp: (47) 98765-4321\n' +
        'Detalhes: 4 horas de gravação',
    );
    expect(target).toBe('_blank');
    expect(features).toBe('noopener');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a required error and does not open WhatsApp when the name is empty', async () => {
    renderWithProviders(<ExtrasSection />);
    await openVideomakerQuote();

    await userEvent.type(screen.getByLabelText('WhatsApp de Contato'), '47987654321');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar Pedido pelo WhatsApp' }));

    expect(screen.getByText(/Campo obrigatório: informe seu nome/)).toBeInTheDocument();
    expect(screen.getByLabelText('Seu Nome Completo')).toHaveAttribute('aria-invalid', 'true');
    expect(openMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('requires the WhatsApp number too', async () => {
    renderWithProviders(<ExtrasSection />);
    await openVideomakerQuote();

    await userEvent.type(screen.getByLabelText('Seu Nome Completo'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar Pedido pelo WhatsApp' }));

    expect(screen.getByText(/Campo obrigatório: informe seu WhatsApp/)).toBeInTheDocument();
    expect(openMock).not.toHaveBeenCalled();
  });

  it('falls back to the bare wa.me link when the clinic number is unknown', async () => {
    stubClinicConfig(null);
    renderWithProviders(<ExtrasSection />);
    await openVideomakerQuote();

    await userEvent.type(screen.getByLabelText('Seu Nome Completo'), 'Ana');
    await userEvent.type(screen.getByLabelText('WhatsApp de Contato'), '47987654321');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar Pedido pelo WhatsApp' }));

    const [url] = openMock.mock.calls[0] as [string];
    expect(new URL(url).pathname).toBe('/');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
  });
});
