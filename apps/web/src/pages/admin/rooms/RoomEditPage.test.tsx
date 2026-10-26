import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { buildRooms, ROOM_IDS } from '../../../features/admin-rooms/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { RoomEditPage } from './RoomEditPage';
import { RoomsPage } from './RoomsPage';

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

interface Calls {
  posts: Record<string, unknown>[];
  patches: { id: string; body: Record<string, unknown> }[];
}

function stubApi(): Calls {
  const calls: Calls = { posts: [], patches: [] };
  server.use(
    http.get('*/api/admin/rooms', () => HttpResponse.json(buildRooms())),
    http.post('*/api/admin/rooms', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.posts.push(body);
      return HttpResponse.json(
        { ...body, id: 'a1000000-0000-4000-8000-0000000000ff', photos: [] },
        { status: 201 },
      );
    }),
    http.patch('*/api/admin/rooms/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.patches.push({ id: String(params['id']), body });
      return HttpResponse.json({ ...body, id: params['id'], photos: [] });
    }),
  );
  return calls;
}

function renderEditor(id: string) {
  const calls = stubApi();
  renderWithProviders(
    <>
      <Routes>
        <Route path="/admin/salas" element={<RoomsPage />} />
        <Route path="/admin/salas/:id" element={<RoomEditPage />} />
      </Routes>
      <Probe />
    </>,
    `/admin/salas/${id}`,
  );
  return calls;
}

describe('RoomEditPage edit (GES-103)', () => {
  it('fills the form from the room and shows its photos', async () => {
    renderEditor(ROOM_IDS.aurora);

    expect(await screen.findByLabelText('Nome')).toHaveValue('Sala Aurora');
    expect(screen.getByLabelText('Endereço da sala')).toHaveValue('aurora');
    expect(screen.getByLabelText('Ideal para')).toHaveValue('Psicologia, Fisioterapia');
    expect(screen.getByLabelText('Equipamentos')).toHaveValue('Maca\nAr-condicionado');
    expect(screen.getByLabelText('Ordem de exibição')).toHaveValue(1);
    expect(screen.getByLabelText('Situação')).toHaveValue('active');
    expect(screen.getByRole('list', { name: 'Fotos da sala' })).toBeInTheDocument();
  });

  it('saves the whole body: tags and equipment as lists, order as a number', async () => {
    const calls = renderEditor(ROOM_IDS.aurora);
    const description = await screen.findByLabelText('Descrição');

    await userEvent.clear(description);
    await userEvent.type(description, 'Sala renovada.');
    await userEvent.clear(screen.getByLabelText('Ideal para'));
    await userEvent.type(screen.getByLabelText('Ideal para'), 'Nutrição, Coaching , ');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar sala' }));

    await waitFor(() => {
      expect(calls.patches).toEqual([
        {
          id: ROOM_IDS.aurora,
          body: {
            name: 'Sala Aurora',
            slug: 'aurora',
            description: 'Sala renovada.',
            idealFor: ['Nutrição', 'Coaching'],
            equipment: ['Maca', 'Ar-condicionado'],
            displayOrder: 1,
            status: 'active',
          },
        },
      ]);
    });
    expect(await screen.findByText('Sala salva.')).toBeInTheDocument();
  });

  it('shows the core slug message and sends nothing for an invalid address', async () => {
    const calls = renderEditor(ROOM_IDS.aurora);
    const slug = await screen.findByLabelText('Endereço da sala');

    await userEvent.clear(slug);
    await userEvent.type(slug, 'Sala Nova!');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar sala' }));

    expect(await screen.findByText('Use letras minúsculas, números e hífens')).toBeInTheDocument();
    expect(calls.patches).toEqual([]);
  });

  it('puts a server 422 on its field', async () => {
    renderEditor(ROOM_IDS.aurora);
    await screen.findByLabelText('Nome');
    server.use(
      http.patch('*/api/admin/rooms/:id', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos.',
              details: [{ path: 'slug', message: 'Já existe uma sala com este endereço' }],
            },
          },
          { status: 422 },
        ),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Salvar sala' }));

    expect(await screen.findByText('Já existe uma sala com este endereço')).toBeInTheDocument();
  });

  it('lists the booking codes and subscriptions in a modal when inactivating is refused (GES-104)', async () => {
    renderEditor(ROOM_IDS.aurora);
    await screen.findByLabelText('Nome');
    server.use(
      http.patch('*/api/admin/rooms/:id', () =>
        HttpResponse.json(
          {
            error: {
              code: 'ROOM_HAS_FUTURE_COMMITMENTS',
              message: 'A sala tem reservas futuras.',
              details: {
                bookings: [{ code: 'BRV-7K2Q9X' }, { code: 'BRV-3M8T1A' }],
                subscriptions: [{ id: 's1000000-0000-4000-8000-000000000001' }],
              },
            },
          },
          { status: 409 },
        ),
      ),
    );

    await userEvent.selectOptions(screen.getByLabelText('Situação'), 'Inativa');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar sala' }));

    const dialog = await screen.findByRole('dialog', { name: 'A sala tem compromissos' });
    const list = within(dialog).getByRole('list', { name: 'Compromissos da sala' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Reserva BRV-7K2Q9X',
      'Reserva BRV-3M8T1A',
      'Assinatura s1000000-0000-4000-8000-000000000001',
    ]);
  });

  it('shows "Sala não encontrada." for an unknown room', async () => {
    renderEditor('a1000000-0000-4000-8000-0000000000aa');

    expect(await screen.findByText('Sala não encontrada.')).toBeInTheDocument();
  });
});

