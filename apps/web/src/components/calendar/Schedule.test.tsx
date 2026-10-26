import type { LocalDate } from '@bravo/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { calendarEvents } from '../../test/fixtures/nucleo';
import { DayView } from './DayView';
import { MonthCalendarView } from './MonthCalendarView';
import { SLOT_ROW_PX, toneOfStatus, type ScheduleEvent } from './schedule';
import { WeekCalendar } from './WeekCalendar';

const TODAY = '2026-10-20' as LocalDate;
const TUESDAY = '2026-10-27' as LocalDate;

// The fixture booking: 17:30-20:00 on 2026-10-27 with cleanup until 20:30 (São Paulo time).
const booking = calendarEvents.bookings[0];
if (!booking) throw new Error('fixture booking missing');
const BOOKING: ScheduleEvent = {
  id: booking.id,
  kind: 'booking',
  startsAt: booking.startsAt,
  endsAt: booking.endsAt,
  cleanupUntil: booking.cleanupUntil,
  title: `${booking.firstName} · ${booking.roomName}`,
  tone: toneOfStatus(booking.status),
};
const BLOCK: ScheduleEvent = {
  id: 'block-1',
  kind: 'block',
  startsAt: '2026-10-27T18:00:00.000Z',
  endsAt: '2026-10-27T19:00:00.000Z',
  title: 'Limpeza profunda',
};

const column = (container: HTMLElement, date: string) =>
  container.querySelector<HTMLElement>(`[data-date="${date}"]`) as HTMLElement;
const slot = (container: HTMLElement, date: string, minute: number) =>
  column(container, date).querySelector<HTMLElement>(
    `[data-slot="${String(minute)}"]`,
  ) as HTMLElement;

function week(props: Partial<React.ComponentProps<typeof WeekCalendar>> = {}) {
  return render(
    <WeekCalendar
      date={TUESDAY}
      today={TODAY}
      events={[BOOKING]}
      onNavigate={vi.fn()}
      {...props}
    />,
  );
}

describe('WeekCalendar events', () => {
  it('spans an event of 17:30-20:00 over 5 half-hour rows at its start minute', () => {
    week();

    const event = screen.getByRole('button', { name: /Camila · Sala Principal, 17:30–20:00/ });
    expect(event).toHaveStyle({
      height: `${String(5 * SLOT_ROW_PX)}px`,
      top: `${String(((17 * 60 + 30 - 420) / 30) * SLOT_ROW_PX)}px`,
    });
  });

  it('adds a shaded cleanup band of 20:00-20:30 and omits it with showCleanup={false}', () => {
    const { unmount } = week();
    const band = screen.getByTitle('Limpeza 20:00–20:30');
    expect(band).toHaveAttribute('data-kind', 'cleanup');
    expect(band).toHaveStyle({
      top: `${String(((20 * 60 - 420) / 30) * SLOT_ROW_PX)}px`,
      height: `${String(SLOT_ROW_PX)}px`,
    });
    unmount();

    week({ showCleanup: false });
    expect(screen.queryByTitle(/^Limpeza/)).toBeNull();
  });

  it('shows the tag of a block', () => {
    week({ events: [BLOCK] });

    expect(screen.getByRole('button', { name: /Limpeza profunda/ })).toHaveTextContent(
      'Limpeza profunda',
    );
    expect(screen.getByRole('button', { name: /Limpeza profunda/ })).toHaveAttribute(
      'data-kind',
      'block',
    );
  });

  it('puts overlapping events of different rooms side by side', () => {
    const other: ScheduleEvent = { ...BOOKING, id: 'other', title: 'Rafael · Sala Terceira' };
    week({ events: [BOOKING, other] });

    const left = screen.getByRole('button', { name: /Camila/ });
    const right = screen.getByRole('button', { name: /Rafael/ });
    expect(left).toHaveStyle({ left: '0%', width: '50%' });
    expect(right).toHaveStyle({ left: '50%', width: '50%' });
  });

  it('marks holidays and closed days in the day header and the overlay bands', () => {
    week({
      holidays: [{ date: '2026-11-01', label: 'Feriado: Teste' }],
      closedDays: [{ date: '2026-10-28', label: 'Fechado: Recesso' }],
      markers: [{ date: TUESDAY, startMinute: 1140, endMinute: 1440, label: 'Faixa noite' }],
    });

    expect(screen.getByText('Feriado: Teste')).toBeInTheDocument();
    expect(screen.getByText('Fechado: Recesso')).toBeInTheDocument();
    expect(screen.getByTitle('Faixa noite')).toHaveTextContent('Faixa noite');
  });

  it('shows the hover card of an event when the renderer returns content', async () => {
    week({ renderEventCard: (event) => <p>Detalhes de {event.title}</p> });

    await userEvent.hover(screen.getByRole('button', { name: /Camila/ }));

    expect(screen.getByRole('dialog', { name: 'Camila · Sala Principal' })).toHaveTextContent(
      'Detalhes de Camila · Sala Principal',
    );
  });
});

