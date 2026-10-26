import { closedDayPreviewSchema } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { closedDayCreated, closedDayPreview, ID } from '../../test/fixtures/nucleo';
import { parseFixture } from '../../test/fixtures/parse';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { plain } from '../../test/session';
import { ClosedDayModal } from './ClosedDayModal';

const withCompensation = parseFixture(
  closedDayPreviewSchema,
  {
    affectedBookings: [],
    compensation: {
      subscribers: 3,
      minutes: 120,
      creditCents: 20533,
      fixedOccurrencesCancelled: 0,
    },
  },
  'closedDayCompensationPreview',
);

function renderModal() {
  return renderWithProviders(<ClosedDayModal open onClose={vi.fn()} defaultDate="2026-12-24" />);
}

describe('ClosedDayModal (NUC-52)', () => {
  it('shows the compensation preview and posts the closed day on confirm', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get('*/api/admin/calendar/closed-days/preview', () =>
        HttpResponse.json(withCompensation),
      ),
      http.post('*/api/admin/calendar/closed-days', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(closedDayCreated, { status: 201 });
      }),
    );
    renderModal();

    const dialog = await screen.findByRole('dialog', { name: 'Fechar data' });
    expect(
      await within(dialog).findByText(
        (_, node) => plain(node?.textContent) === '3 assinantes · 120 min · R$ 205,33',
        { selector: 'p' },
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Nenhuma reserva será afetada.')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Motivo (opcional)'), 'Recesso');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fechar data' }));

    await waitFor(() =>
      expect(bodies).toEqual([{ date: '2026-12-24', roomIds: null, reason: 'Recesso' }]),
    );
  });

  it('lists the affected bookings with a link and keeps the confirm button disabled', async () => {
    renderModal();

    const dialog = await screen.findByRole('dialog', { name: 'Fechar data' });
    const list = await within(dialog).findByRole('list', { name: 'Reservas afetadas' });
    expect(within(list).getByRole('link', { name: 'BRV-7K2Q9X' })).toHaveAttribute(
      'href',
      '/admin/reservas/lista?q=BRV-7K2Q9X',
    );
    expect(
      within(dialog).getByText(
        'Existem reservas afetadas. Realoque ou cancele antes de continuar.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Fechar data' })).toBeDisabled();
    expect(closedDayPreview.affectedBookings).toHaveLength(1);
  });

  it('closes only the chosen rooms when "Toda a clínica" is unchecked', async () => {
    const previews: (string | null)[] = [];
    const bodies: unknown[] = [];
    server.use(
      http.get('*/api/admin/calendar/closed-days/preview', ({ request }) => {
        previews.push(new URL(request.url).searchParams.get('roomIds'));
        return HttpResponse.json(withCompensation);
      }),
      http.post('*/api/admin/calendar/closed-days', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(closedDayCreated, { status: 201 });
      }),
    );
    renderModal();
    const dialog = await screen.findByRole('dialog', { name: 'Fechar data' });

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Toda a clínica' }));
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Sala Principal' }));
    await waitFor(() => expect(previews.at(-1)).toBe(ID.principal));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Fechar data' }));

    await waitFor(() => expect(bodies).toEqual([{ date: '2026-12-24', roomIds: [ID.principal] }]));
  });
});
