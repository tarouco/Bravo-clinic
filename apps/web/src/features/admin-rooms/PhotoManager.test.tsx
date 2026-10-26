import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import type { RoomPhoto } from './contracts';
import { buildRooms, PHOTO_IDS, ROOM_IDS } from './fixtures';
import { PhotoManager } from './PhotoManager';
import type { PreparedPhoto } from './prepare-photo';

const photos: RoomPhoto[] = buildRooms().items[0]?.photos ?? [];

const prepared: PreparedPhoto = {
  large: new Blob(['large-bytes'], { type: 'image/webp' }),
  small: new Blob(['small-bytes'], { type: 'image/webp' }),
  width: 1600,
  height: 1200,
};

interface Calls {
  puts: { variant: string; uploadId: string; type: string | null }[];
  posts: Record<string, unknown>[];
  patches: { id: string; body: unknown }[];
  orders: unknown[];
  deletes: string[];
}

function stubApi(options: { holdLargeUntil?: Promise<void> } = {}): Calls {
  const calls: Calls = { puts: [], posts: [], patches: [], orders: [], deletes: [] };
  const base = `*/api/admin/rooms/${ROOM_IDS.aurora}`;
  server.use(
    http.put(`${base}/photo-uploads/:uploadId/:variant`, async ({ request, params }) => {
      if (params['variant'] === 'large' && options.holdLargeUntil) await options.holdLargeUntil;
      calls.puts.push({
        variant: String(params['variant']),
        uploadId: String(params['uploadId']),
        type: request.headers.get('Content-Type'),
      });
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${base}/photos`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.posts.push(body);
      return HttpResponse.json(
        {
          id: 'f1000000-0000-4000-8000-0000000000ff',
          storageKey: `rooms/x/${String(body['uploadId'])}`,
          isCover: false,
          displayOrder: 3,
          ...body,
        },
        { status: 201 },
      );
    }),
    http.put(`${base}/photos/order`, async ({ request }) => {
      calls.orders.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch(`${base}/photos/:photoId`, async ({ request, params }) => {
      calls.patches.push({ id: String(params['photoId']), body: await request.json() });
      return HttpResponse.json(photos[0]);
    }),
    http.delete(`${base}/photos/:photoId`, ({ params }) => {
      calls.deletes.push(String(params['photoId']));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

function renderManager(
  props: { photos?: RoomPhoto[]; prepare?: () => Promise<PreparedPhoto> } = {},
) {
  renderWithProviders(
    <PhotoManager
      roomId={ROOM_IDS.aurora}
      photos={props.photos ?? photos}
      prepare={props.prepare ?? (() => Promise.resolve(prepared))}
    />,
  );
}

const jpeg = () => new File(['pixels'], 'sala.jpg', { type: 'image/jpeg' });
const item = (alt: string) => screen.getByRole('listitem', { name: alt });

async function pickFile(file: File = jpeg()) {
  await userEvent.upload(screen.getByLabelText('Adicionar foto'), file);
  return screen.findByLabelText('Descrição da foto');
}

describe('PhotoManager list', () => {
  it('shows each photo with its small variant URL, alt text and the cover mark', () => {
    renderManager();

    const cover = item('Vista geral da sala');
    expect(within(cover).getByRole('img', { name: 'Vista geral da sala' })).toHaveAttribute(
      'src',
      `/media/rooms/${ROOM_IDS.aurora}/up-1-small.webp`,
    );
    expect(within(cover).getByText('Capa')).toBeInTheDocument();
    expect(within(item('Maca e janela')).queryByText('Capa')).not.toBeInTheDocument();
  });

  it('tells the admin when the room has no photos', () => {
    renderManager({ photos: [] });

    expect(screen.getByText('Esta sala ainda não tem fotos.')).toBeInTheDocument();
  });
});

describe('PhotoManager upload (GES-105, GES-109)', () => {
  it('PUTs the large and the small variant, then registers the photo with the alt text and size', async () => {
    const calls = stubApi();
    const upload = vi.spyOn(api, 'upload');
    renderManager();

    const alt = await pickFile();
    await userEvent.type(alt, 'Banheiro acessível');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar foto' }));

    await waitFor(() => {
      expect(calls.posts).toHaveLength(1);
    });
    expect(calls.puts.map((p) => [p.variant, p.type])).toEqual([
      ['large', 'image/webp'],
      ['small', 'image/webp'],
    ]);
    // jsdom's Blob is not undici's, so the test server cannot read the bodies back: the spy
    // shows which blob went to which variant.
    expect(upload.mock.calls.map(([path, blob]) => [path.split('/').at(-1), blob])).toEqual([
      ['large', prepared.large],
      ['small', prepared.small],
    ]);
    upload.mockRestore();
    const uploadId = calls.puts[0]?.uploadId;
    expect(uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.puts[1]?.uploadId).toBe(uploadId);
    expect(calls.posts[0]).toEqual({
      uploadId,
      alt: 'Banheiro acessível',
      width: 1600,
      height: 1200,
    });
    expect(await screen.findByText('Foto enviada.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Descrição da foto')).not.toBeInTheDocument();
  });

  it('shows the progress of the upload while the variants are being sent', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubApi({ holdLargeUntil: held });
    renderManager();

    const alt = await pickFile();
    await userEvent.type(alt, 'Banheiro');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar foto' }));

    const progress = await screen.findByRole('progressbar');
    expect(progress).toHaveAttribute('value', '0');
    release();
    await waitFor(() => {
      expect(calls.posts).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  it('requires the alt text and sends nothing without it', async () => {
    const calls = stubApi();
    renderManager();

    await pickFile();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar foto' }));

    expect(await screen.findByText('Informe a descrição da foto')).toBeInTheDocument();
    expect(calls.puts).toEqual([]);
    expect(calls.posts).toEqual([]);
  });

  it('shows the message when the browser cannot prepare the photo', async () => {
    renderManager({
      prepare: () => Promise.reject(new Error('Use Chrome, Edge ou Firefox atualizados')),
    });

    await userEvent.upload(screen.getByLabelText('Adicionar foto'), jpeg());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use Chrome, Edge ou Firefox atualizados',
    );
  });

  it('shows the API message of a refused upload and keeps the prepared photo', async () => {
    stubApi();
    server.use(
      http.put('*/api/admin/rooms/:id/photo-uploads/:uploadId/:variant', () =>
        apiError(503, 'STORAGE_UNAVAILABLE', 'Armazenamento indisponível. Tente de novo.'),
      ),
    );
    renderManager();

    const alt = await pickFile();
    await userEvent.type(alt, 'Banheiro');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar foto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Armazenamento indisponível. Tente de novo.',
    );
    expect(screen.getByLabelText('Descrição da foto')).toHaveValue('Banheiro');
  });

  it('refuses a file over 25 MB before preparing it', async () => {
    let prepares = 0;
    renderManager({
      prepare: () => {
        prepares += 1;
        return Promise.resolve(prepared);
      },
    });
    const big = new File(['x'], 'grande.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });

    await userEvent.upload(screen.getByLabelText('Adicionar foto'), big);

    expect(await screen.findByText('Arquivo maior que 25 MB')).toBeInTheDocument();
    expect(prepares).toBe(0);
  });

  it('stops offering uploads at 12 photos (GES-106)', () => {
    const many: RoomPhoto[] = Array.from({ length: 12 }, (_, index) => ({
      ...(photos[0] as RoomPhoto),
      id: `f2000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
      alt: `Foto ${String(index + 1)}`,
      isCover: index === 0,
      displayOrder: index,
    }));
    renderManager({ photos: many });

    expect(
      screen.getByText('A sala já tem 12 fotos. Exclua uma para enviar outra.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Adicionar foto')).toBeDisabled();
  });
});