describe('WeekCalendar range selection', () => {
  it('calls onRangeSelect with 600–720 when dragging from 10:00 to 11:30 over free cells', async () => {
    const onRangeSelect = vi.fn();
    const { container } = week({ events: [], onRangeSelect });

    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: slot(container, TUESDAY, 600) },
      { target: slot(container, TUESDAY, 690) },
      { keys: '[/MouseLeft]' },
    ]);

    expect(onRangeSelect).toHaveBeenCalledTimes(1);
    expect(onRangeSelect).toHaveBeenCalledWith({
      date: TUESDAY,
      startMinute: 600,
      endMinute: 720,
    });
  });

  it('ignores a drag that would cross an occupied cell', async () => {
    const onRangeSelect = vi.fn();
    const { container } = week({ onRangeSelect });

    // 17:30-20:30 is occupied (booking plus cleanup); 17:00 and 21:00 are free.
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: slot(container, TUESDAY, 1020) },
      { target: slot(container, TUESDAY, 1260) },
      { keys: '[/MouseLeft]' },
    ]);

    expect(onRangeSelect).toHaveBeenCalledWith({
      date: TUESDAY,
      startMinute: 1020,
      endMinute: 1050,
    });
  });

  it('does not start a selection on an occupied cell or a closed day', async () => {
    const onRangeSelect = vi.fn();
    const { container } = week({
      onRangeSelect,
      closedDays: [{ date: '2026-10-28', label: 'Fechado' }],
    });

    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: slot(container, TUESDAY, 1080) },
      { keys: '[/MouseLeft]' },
    ]);
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: slot(container, '2026-10-28', 600) },
      { keys: '[/MouseLeft]' },
    ]);

    expect(onRangeSelect).not.toHaveBeenCalled();
  });

  it('renders the free-slot content only in free cells', () => {
    const { container } = week({
      renderFreeSlot: ({ startMinute }) => <span data-testid="plus">{startMinute}</span>,
    });

    expect(within(slot(container, TUESDAY, 600)).getByTestId('plus')).toHaveTextContent('600');
    expect(within(slot(container, TUESDAY, 1080)).queryByTestId('plus')).toBeNull();
  });
});

describe('navigation', () => {
  it('week: previous, next and today emit the new Monday-to-Sunday range', async () => {
    const onNavigate = vi.fn();
    week({ onNavigate });

    await userEvent.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      date: '2026-11-03',
      from: '2026-11-02',
      to: '2026-11-08',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      date: '2026-10-20',
      from: '2026-10-19',
      to: '2026-10-25',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      date: '2026-10-20',
      from: '2026-10-19',
      to: '2026-10-25',
    });
  });

  it('day: shows one column and moves one day at a time', async () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <DayView date={TUESDAY} today={TODAY} events={[BOOKING]} onNavigate={onNavigate} />,
    );

    expect(container.querySelectorAll('[data-date]')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Próximo dia' }));
    expect(onNavigate).toHaveBeenCalledWith({
      date: '2026-10-28',
      from: '2026-10-28',
      to: '2026-10-28',
    });
  });
});

describe('MonthCalendarView', () => {
  const many: ScheduleEvent[] = Array.from({ length: 5 }, (_, i) => ({
    ...BOOKING,
    id: `b${String(i)}`,
    title: `Cliente ${String(i)} · Sala Principal`,
  }));

  it('shows a chip per event (first name and room) with the overflow count', () => {
    const { container } = render(
      <MonthCalendarView
        date={TUESDAY}
        today={TODAY}
        events={[BOOKING, ...many]}
        onNavigate={vi.fn()}
      />,
    );
    const cell = column(container, TUESDAY);

    expect(within(cell).getByText('17:30 Camila · Sala Principal')).toBeInTheDocument();
    expect(within(cell).getAllByRole('listitem')).toHaveLength(3);
    expect(within(cell).getByText('+3 mais')).toBeInTheDocument();
  });

  it('emits the visible grid range (at most 42 days) on navigation', async () => {
    const onNavigate = vi.fn();
    render(<MonthCalendarView date={TUESDAY} today={TODAY} events={[]} onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));

    expect(onNavigate).toHaveBeenCalledWith({
      date: '2026-11-01',
      from: '2026-10-26',
      to: '2026-12-06',
    });
  });

  it('marks holidays and closed days and reports a clicked date', async () => {
    const onSelectDate = vi.fn();
    render(
      <MonthCalendarView
        date="2026-11-02"
        today={TODAY}
        events={[]}
        holidays={[{ date: '2026-11-02', label: 'Feriado: Finados' }]}
        closedDays={[{ date: '2026-11-03', label: 'Fechado: Recesso' }]}
        onNavigate={vi.fn()}
        onSelectDate={onSelectDate}
      />,
    );

    expect(screen.getByText('Feriado: Finados')).toBeInTheDocument();
    expect(screen.getByText('Fechado: Recesso')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2 de novembro' }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-11-02');
  });
});