describe('RoomEditPage create (GES-103)', () => {
  it('suggests the address from the name, creates the room and opens its editor', async () => {
    const calls = renderEditor('nova');
    const name = await screen.findByLabelText('Nome');
    expect(screen.getByText('Salve a sala para enviar as fotos.')).toBeInTheDocument();
    expect(screen.getByLabelText('Ordem de exibição')).toHaveValue(3);

    await userEvent.type(name, 'Sala Ágata');
    expect(screen.getByLabelText('Endereço da sala')).toHaveValue('sala-agata');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar sala' }));

    await waitFor(() => {
      expect(calls.posts).toEqual([
        {
          name: 'Sala Ágata',
          slug: 'sala-agata',
          description: '',
          idealFor: [],
          equipment: [],
          displayOrder: 3,
          status: 'active',
        },
      ]);
    });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/admin/salas/a1000000-0000-4000-8000-0000000000ff',
      );
    });
  });

  it('keeps an address typed by hand while the name changes', async () => {
    renderEditor('nova');
    const name = await screen.findByLabelText('Nome');

    await userEvent.type(screen.getByLabelText('Endereço da sala'), 'minha-sala');
    await userEvent.type(name, 'Outro nome');

    expect(screen.getByLabelText('Endereço da sala')).toHaveValue('minha-sala');
  });
});

describe('RoomsPage list', () => {
  it('lists the rooms with cover, address, status, photo count and a link to each editor', async () => {
    stubApi();
    renderWithProviders(<RoomsPage />, '/admin/salas');

    const aurora = (await screen.findByRole('link', { name: 'Sala Aurora' })).closest(
      'tr',
    ) as HTMLElement;
    expect(aurora).toHaveTextContent('/salas/aurora');
    expect(within(aurora).getByText('Ativa')).toBeInTheDocument();
    expect(within(aurora).getByRole('img', { name: 'Vista geral da sala' })).toHaveAttribute(
      'src',
      `/media/rooms/${ROOM_IDS.aurora}/up-1-small.webp`,
    );
    expect(
      within(aurora)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toContain('3');
    expect(screen.getByRole('link', { name: 'Sala Aurora' })).toHaveAttribute(
      'href',
      `/admin/salas/${ROOM_IDS.aurora}`,
    );
    const boreal = screen.getByRole('link', { name: 'Sala Boreal' }).closest('tr') as HTMLElement;
    expect(within(boreal).getByText('Inativa')).toBeInTheDocument();
    expect(within(boreal).getByText('Sem foto')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nova sala' })).toHaveAttribute(
      'href',
      '/admin/salas/nova',
    );
  });

  it('shows an error alert with retry when the rooms cannot be loaded', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/admin/rooms', () => {
        attempts += 1;
        // The first attempt and its automatic retry fail; the manual retry succeeds.
        return attempts <= 2
          ? apiError(500, 'INTERNAL', 'Falha ao carregar as salas.')
          : HttpResponse.json(buildRooms());
      }),
    );
    renderWithProviders(<RoomsPage />, '/admin/salas');

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar as salas.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('link', { name: 'Sala Aurora' })).toBeInTheDocument();
  });
});
