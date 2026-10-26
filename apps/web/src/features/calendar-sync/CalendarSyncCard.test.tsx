import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { CalendarSyncCard } from './CalendarSyncCard';
import type { CalendarFeedStatus } from './contracts';
import { FEED_URL, feedActive, feedIssued, feedNone, feedReissued, NEW_FEED_URL } from './fixtures';

/** Serves the feed status and counts the POSTs; every POST answers with the next URL. */
function stubFeed(status: CalendarFeedStatus, issued = [feedIssued, feedReissued]) {
  const state = { posts: 0 };
  server.use(
    http.get('*/api/app/calendar-feed', () => HttpResponse.json(status)),
    http.post('*/api/app/calendar-feed', () => {
      const body = issued[Math.min(state.posts, issued.length - 1)];
      state.posts += 1;
      return HttpResponse.json(body, { status: 201 });
    }),
  );
  return state;
}

describe('CalendarSyncCard generation (GES-45)', () => {
  it('generates the link, shows it once with a copy button and the Google and Outlook steps', async () => {
    const state = stubFeed(feedNone);
    const user = userEvent.setup();
    renderWithProviders(<CalendarSyncCard />);

    await user.click(await screen.findByRole('button', { name: 'Gerar link da agenda' }));

    expect(await screen.findByLabelText('Link da sua agenda')).toHaveValue(FEED_URL);
    expect(screen.getByText(/Este link aparece só agora/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Google Agenda' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Outlook' })).toBeInTheDocument();
    expect(state.posts).toBe(1);
  });

  it('shows only the prefix of an existing link, never the URL, after a reload', async () => {
    stubFeed(feedActive);
    renderWithProviders(<CalendarSyncCard />);

    expect(
      await screen.findByText(/começa com k3Fa9x, criado em 20\/10\/2026/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Link da sua agenda')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar novo link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar link da agenda' })).not.toBeInTheDocument();
  });

  it('forgets the URL once the page is left', async () => {
    stubFeed(feedNone);
    const user = userEvent.setup();
    const first = renderWithProviders(<CalendarSyncCard />);
    await user.click(await screen.findByRole('button', { name: 'Gerar link da agenda' }));
    await screen.findByLabelText('Link da sua agenda');
    first.unmount();

    stubFeed(feedActive);
    renderWithProviders(<CalendarSyncCard />);

    await screen.findByText(/começa com k3Fa9x/);
    expect(screen.queryByDisplayValue(FEED_URL)).not.toBeInTheDocument();
  });
});

describe('CalendarSyncCard regeneration (GES-45)', () => {
  it('asks for confirmation, then shows the new URL and keeps no old one', async () => {
    const state = stubFeed(feedActive, [feedReissued]);
    const user = userEvent.setup();
    renderWithProviders(<CalendarSyncCard />);

    await user.click(await screen.findByRole('button', { name: 'Gerar novo link' }));
    const dialog = screen.getByRole('dialog', { name: 'Gerar novo link' });
    expect(within(dialog).getByText(/O link atual deixa de funcionar/)).toBeInTheDocument();
    expect(state.posts).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Gerar novo link' }));

    expect(await screen.findByLabelText('Link da sua agenda')).toHaveValue(NEW_FEED_URL);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.posts).toBe(1);
  });

  it('keeps the current link when the confirmation is cancelled', async () => {
    const state = stubFeed(feedActive);
    const user = userEvent.setup();
    renderWithProviders(<CalendarSyncCard />);

    await user.click(await screen.findByRole('button', { name: 'Gerar novo link' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.posts).toBe(0);
  });
});

describe('CalendarSyncCard failures', () => {
  it('shows the API message when generating fails', async () => {
    server.use(
      http.get('*/api/app/calendar-feed', () => HttpResponse.json(feedNone)),
      http.post('*/api/app/calendar-feed', () =>
        apiError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas. Aguarde um instante.'),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<CalendarSyncCard />);

    await user.click(await screen.findByRole('button', { name: 'Gerar link da agenda' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Aguarde um instante.',
    );
    expect(screen.queryByLabelText('Link da sua agenda')).not.toBeInTheDocument();
  });

  it('says so when the link status cannot be loaded', async () => {
    server.use(
      http.get('*/api/app/calendar-feed', () => apiError(500, 'INTERNAL', 'Erro interno.')),
    );
    renderWithProviders(<CalendarSyncCard />);

    expect(
      await screen.findByText('Não foi possível carregar o link da agenda agora.'),
    ).toBeInTheDocument();
  });
});
