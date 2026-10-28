import { calendarEventsSchema, slotDiscountListSchema } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRevenueSlots } from '../../extensions/receita';
import { preloadLazySlots, resetSlots } from '../../extensions/slots';
import { ReservationsCalendar } from '../../pages/admin/reservations/ReservationsCalendar';
import { ReservationsPage } from '../../pages/admin/reservations/ReservationsPage';
import { calendarEvents, ID } from '../../test/fixtures/nucleo';
import { parseFixture } from '../../test/fixtures/parse';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { stubStaffSession } from '../../test/session';
import { RID } from '../purchases/fixtures';
import { closeSlotDiscountDialog } from './slot-discount-request';

// Slot bodies load lazily (GES-143): load them once up front, so a busy machine spends the
// module loading time here rather than inside a test's wait.
beforeAll(async () => {
  await preloadLazySlots();
}, 120_000);

// Only `Date` is faked, so timers, MSW and Testing Library keep running normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
  registerRevenueSlots();
});

afterEach(() => {
  closeSlotDiscountDialog();
  vi.useRealTimers();
  resetSlots();
});

// 15% on Sala Principal Tuesday 27/10/2026 from 10:00 to 11:00 (São Paulo), plus a consumed part.
const discounts = parseFixture(
  slotDiscountListSchema,
  {
    items: [
      {
        id: RID.slotDiscount,
        roomId: ID.principal,
        startsAt: '2026-10-27T13:00:00.000Z',
        endsAt: '2026-10-27T14:00:00.000Z',
        percent: 15,
        consumed: false,
      },
      {
        id: 'eeeeeeee-eeee-4eee-8eee-999999999999',
        roomId: ID.principal,
        startsAt: '2026-10-27T15:00:00.000Z',
        endsAt: '2026-10-27T16:00:00.000Z',
        percent: 30,
        consumed: true,
      },
    ],
  },
  'slotDiscountSlotsList',
);

