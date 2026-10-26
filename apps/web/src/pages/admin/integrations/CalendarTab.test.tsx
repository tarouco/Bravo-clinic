import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  buildCalendar,
  ISSUED_FEED_URL,
  ROOM_IDS,
} from '../../../features/admin-integrations/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { CalendarTab } from './CalendarTab';

interface Calls {
  posts: Record<string, unknown>[];
  deletes: string[];
}

/** A stateful stand-in for the feeds routes: issuing replaces the feed, revoking removes it. */
function stubApi(options: { clinicFeed?: boolean } = {}): Calls {
  const calls: Calls = { posts: [], deletes: [] };
  const state = buildCalendar(options);
  server.use(
    http.get('*/api/admin/integrations/calendar', () => HttpResponse.json(state)),
    http.post('*/api/admin/integrations/calendar/feeds', async ({ request }) => {
      const body = (await request.json()) as { scope: 'clinic' | 'room'; roomId?: string };
      calls.posts.push(body);
      state.feeds = state.feeds.filter(
        (f) => !(f.scope === body.scope && (f.roomId ?? null) === (body.roomId ?? null)),
      );
      const room = state.rooms.find((r) => r.id === body.roomId);
      state.feeds.push({
        id: `fd0000ff-0000-4000-8000-00000000000${String(calls.posts.length)}`,
        scope: body.scope,
        roomId: body.roomId ?? null,
        roomName: room?.name ?? null,
        prefix: 'tok_9a',
        createdAt: '2026-10-26T13:00:00.000Z',
      });
      return HttpResponse.json({ url: ISSUED_FEED_URL, prefix: 'tok_9a' }, { status: 201 });
    }),
    http.delete('*/api/admin/integrations/calendar/feeds/:id', ({ params }) => {
      calls.deletes.push(String(params['id']));
      state.feeds = state.feeds.filter((f) => f.id !== params['id']);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

async function renderTab(options: { clinicFeed?: boolean } = {}) {
  const calls = stubApi(options);
  const view = renderWithProviders(<CalendarTab />);
  const clinic = await screen.findByRole('region', { name: 'Agenda da clínica' });
  return { calls, clinic, view };
}

const roomRow = (name: string) => screen.getByRole('listitem', { name });

describe('CalendarTab feeds (GES-42, GES-43)', () => {
  it('lists the clinic feed and every room with the prefix of the active link, never the URL', async () => {
    const { clinic } = await renderTab();

    expect(within(clinic).getByText('Link ativo: k3Hx9Q…')).toBeInTheDocument();
    expect(within(roomRow('Sala Aurora')).getByText('Link ativo: Zp41aB…')).toBeInTheDocument();
    expect(within(roomRow('Sala Boreal')).getByText('Sem link')).toBeInTheDocument();
    expect(screen.queryByLabelText('Link do calendário')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('/api/ics/');
  });

  it('issues a room link without asking, shows the URL once with the copy warning, and posts the room id', async () => {
    const { calls } = await renderTab();
    const row = roomRow('Sala Boreal');

    await userEvent.click(within(row).getByRole('button', { name: 'Gerar link' }));

    expect(await within(row).findByLabelText('Link do calendário')).toHaveValue(ISSUED_FEED_URL);
    expect(
      within(row).getByText('Copie agora: o link não será exibido de novo'),
    ).toBeInTheDocument();
    expect(calls.posts).toEqual([{ scope: 'room', roomId: ROOM_IDS.boreal }]);
    // The list refetches with the new prefix only.
    expect(await within(row).findByText('Link ativo: tok_9a…')).toBeInTheDocument();
  });

  it('forgets the URL once the tab is opened again', async () => {
    const { clinic, view } = await renderTab({ clinicFeed: false });
    await userEvent.click(within(clinic).getByRole('button', { name: 'Gerar link' }));
    expect(await within(clinic).findByLabelText('Link do calendário')).toHaveValue(ISSUED_FEED_URL);

    view.unmount();
    renderWithProviders(<CalendarTab />);

    expect(await screen.findByText('Link ativo: tok_9a…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Link do calendário')).not.toBeInTheDocument();
  });

  it('asks for confirmation before regenerating and only then posts', async () => {
    const { calls, clinic } = await renderTab();

    await userEvent.click(within(clinic).getByRole('button', { name: 'Gerar novo link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gerar novo link' });
    expect(dialog).toHaveTextContent('O link atual deixa de funcionar');
    expect(calls.posts).toEqual([]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Gerar novo link' }));

    await waitFor(() => {
      expect(calls.posts).toEqual([{ scope: 'clinic' }]);
    });
    expect(await within(clinic).findByLabelText('Link do calendário')).toHaveValue(ISSUED_FEED_URL);
  });

  it('keeps the current link when the regeneration is cancelled', async () => {
    const { calls, clinic } = await renderTab();

    await userEvent.click(within(clinic).getByRole('button', { name: 'Gerar novo link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gerar novo link' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(calls.posts).toEqual([]);
    expect(within(clinic).getByText('Link ativo: k3Hx9Q…')).toBeInTheDocument();
  });

  it('revokes a room link after confirmation and the list shows it without a link', async () => {
    const { calls } = await renderTab();
    const row = roomRow('Sala Aurora');

    await userEvent.click(within(row).getByRole('button', { name: 'Revogar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revogar link' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revogar link' }));

    await waitFor(() => {
      expect(calls.deletes).toEqual(['fd000000-0000-4000-8000-000000000002']);
    });
    expect(await within(roomRow('Sala Aurora')).findByText('Sem link')).toBeInTheDocument();
  });

  it('shows the API message when issuing fails', async () => {
    const { clinic } = await renderTab({ clinicFeed: false });
    server.use(
      http.post('*/api/admin/integrations/calendar/feeds', () =>
        apiError(409, 'CONFLICT', 'Outro administrador acabou de gerar este link.'),
      ),
    );

    await userEvent.click(within(clinic).getByRole('button', { name: 'Gerar link' }));

    expect(await within(clinic).findByRole('alert')).toHaveTextContent(
      'Outro administrador acabou de gerar este link.',
    );
  });

  it('explains how to add the link to Google Agenda ("Do URL") and Outlook', async () => {
    await renderTab();

    const help = screen.getByRole('region', { name: 'Como assinar no Google Agenda e no Outlook' });
    expect(help).toHaveTextContent('Do URL');
    expect(help).toHaveTextContent('Assinar da Web');
  });
});
