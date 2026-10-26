import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { QuoteRequest } from '../../../features/admin-extras/contracts';
import {
  buildQuotePage,
  extraServices,
  QUOTE_IDS,
  quoteRequests,
  SERVICE_IDS,
} from '../../../features/admin-extras/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { ExtrasAdminPage } from './ExtrasAdminPage';

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

interface Calls {
  posts: Record<string, unknown>[];
  patches: { id: string; body: Record<string, unknown> }[];
  quotePatches: { id: string; body: Record<string, unknown> }[];
}

/** Stateful stubs: a quote PATCH with a status moves the request in the list. */
function stubApi(): Calls {
  const calls: Calls = { posts: [], patches: [], quotePatches: [] };
  let quotes: QuoteRequest[] = quoteRequests.map((q) => ({ ...q }));
  server.use(
    http.get('*/api/admin/extra-services', () => HttpResponse.json(extraServices)),
    http.post('*/api/admin/extra-services', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.posts.push(body);
      return HttpResponse.json(
        { ...body, id: 'e1000000-0000-4000-8000-0000000000ff' },
        { status: 201 },
      );
    }),
    http.patch('*/api/admin/extra-services/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.patches.push({ id: String(params['id']), body });
      return HttpResponse.json({ ...body, id: params['id'] });
    }),
    http.get('*/api/admin/quote-requests', () => HttpResponse.json(buildQuotePage(quotes))),
    http.patch('*/api/admin/quote-requests/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.quotePatches.push({ id: String(params['id']), body });
      quotes = quotes.map((q) => (q.id === params['id'] ? { ...q, ...body } : q));
      return HttpResponse.json(quotes.find((q) => q.id === params['id']));
    }),
  );
  return calls;
}

function renderPage(route = '/admin/servicos-extras') {
  const calls = stubApi();
  renderWithProviders(
    <>
      <ExtrasAdminPage />
      <Probe />
    </>,
    route,
  );
  return calls;
}

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;
const column = (name: string) => screen.getByRole('region', { name });

