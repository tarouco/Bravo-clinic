import { calendarEventsSchema } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSlot, resetSlots } from '../../../extensions/slots';
import { calendarEvents, ID } from '../../../test/fixtures/nucleo';
import { parseFixture } from '../../../test/fixtures/parse';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain, stubStaffSession, type StaffRole } from '../../../test/session';
import { ReservationsCalendar } from './ReservationsCalendar';
import { ReservationsPage, ReservationsSlotTab } from './ReservationsPage';

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  resetSlots();
});

const fixtureBooking = calendarEvents.bookings[0];
if (!fixtureBooking) throw new Error('fixture booking missing');
const ana = { ...fixtureBooking, firstName: 'Ana', fullName: 'Ana Paula Lima' };

function useEvents(bookings: (typeof ana)[] = [ana]) {
  server.use(
    http.get('*/api/admin/calendar/events', () =>
      HttpResponse.json(
        parseFixture(calendarEventsSchema, { ...calendarEvents, bookings }, 'events'),
      ),
    ),
  );
}

function renderPage(role: StaffRole = 'admin', route = '/admin/reservas') {
  stubStaffSession(role);
  return renderWithProviders(
    <Routes>
      <Route path="/admin/reservas" element={<ReservationsPage />}>
        <Route index element={<ReservationsCalendar />} />
        <Route path="lista" element={<p>lista de reservas</p>} />
        <Route path=":tabId" element={<ReservationsSlotTab />} />
      </Route>
    </Routes>,
    route,
  );
}

const eventButton = () =>
  screen.findByRole('button', { name: /Ana · Sala Principal, 17:30–20:00/ });

async function openPopup() {
  await userEvent.hover(await eventButton());
  return screen.findByRole('dialog', { name: 'Ana · Sala Principal' });
}