describe('PhotoManager actions (GES-107)', () => {
  it('sets another photo as the cover', async () => {
    const calls = stubApi();
    renderManager();

    await userEvent.click(
      within(item('Maca e janela')).getByRole('button', {
        name: 'Definir Maca e janela como capa',
      }),
    );

    await waitFor(() => {
      expect(calls.patches).toEqual([{ id: PHOTO_IDS.second, body: { isCover: true } }]);
    });
  });

  it('moves a photo down and up by sending the whole new order', async () => {
    const calls = stubApi();
    renderManager();

    await userEvent.click(
      within(item('Vista geral da sala')).getByRole('button', {
        name: 'Descer Vista geral da sala',
      }),
    );
    await userEvent.click(within(item('Recepção')).getByRole('button', { name: 'Subir Recepção' }));

    await waitFor(() => {
      expect(calls.orders).toEqual([
        { ids: [PHOTO_IDS.second, PHOTO_IDS.cover, PHOTO_IDS.third] },
        { ids: [PHOTO_IDS.cover, PHOTO_IDS.third, PHOTO_IDS.second] },
      ]);
    });
    expect(
      within(item('Vista geral da sala')).getByRole('button', {
        name: 'Subir Vista geral da sala',
      }),
    ).toBeDisabled();
    expect(
      within(item('Recepção')).getByRole('button', { name: 'Descer Recepção' }),
    ).toBeDisabled();
  });

  it('edits the alt text', async () => {
    const calls = stubApi();
    renderManager();

    await userEvent.click(
      within(item('Recepção')).getByRole('button', { name: 'Editar descrição de Recepção' }),
    );
    const field = within(item('Recepção')).getByLabelText('Descrição');
    await userEvent.clear(field);
    await userEvent.type(field, 'Recepção com sofá');
    await userEvent.click(
      within(item('Recepção')).getByRole('button', { name: 'Salvar descrição' }),
    );

    await waitFor(() => {
      expect(calls.patches).toEqual([{ id: PHOTO_IDS.third, body: { alt: 'Recepção com sofá' } }]);
    });
  });

  it('refuses an empty alt text when editing', async () => {
    const calls = stubApi();
    renderManager();

    await userEvent.click(
      within(item('Recepção')).getByRole('button', { name: 'Editar descrição de Recepção' }),
    );
    await userEvent.clear(within(item('Recepção')).getByLabelText('Descrição'));
    await userEvent.click(
      within(item('Recepção')).getByRole('button', { name: 'Salvar descrição' }),
    );

    expect(await screen.findByText('Informe a descrição da foto')).toBeInTheDocument();
    expect(calls.patches).toEqual([]);
  });

  it('deletes a photo only after confirmation', async () => {
    const calls = stubApi();
    renderManager();

    await userEvent.click(
      within(item('Recepção')).getByRole('button', { name: 'Excluir foto Recepção' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Excluir foto' });
    expect(calls.deletes).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir foto' }));

    await waitFor(() => {
      expect(calls.deletes).toEqual([PHOTO_IDS.third]);
    });
  });
});