function stubApis() {
  const discountUrls: URL[] = [];
  const deletes: string[] = [];
  server.use(
    http.get('*/api/admin/calendar/events', () =>
      HttpResponse.json(parseFixture(calendarEventsSchema, calendarEvents, 'slotSlotsEvents')),
    ),
    http.get('*/api/admin/slot-discounts', ({ request }) => {
      discountUrls.push(new URL(request.url));
      return HttpResponse.json(discounts);
    }),
    http.delete('*/api/admin/slot-discounts/:id', ({ params }) => {
      deletes.push(String(params['id']));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { discountUrls, deletes };
}

function renderCalendar() {
  stubStaffSession('admin');
  return renderWithProviders(
    <Routes>
      <Route path="/admin/reservas" element={<ReservationsPage />}>
        <Route index element={<ReservationsCalendar />} />
      </Route>
    </Routes>,
    '/admin/reservas',
  );
}

const cellButton = (container: HTMLElement, slot: number) =>
  container.querySelector<HTMLElement>(
    `[data-date="2026-10-27"] [data-slot="${String(slot)}"] button`,
  );

async function pickRoom(container: HTMLElement, slot: number) {
  await screen.findByRole('button', { name: /Camila · Sala Principal/ });
  await userEvent.selectOptions(screen.getByLabelText('Sala'), 'Sala Principal');
  return waitFor(() => {
    const found = cellButton(container, slot);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
}

describe('freeSlotActions: "Aplicar desconto (%)" (REC-133)', () => {
  it('opens the dialog pre-filled with the room, date and times of the hovered slot', async () => {
    stubApis();
    const { container } = renderCalendar();
    const trigger = await pickRoom(container, 780);

    await userEvent.hover(trigger);
    const menu = await screen.findByRole('menu', { name: 'Horário livre 13:00–13:30' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Aplicar desconto (%)' }));

    const dialog = await screen.findByRole('dialog', { name: 'Aplicar desconto (%)' });
    expect(within(dialog).getByLabelText('Data')).toHaveValue('2026-10-27');
    expect(within(dialog).getByLabelText('Início')).toHaveValue('13:00');
    expect(within(dialog).getByLabelText('Fim')).toHaveValue('13:30');
    expect(await within(dialog).findByRole('checkbox', { name: 'Sala Principal' })).toBeChecked();
  });

  it('opens it from a dragged range, closing the selection modal, with the whole range', async () => {
    stubApis();
    const { container } = renderCalendar();
    await pickRoom(container, 780);
    const slot = (minute: number) =>
      container.querySelector<HTMLElement>(
        `[data-date="2026-10-27"] [data-slot="${String(minute)}"]`,
      ) as HTMLElement;

    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: slot(780) },
      { target: slot(810) },
      { keys: '[/MouseLeft]' },
    ]);
    const selection = await screen.findByRole('dialog', {
      name: 'Horário selecionado 13:00–14:00',
    });
    await userEvent.click(
      within(selection).getByRole('menuitem', { name: 'Aplicar desconto (%)' }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Aplicar desconto (%)' });
    expect(within(dialog).getByLabelText('Início')).toHaveValue('13:00');
    expect(within(dialog).getByLabelText('Fim')).toHaveValue('14:00');
    expect(screen.queryByRole('dialog', { name: 'Horário selecionado 13:00–14:00' })).toBeNull();
  });

  it('sends the discount and refreshes the discounts of the calendar', async () => {
    const { discountUrls } = stubApis();
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/slot-discounts', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          { created: discounts.items.slice(0, 1), skipped: [] },
          { status: 201 },
        );
      }),
    );
    const { container } = renderCalendar();
    const trigger = await pickRoom(container, 780);
    await userEvent.hover(trigger);
    const menu = await screen.findByRole('menu', { name: 'Horário livre 13:00–13:30' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Aplicar desconto (%)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Aplicar desconto (%)' });
    const before = discountUrls.length;

    await userEvent.type(within(dialog).getByLabelText('Desconto (%)'), '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aplicar desconto' }));

    await waitFor(() => {
      expect(bodies).toEqual([
        {
          roomIds: [ID.principal],
          date: '2026-10-27',
          startMinute: 780,
          endMinute: 810,
          percent: 20,
        },
      ]);
    });
    await waitFor(() => {
      expect(discountUrls.length).toBeGreaterThan(before);
    });
  });
});

describe('overlays: "−{p}%" markers (REC-137)', () => {
  it('marks the discounted free slot of the shown week with the percent, ignoring consumed parts', async () => {
    const { discountUrls } = stubApis();
    const { container } = renderCalendar();
    await pickRoom(container, 780);

    const marker = await screen.findByTitle('−15%');
    expect(marker).toHaveTextContent('−15%');
    expect(screen.queryByTitle('−30%')).toBeNull();
    await waitFor(() => {
      const last = discountUrls.at(-1);
      expect(last?.searchParams.get('from')).toBe('2026-10-26');
      expect(last?.searchParams.get('to')).toBe('2026-11-01');
      expect(last?.searchParams.get('roomId')).toBe(ID.principal);
    });
  });

  it('names the room on the marker while every room is shown', async () => {
    stubApis();
    renderCalendar();

    expect(await screen.findByTitle('−15% · Sala Principal')).toBeInTheDocument();
  });

  it('offers "Remover desconto" on a discounted slot and DELETEs that discount', async () => {
    const { deletes } = stubApis();
    const { container } = renderCalendar();
    const trigger = await pickRoom(container, 600);

    await userEvent.hover(trigger);
    const menu = await screen.findByRole('menu', { name: 'Horário livre 10:00–10:30' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remover desconto' }));

    await waitFor(() => {
      expect(deletes).toEqual([RID.slotDiscount]);
    });
    expect(await screen.findByText('Desconto removido.')).toBeInTheDocument();
  });

  it('does not offer "Remover desconto" on a slot without discount', async () => {
    stubApis();
    const { container } = renderCalendar();
    const trigger = await pickRoom(container, 780);
    await screen.findByTitle('−15%');

    await userEvent.hover(trigger);
    const menu = await screen.findByRole('menu', { name: 'Horário livre 13:00–13:30' });

    expect(within(menu).queryByRole('menuitem', { name: 'Remover desconto' })).toBeNull();
    expect(
      within(menu).getByRole('menuitem', { name: 'Aplicar desconto (%)' }),
    ).toBeInTheDocument();
  });
});
