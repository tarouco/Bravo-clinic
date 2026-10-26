import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  businessHoursResponse,
  calendarConfig,
  calendarSettingsResult,
  closedDayPreview,
} from '../../../test/fixtures/nucleo';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { CalendarConfigPage } from './CalendarConfigPage';

const booking = closedDayPreview.affectedBookings[0];
if (!booking) throw new Error('fixture booking missing');

function renderPage() {
  return renderWithProviders(<CalendarConfigPage />, '/admin/calendario');
}

const field = (name: string) => screen.findByLabelText(name);

async function setTime(name: string, value: string) {
  const input = await field(name);
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.tab();
}

function conflict(code: string, message: string, details: unknown) {
  return HttpResponse.json(
    { error: { code, message, details, requestId: 'req-test-0001' } },
    { status: 409 },
  );
}

describe('CalendarConfigPage hours (NUC-40)', () => {
  it('saves the 8 rows after the Monday-to-Friday shortcut', async () => {
    const body = vi.fn<(rows: unknown) => void>();
    server.use(
      http.put('*/api/admin/calendar/business-hours', async ({ request }) => {
        body(((await request.json()) as { rows: unknown }).rows);
        return HttpResponse.json(businessHoursResponse);
      }),
    );
    renderPage();
    await setTime('Fechamento segunda', '22:00');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar a seg–sex' }));

    await userEvent.click(screen.getByRole('button', { name: 'Salvar horários' }));

    await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
    const rows = body.mock.calls[0]?.[0] as { dayType: string; closeMinute: number }[];
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => ['mon', 'tue', 'wed', 'thu', 'fri'].includes(r.dayType))).toEqual(
      ['mon', 'tue', 'wed', 'thu', 'fri'].map((dayType) => ({
        dayType,
        isClosed: false,
        openMinute: 420,
        closeMinute: 1320,
      })),
    );
    expect(await screen.findByText('Horário de funcionamento salvo.')).toBeInTheDocument();
  });

  it('lists the bookings of a 409 AFFECTED_BOOKINGS with a link to each in Gestão de Reservas', async () => {
    server.use(
      http.put('*/api/admin/calendar/business-hours', () =>
        conflict('AFFECTED_BOOKINGS', 'Existem reservas afetadas.', { bookings: [booking] }),
      ),
    );
    renderPage();
    await setTime('Fechamento segunda', '22:00');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar horários' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reservas afetadas' });
    const link = within(dialog).getByRole('link', { name: 'BRV-7K2Q9X' });
    expect(link).toHaveAttribute('href', '/admin/reservas/lista?q=BRV-7K2Q9X');
    expect(within(dialog).getByText(/Camila Souza · Sala Principal/)).toBeInTheDocument();
  });
});

describe('CalendarConfigPage parameters (NUC-41)', () => {
  it('shows the exact warning sentence after saving a cleanup of 45 min', async () => {
    server.use(
      http.put('*/api/admin/calendar/settings', () =>
        HttpResponse.json({
          settings: { ...calendarSettingsResult.settings, cleanupMinutes: 45 },
          warnings: [{ code: 'cleanup_not_slot_multiple', lostMinutesPerBooking: 15 }],
        }),
      ),
    );
    renderPage();
    const cleanup = await field('Limpeza entre reservas (min)');
    await userEvent.clear(cleanup);
    await userEvent.type(cleanup, '45');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar parâmetros' }));

    expect(
      await screen.findByText(
        'A limpeza de 45 min não é múltipla do slot de 30 min: 15 min vendáveis perdidos por reserva.',
      ),
    ).toBeInTheDocument();
  });

  it('opens the conflict modal listing both bookings of a 409 CLEANUP_CONFLICTS pair', async () => {
    const second = { ...booking, id: '22222222-2222-4222-8222-333333333333', code: 'BRV-9M4T2B' };
    server.use(
      http.put('*/api/admin/calendar/settings', () =>
        conflict('CLEANUP_CONFLICTS', 'A nova limpeza conflita com reservas futuras.', {
          pairs: [{ first: booking, second }],
        }),
      ),
    );
    renderPage();
    const cleanup = await field('Limpeza entre reservas (min)');
    await userEvent.clear(cleanup);
    await userEvent.type(cleanup, '60');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar parâmetros' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reservas em conflito' });
    expect(within(dialog).getByRole('link', { name: 'BRV-7K2Q9X' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'BRV-9M4T2B' })).toBeInTheDocument();
    expect(within(dialog).getByText('A nova limpeza conflita com reservas futuras.')).toBeVisible();
  });
});

describe('CalendarConfigPage category overlay (NUC-72)', () => {
  it('draws the checked category over each open day and hatches the hours no category covers', async () => {
    const { container } = renderPage();

    await userEvent.click(await screen.findByRole('checkbox', { name: '1 hora' }));

    const monday = container.querySelector<HTMLElement>('[data-day="mon"]');
    expect(monday?.querySelector('[data-kind="band"]')).not.toBeNull();
    const hatch = monday?.querySelector('[data-kind="uncovered"]');
    expect(hatch).toHaveAttribute('data-start', '1140');
    expect(hatch).toHaveAttribute('data-end', '1440');
    expect(container.querySelector('[data-day="sun"] [data-kind]')).toBeNull();
  });
});

describe('CalendarConfigPage first-access checklist (NUC-73)', () => {
  it('is hidden once the prices were reviewed', async () => {
    renderPage();
    await field('Abertura segunda');

    expect(screen.queryByText('Revise os valores das categorias')).toBeNull();
  });

  it('lists the three steps while prices are not reviewed and the button calls the endpoint', async () => {
    const reviewed = vi.fn();
    server.use(
      http.get('*/api/admin/calendar/config', () =>
        HttpResponse.json({ ...calendarConfig, onboarding: { pricesReviewed: false } }),
      ),
      http.post('*/api/admin/onboarding/prices-reviewed', () => {
        reviewed();
        return HttpResponse.json({ pricesReviewed: true });
      }),
    );
    renderPage();

    expect(await screen.findByText('Revise os valores das categorias')).toBeInTheDocument();
    expect(screen.getByText('Confirme a categoria de referência (V_ref)')).toBeInTheDocument();
    expect(screen.getByText('Revise as políticas de pagamento e cancelamento')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Marcar preços como revisados' }));

    await waitFor(() => expect(reviewed).toHaveBeenCalledTimes(1));
  });
});
