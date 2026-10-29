import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_SERVICE_IDS, publicExtraServices } from '../../../features/extras/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { ExtrasSection } from './ExtrasSection';

const openMock = vi.fn();
let posts: Record<string, unknown>[] = [];

beforeEach(() => {
  openMock.mockReset();
  posts = [];
  vi.stubGlobal('open', openMock);
  server.use(
    http.get('*/api/public/extra-services', () => HttpResponse.json(publicExtraServices)),
    http.get('*/api/public/config', () =>
      HttpResponse.json({ googleEnabled: false, whatsappE164: '+5547999990000' }),
    ),
    http.get('*/api/app/me', () => apiError(401, 'UNAUTHENTICATED', 'Entre para continuar.')),
    http.post('*/api/public/quote-requests', async ({ request }) => {
      posts.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 'q1' }, { status: 201 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openVideomakerQuote() {
  const card = screen.getByRole('heading', { name: 'Videomaker Dedicado' }).closest('article');
  if (!card) throw new Error('Videomaker card not found');
  await userEvent.click(within(card).getByRole('button', { name: 'Solicitar orçamento' }));
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
    expect(screen.getAllByRole('button', { name: 'Solicitar orçamento' })).toHaveLength(3);
  });

  it('opens a dialog titled with the service when "Solicitar orçamento" is clicked', async () => {
    renderWithProviders(<ExtrasSection />);

    const dialog = await openVideomakerQuote();

    expect(
      within(dialog).getByRole('heading', { name: 'Videomaker Dedicado' }),
    ).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName('Videomaker Dedicado');
  });

  it('preselects the matching catalog service in the dialog form', async () => {
    renderWithProviders(<ExtrasSection />);
    const dialog = await openVideomakerQuote();

    await waitFor(() =>
      expect(within(dialog).getByLabelText('Serviço')).toHaveValue(PUBLIC_SERVICE_IDS.videomaker),
    );
  });

  it('posts the request to the API instead of opening WhatsApp, and shows the confirmation (GES-98)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExtrasSection />);
    const dialog = await openVideomakerQuote();
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Serviço')).toHaveValue(PUBLIC_SERVICE_IDS.videomaker),
    );

    await user.type(within(dialog).getByLabelText('Seu nome completo'), 'Dra. Mariana Costa');
    await user.type(within(dialog).getByLabelText('WhatsApp de contato'), '47987654321');
    await user.type(within(dialog).getByLabelText('O que você precisa'), '4 horas de gravação');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));

    expect(await within(dialog).findByText('Pedido enviado. Retornaremos em breve.')).toBeVisible();
    expect(posts).toEqual([
      {
        serviceId: PUBLIC_SERVICE_IDS.videomaker,
        name: 'Dra. Mariana Costa',
        phone: '+5547987654321',
        description: '4 horas de gravação',
        website: '',
      },
    ]);
    expect(openMock).not.toHaveBeenCalled();
  });

  it('keeps WhatsApp as a secondary link with the service in the message (GES-98)', async () => {
    renderWithProviders(<ExtrasSection />);
    const dialog = await openVideomakerQuote();

    const link = await within(dialog).findByRole('link', { name: 'Pedir pelo WhatsApp' });
    await waitFor(() =>
      expect(new URL(link.getAttribute('href') ?? '').pathname).toBe('/5547999990000'),
    );
    expect(new URL(link.getAttribute('href') ?? '').searchParams.get('text')).toBe(
      'Olá, quero um orçamento de Videomaker Dedicado.',
    );
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('falls back to the bare wa.me link when the clinic number is unknown', async () => {
    server.use(http.get('*/api/public/config', () => apiError(500, 'INTERNAL', 'Erro interno.')));
    renderWithProviders(<ExtrasSection />);
    const dialog = await openVideomakerQuote();

    const link = await within(dialog).findByRole('link', { name: 'Pedir pelo WhatsApp' });

    expect(link.getAttribute('href')?.startsWith('https://wa.me/?text=')).toBe(true);
  });

  it('shows the required errors and sends nothing when the form is empty', async () => {
    renderWithProviders(<ExtrasSection />);
    const dialog = await openVideomakerQuote();

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Enviar pedido' }));

    expect(
      await within(dialog).findByText('Informe seu nome com pelo menos 2 caracteres'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Seu nome completo')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(posts).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