describe('ReservationsCalendar events (NUC-158)', () => {
  it('shows first name and room on a booking, the tag on a block and the cleanup shading', async () => {
    useEvents();
    const { container } = renderPage();

    expect(await eventButton()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Limpeza, 15:00–16:00/ })).toBeInTheDocument();
    expect(container.querySelector('[data-kind="cleanup"]')).not.toBeNull();
    expect(screen.getByRole('list', { name: 'Legenda de status' })).toHaveTextContent(
      'Aguardando pgto ou pré-reserva',
    );
  });

  it('sends the room, status and category filters as query parameters', async () => {
    const urls: URL[] = [];
    server.use(
      http.get('*/api/admin/calendar/events', ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(calendarEvents);
      }),
    );
    renderPage();
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls[0]?.searchParams.get('from')).toBe('2026-10-26');
    expect(urls[0]?.searchParams.get('to')).toBe('2026-11-01');
    expect(urls[0]?.searchParams.has('roomId')).toBe(false);

    await userEvent.selectOptions(screen.getByLabelText('Sala'), 'Sala Principal');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Confirmada');
    await userEvent.selectOptions(screen.getByLabelText('Categoria'), '1 hora');

    await waitFor(() => {
      const last = urls.at(-1);
      expect(last?.searchParams.get('roomId')).toBe(ID.principal);
      expect(last?.searchParams.get('status')).toBe('confirmed');
      expect(last?.searchParams.get('categoryId')).toBe(ID.catHour);
    });
  });

  it('switches to the month view with the booking as a chip', async () => {
    useEvents();
    renderPage();
    await eventButton();

    await userEvent.click(screen.getByRole('button', { name: 'Mês' }));

    expect(await screen.findByRole('button', { name: 'Mês anterior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /17:30 Ana · Sala Principal/ })).toBeInTheDocument();
  });
});

describe('BookingPopup (NUC-159)', () => {
  it('shows the full name, paid of total, times, category and status badge', async () => {
    useEvents();
    renderPage();

    const popup = await openPopup();

    expect(within(popup).getByText('Ana Paula Lima')).toBeInTheDocument();
    expect(plain(popup.textContent)).toContain('R$ 109,50 de R$ 219,00');
    expect(popup).toHaveTextContent('27/10/2026 · 17:30–20:00');
    expect(popup).toHaveTextContent('2 horas ou mais · 2 horas ou mais — noite');
    expect(within(popup).getByText('Confirmada')).toBeInTheDocument();
  });

  it('offers an admin Confirmar on a pre-reservation, with Reenviar link, Reagendar and Cancelar', async () => {
    useEvents([{ ...ana, status: 'pre_reserved', statusLabel: 'Pré-reserva' }]);
    renderPage('admin');

    const popup = await openPopup();

    for (const name of ['Confirmar', 'Reenviar link', 'Reagendar', 'Cancelar']) {
      expect(within(popup).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(popup).queryByRole('button', { name: 'Check-in' })).toBeNull();
  });

  it('gives reception Check-in and Reenviar link but not Confirmar, Reagendar or Cancelar', async () => {
    useEvents();
    renderPage('reception');

    const popup = await openPopup();

    expect(within(popup).getByRole('button', { name: 'Check-in' })).toBeInTheDocument();
    expect(within(popup).getByRole('button', { name: 'Reenviar link' })).toBeInTheDocument();
    for (const name of ['Confirmar', 'Reagendar', 'Cancelar']) {
      expect(within(popup).queryByRole('button', { name })).toBeNull();
    }
  });

  it('registers the check-in of the booking', async () => {
    useEvents();
    const checkedIn = vi.fn<(id: string) => void>();
    server.use(
      http.post('*/api/admin/bookings/:id/check-in', ({ params }) => {
        checkedIn(String(params['id']));
        return HttpResponse.json({});
      }),
    );
    renderPage('reception');
    const popup = await openPopup();

    await userEvent.click(within(popup).getByRole('button', { name: 'Check-in' }));

    await waitFor(() => expect(checkedIn).toHaveBeenCalledWith(ana.id));
    expect(await screen.findByText('Check-in registrado.')).toBeInTheDocument();
  });

  it('asks an admin for a justification before confirming a pre-reservation', async () => {
    useEvents([{ ...ana, status: 'pre_reserved', statusLabel: 'Pré-reserva' }]);
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/bookings/:id/confirm-manual', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderPage('admin');
    const popup = await openPopup();
    await userEvent.click(within(popup).getByRole('button', { name: 'Confirmar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar reserva' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar sem pagamento' }));
    expect(
      await within(dialog).findByText(/justificativa/i, { selector: 'p' }),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'Pago em dinheiro');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar sem pagamento' }));

    await waitFor(() => expect(bodies).toEqual([{ justification: 'Pago em dinheiro' }]));
  });
});

describe('FreeSlotMenu (NUC-160)', () => {
  const freeButton = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-date="2026-10-27"] [data-slot="600"] button');

  it('lists the three actions and the slot-registered action, and Bloquear opens the prefilled modal', async () => {
    registerSlot('admin.calendar.freeSlotActions', () => (
      <button type="button" role="menuitem">
        Aplicar desconto (%)
      </button>
    ));
    useEvents();
    const { container } = renderPage();
    await eventButton();
    await userEvent.selectOptions(screen.getByLabelText('Sala'), 'Sala Principal');

    const trigger = await waitFor(() => {
      const found = freeButton(container);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await userEvent.hover(trigger);

    const menu = await screen.findByRole('menu', { name: 'Horário livre 10:00–10:30' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Criar pré-reserva', 'Criar reserva', 'Bloquear', 'Aplicar desconto (%)']);

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Bloquear' }));

    const dialog = await screen.findByRole('dialog', { name: 'Bloquear horário' });
    expect(within(dialog).getByLabelText('Data')).toHaveValue('2026-10-27');
    expect(within(dialog).getByLabelText('Início')).toHaveValue('10:00');
    expect(within(dialog).getByLabelText('Fim')).toHaveValue('10:30');
    expect(await within(dialog).findByRole('checkbox', { name: 'Sala Principal' })).toBeChecked();
  });

  it('draws the markers reported through the admin.calendar.overlays slot', async () => {
    function Discounts({
      reportMarkers,
    }: {
      reportMarkers: (key: string, markers: unknown[]) => void;
    }) {
      useEffect(() => {
        reportMarkers('discounts', [
          { date: '2026-10-27', startMinute: 600, endMinute: 660, label: '−15%' },
        ]);
      }, [reportMarkers]);
      return null;
    }
    registerSlot('admin.calendar.overlays', Discounts);
    useEvents();
    renderPage();

    expect(await screen.findByTitle('−15%')).toBeInTheDocument();
  });
});

describe('ReservationsPage sub-tabs', () => {
  it('shows Políticas to the admin only', async () => {
    useEvents();
    const admin = renderPage('admin');
    expect(await screen.findByRole('link', { name: 'Políticas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calendário' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lista' })).toBeInTheDocument();
    admin.unmount();

    renderPage('reception');
    expect(await screen.findByRole('link', { name: 'Lista' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Políticas' })).toBeNull();
  });

  it('adds the tabs and header actions registered in the slots', async () => {
    const Assinaturas = () => <p>painel de assinaturas</p>;
    Assinaturas.tabId = 'assinaturas';
    Assinaturas.tabLabel = 'Assinaturas';
    registerSlot('admin.reservations.tabs', Assinaturas);
    registerSlot('admin.reservations.headerActions', () => (
      <button type="button">Vender assinatura</button>
    ));
    useEvents();
    renderPage('admin', '/admin/reservas/assinaturas');

    expect(await screen.findByText('painel de assinaturas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assinaturas' })).toHaveAttribute(
      'href',
      '/admin/reservas/assinaturas',
    );
    expect(screen.getByRole('button', { name: 'Vender assinatura' })).toBeInTheDocument();
  });
});