describe('Serviços tab (GES-84)', () => {
  it('lists the services with price, unit, sale mode, status and order', async () => {
    renderPage();
    await screen.findByText('Pacote de filmagem');

    expect(
      within(rowOf('Pacote de filmagem'))
        .getAllByRole('cell')
        .map((c) => plain(c.textContent)),
    ).toEqual([
      'Pacote de filmagem',
      'R$ 80,00/h',
      'Hora',
      'Sob orçamento',
      'Ativo',
      '1',
      expect.stringContaining('Editar'),
    ]);
    expect(within(rowOf('Videomaker')).getByText('Sob consulta')).toBeInTheDocument();
    expect(within(rowOf('Marketing digital')).getByText('R$ 1.500,00/projeto')).toBeInTheDocument();
    expect(within(rowOf('Edição de vídeo')).getByText('Inativo')).toBeInTheDocument();
    expect(within(rowOf('Edição de vídeo')).getByText('Venda online')).toBeInTheDocument();
  });

  it('refuses online sale without a price on the price field and sends nothing (GES-85)', async () => {
    const calls = renderPage();
    await screen.findByText('Pacote de filmagem');

    await userEvent.click(screen.getByRole('button', { name: 'Novo serviço' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo serviço' });
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Fotografia');
    await userEvent.selectOptions(within(dialog).getByLabelText('Forma de venda'), 'Venda online');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }));

    expect(
      await within(dialog).findByText('Informe o preço para vender online'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Preço de referência (R$)')).toBeInvalid();
    expect(calls.posts).toEqual([]);
  });

  it('shows the core name message on an empty form', async () => {
    const calls = renderPage();
    await screen.findByText('Pacote de filmagem');

    await userEvent.click(screen.getByRole('button', { name: 'Novo serviço' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo serviço' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }));

    expect(
      await within(dialog).findByText('Informe o nome do serviço com pelo menos 2 caracteres'),
    ).toBeInTheDocument();
    expect(calls.posts).toEqual([]);
  });

  it('creates a service with the price in cents and the next display order', async () => {
    const calls = renderPage();
    await screen.findByText('Pacote de filmagem');

    await userEvent.click(screen.getByRole('button', { name: 'Novo serviço' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo serviço' });
    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Fotografia');
    await userEvent.type(within(dialog).getByLabelText('Descrição'), 'Ensaio de 1 hora.');
    await userEvent.type(within(dialog).getByLabelText('Preço de referência (R$)'), '120,00');
    await userEvent.selectOptions(within(dialog).getByLabelText('Unidade'), 'Hora');
    await userEvent.selectOptions(within(dialog).getByLabelText('Forma de venda'), 'Venda online');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }));

    await waitFor(() => {
      expect(calls.posts).toEqual([
        {
          name: 'Fotografia',
          description: 'Ensaio de 1 hora.',
          referencePriceCents: 12000,
          unit: 'hour',
          saleMode: 'online',
          status: 'active',
          displayOrder: 5,
        },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Novo serviço' })).not.toBeInTheDocument();
    });
  });

  it('edits a service with the whole body, an empty price meaning "Sob consulta"', async () => {
    const calls = renderPage();
    await screen.findByText('Pacote de filmagem');

    await userEvent.click(
      within(rowOf('Pacote de filmagem')).getByRole('button', {
        name: 'Editar Pacote de filmagem',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar serviço' });
    expect(within(dialog).getByLabelText('Preço de referência (R$)')).toHaveValue('80,00');
    await userEvent.clear(within(dialog).getByLabelText('Preço de referência (R$)'));
    await userEvent.selectOptions(within(dialog).getByLabelText('Situação'), 'Inativo');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }));

    await waitFor(() => {
      expect(calls.patches).toEqual([
        {
          id: SERVICE_IDS.filming,
          body: {
            name: 'Pacote de filmagem',
            description: 'Câmera, iluminação e operador durante a locação.',
            referencePriceCents: null,
            unit: 'hour',
            saleMode: 'quote',
            status: 'inactive',
            displayOrder: 1,
          },
        },
      ]);
    });
  });

  it('puts the server 422 on its field and keeps the form open', async () => {
    renderPage();
    await screen.findByText('Pacote de filmagem');
    server.use(
      http.patch('*/api/admin/extra-services/:id', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos.',
              details: [{ path: 'name', message: 'Já existe um serviço com este nome' }],
            },
          },
          { status: 422 },
        ),
      ),
    );

    await userEvent.click(
      within(rowOf('Videomaker')).getByRole('button', { name: 'Editar Videomaker' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar serviço' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar serviço' }));

    expect(
      await within(dialog).findByText('Já existe um serviço com este nome'),
    ).toBeInTheDocument();
  });
});

describe('Pedidos funnel (GES-95, GES-96)', () => {
  async function openFunnel() {
    const calls = renderPage('/admin/servicos-extras?tab=pedidos');
    await screen.findByText('Ana Souza');
    return calls;
  }

  it('renders the 5 columns with counts and each request in its status column', async () => {
    await openFunnel();

    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Novo (2)',
      'Em contato (1)',
      'Orçamento enviado (1)',
      'Fechado (1)',
      'Perdido (0)',
    ]);
    expect(within(column('Novo (2)')).getByText('Ana Souza')).toBeInTheDocument();
    expect(within(column('Novo (2)')).getByText('Bruno Lima')).toBeInTheDocument();
    expect(within(column('Em contato (1)')).getByText('Carla Dias')).toBeInTheDocument();
    expect(within(column('Orçamento enviado (1)')).getByText('Davi Rocha')).toBeInTheDocument();
    expect(within(column('Fechado (1)')).getByText('Elisa Prado')).toBeInTheDocument();
    expect(within(column('Perdido (0)')).getByText('Nenhum pedido')).toBeInTheDocument();
  });

  it('"Mover para" offers only the valid next statuses and nothing for a closed request', async () => {
    await openFunnel();

    await userEvent.click(screen.getByRole('button', { name: 'Mover pedido de Ana Souza para' }));
    const menu = await screen.findByRole('dialog', { name: 'Mover pedido de Ana Souza para' });
    expect(
      within(menu)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Em contato', 'Perdido']);

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Mover pedido de Davi Rocha para' }));
    const sent = await screen.findByRole('dialog', { name: 'Mover pedido de Davi Rocha para' });
    expect(
      within(sent)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Fechado', 'Perdido']);

    expect(
      screen.queryByRole('button', { name: 'Mover pedido de Elisa Prado para' }),
    ).not.toBeInTheDocument();
  });

  it('moves a request: PATCHes the status and the card changes column', async () => {
    const calls = await openFunnel();

    await userEvent.click(screen.getByRole('button', { name: 'Mover pedido de Ana Souza para' }));
    const menu = await screen.findByRole('dialog', { name: 'Mover pedido de Ana Souza para' });
    await userEvent.click(within(menu).getByRole('button', { name: 'Em contato' }));

    await waitFor(() => {
      expect(calls.quotePatches).toEqual([
        { id: QUOTE_IDS.novoAna, body: { status: 'contacted' } },
      ]);
    });
    expect(await within(column('Em contato (2)')).findByText('Ana Souza')).toBeInTheDocument();
    expect(column('Novo (1)')).toBeInTheDocument();
  });

  it('shows "O pedido mudou de status. Atualize a página." on a 409 and reloads the board', async () => {
    await openFunnel();
    server.use(
      http.patch('*/api/admin/quote-requests/:id', () =>
        apiError(409, 'INVALID_TRANSITION', 'Transição de status inválida.'),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Mover pedido de Ana Souza para' }));
    const menu = await screen.findByRole('dialog', { name: 'Mover pedido de Ana Souza para' });
    await userEvent.click(within(menu).getByRole('button', { name: 'Perdido' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O pedido mudou de status. Atualize a página.',
    );
  });

  it('opens the detail drawer with contact, service, linked booking and notes, and saves new notes', async () => {
    const calls = await openFunnel();

    await userEvent.click(screen.getByRole('button', { name: 'Ana Souza' }));
    const drawer = await screen.findByRole('dialog', { name: 'Pedido de Ana Souza' });

    expect(within(drawer).getByText('Pacote de filmagem')).toBeInTheDocument();
    expect(within(drawer).getByText('47999990000')).toBeInTheDocument();
    expect(within(drawer).getByText('ana@example.com')).toBeInTheDocument();
    expect(within(drawer).getByText('14/11/2026')).toBeInTheDocument();
    expect(within(drawer).getByText('BRV-7K2Q9X')).toBeInTheDocument();
    expect(
      within(drawer).getByText('Filmagem de um curso de 3 horas no sábado.'),
    ).toBeInTheDocument();
    const notes = within(drawer).getByLabelText('Anotações da equipe');
    expect(notes).toHaveValue('Cliente pediu retorno pela manhã.');

    await userEvent.clear(notes);
    await userEvent.type(notes, 'Orçamento enviado por WhatsApp.');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Salvar anotações' }));

    await waitFor(() => {
      expect(calls.quotePatches).toEqual([
        { id: QUOTE_IDS.novoAna, body: { staffNotes: 'Orçamento enviado por WhatsApp.' } },
      ]);
    });
  });

  it('refuses notes over 2000 characters with the core message', async () => {
    const calls = await openFunnel();

    await userEvent.click(screen.getByRole('button', { name: 'Bruno Lima' }));
    const drawer = await screen.findByRole('dialog', { name: 'Pedido de Bruno Lima' });
    await userEvent.click(within(drawer).getByLabelText('Anotações da equipe'));
    await userEvent.paste('a'.repeat(2001));
    await userEvent.click(within(drawer).getByRole('button', { name: 'Salvar anotações' }));

    expect(await within(drawer).findByText('Use no máximo 2000 caracteres')).toBeInTheDocument();
    expect(calls.quotePatches).toEqual([]);
  });
});

describe('ExtrasAdminPage tabs', () => {
  it('opens on Serviços, switches to Pedidos and keeps the tab in the URL', async () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Serviços Extras' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Serviços', selected: true })).toBeInTheDocument();
    await screen.findByText('Pacote de filmagem');

    await userEvent.click(screen.getByRole('tab', { name: 'Pedidos' }));

    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/servicos-extras?tab=pedidos');
  });
});
