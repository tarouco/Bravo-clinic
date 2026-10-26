import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { PUBLIC_SERVICE_IDS, publicExtraServices } from '../../features/extras/fixtures';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { plain } from '../../test/session';
import { ExtrasPage } from './ExtrasPage';

function stubApi() {
  server.use(
    http.get('*/api/public/extra-services', () => HttpResponse.json(publicExtraServices)),
    http.get('*/api/public/config', () =>
      HttpResponse.json({ googleEnabled: false, whatsappE164: '+5547999990000' }),
    ),
    http.get('*/api/app/me', () => apiError(401, 'UNAUTHENTICATED', 'Entre para continuar.')),
  );
}

const cardOf = (name: string) => screen.getByRole('heading', { name }).closest('li') as HTMLElement;

describe('ExtrasPage (GES-87)', () => {
  it('lists each active service with its reference price', async () => {
    stubApi();
    renderWithProviders(<ExtrasPage />, '/servicos-extras');

    await screen.findByRole('heading', { name: 'Pacote de filmagem' });
    expect(plain(cardOf('Pacote de filmagem').textContent)).toContain('R$ 80,00/h');
    expect(plain(cardOf('Marketing digital').textContent)).toContain('R$ 1.500,00/projeto');
    expect(within(cardOf('Videomaker')).getByText('Sob consulta')).toBeInTheDocument();
    expect(
      within(cardOf('Pacote de filmagem')).getByText(
        'Câmera, iluminação e operador durante a locação.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the quote form and a WhatsApp link as a secondary action', async () => {
    stubApi();
    renderWithProviders(<ExtrasPage />, '/servicos-extras');

    expect(await screen.findByRole('heading', { name: 'Peça seu orçamento' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Enviar pedido' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Fale pelo WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/5547999990000',
    );
  });

  it('selects the service of the card whose "Solicitar orçamento" is pressed', async () => {
    stubApi();
    const user = userEvent.setup();
    renderWithProviders(<ExtrasPage />, '/servicos-extras');
    await screen.findByRole('heading', { name: 'Pacote de filmagem' });

    await user.click(
      screen.getByRole('button', { name: 'Solicitar orçamento de Marketing digital' }),
    );

    expect(screen.getByLabelText('Serviço')).toHaveValue(PUBLIC_SERVICE_IDS.marketing);
  });

  it('explains the failure when the catalog cannot be loaded', async () => {
    server.use(
      http.get('*/api/public/extra-services', () => apiError(500, 'INTERNAL', 'Erro interno.')),
    );
    renderWithProviders(<ExtrasPage />, '/servicos-extras');

    expect(
      await screen.findByText('Não foi possível carregar os serviços agora.'),
    ).toBeInTheDocument();
  });
});
