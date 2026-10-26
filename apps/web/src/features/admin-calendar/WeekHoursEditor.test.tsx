import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarConfig } from '../../test/fixtures/nucleo';
import { WeekHoursEditor, type HoursRow } from './WeekHoursEditor';

const FIXTURE_ROWS: HoursRow[] = calendarConfig.businessHours;

function Harness({
  initial = FIXTURE_ROWS,
  onRows,
}: {
  initial?: HoursRow[];
  onRows?: (rows: HoursRow[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <WeekHoursEditor
      rows={rows}
      slotMinutes={30}
      onChange={(next) => {
        setRows(next);
        onRows?.(next);
      }}
    />
  );
}

const row = (rows: HoursRow[], dayType: HoursRow['dayType']) =>
  rows.find((r) => r.dayType === dayType);

const withMondayClose = (closeMinute: number): HoursRow[] =>
  FIXTURE_ROWS.map((r) => (r.dayType === 'mon' ? { ...r, closeMinute } : r));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WeekHoursEditor (NUC-40)', () => {
  it('shows Monday to Sunday plus holidays with their hours and closed flags', () => {
    render(<Harness />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
    expect(screen.getByLabelText('Abertura segunda')).toHaveValue('07:00');
    expect(screen.getByLabelText('Fechamento segunda')).toHaveValue('24:00');
    expect(screen.getByLabelText('Abertura sábado')).toHaveValue('09:00');
    expect(screen.getByRole('checkbox', { name: /domingo: Fechado/ })).toBeChecked();
    expect(screen.getByLabelText('Abertura feriados')).toHaveValue('09:00');
  });

  it('"Aplicar a seg–sex" copies Monday to Tuesday through Friday and leaves the weekend alone', async () => {
    const onRows = vi.fn<(rows: HoursRow[]) => void>();
    render(<Harness initial={withMondayClose(1320)} onRows={onRows} />);

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar a seg–sex' }));

    const rows = onRows.mock.calls.at(-1)?.[0] ?? [];
    for (const day of ['tue', 'wed', 'thu', 'fri'] as const) {
      expect(row(rows, day)).toEqual({
        dayType: day,
        isClosed: false,
        openMinute: 420,
        closeMinute: 1320,
      });
    }
    expect(row(rows, 'sat')).toEqual({
      dayType: 'sat',
      isClosed: false,
      openMinute: 540,
      closeMinute: 1440,
    });
  });

  it('"Aplicar a sáb, dom e feriados" copies Saturday to Sunday and holidays', async () => {
    const onRows = vi.fn<(rows: HoursRow[]) => void>();
    render(<Harness onRows={onRows} />);

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar a sáb, dom e feriados' }));

    const rows = onRows.mock.calls.at(-1)?.[0] ?? [];
    const saturday = { isClosed: false, openMinute: 540, closeMinute: 1440 };
    expect(row(rows, 'sun')).toEqual({ dayType: 'sun', ...saturday });
    expect(row(rows, 'holiday')).toEqual({ dayType: 'holiday', ...saturday });
  });

  it('commits a typed time on blur and rejects one that is not a slot multiple', async () => {
    const onRows = vi.fn<(rows: HoursRow[]) => void>();
    render(<Harness onRows={onRows} />);
    const opening = screen.getByLabelText('Abertura segunda');

    await userEvent.clear(opening);
    await userEvent.type(opening, '08:30');
    await userEvent.tab();
    expect(row(onRows.mock.calls.at(-1)?.[0] ?? [], 'mon')?.openMinute).toBe(510);

    await userEvent.clear(opening);
    await userEvent.type(opening, '07:10');
    await userEvent.tab();
    expect(screen.getByText('Use múltiplos de 30 min.')).toBeInTheDocument();
    expect(onRows).toHaveBeenCalledTimes(1);
  });
});

describe('WeekHoursEditor drag handles (NUC-42)', () => {
  it('moves the closing handle by one slot with ArrowDown and the opening handle with ArrowUp', async () => {
    render(<Harness initial={withMondayClose(1320)} />);

    const closing = screen.getByRole('slider', { name: 'Ajustar fechamento (segunda)' });
    closing.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('Fechamento segunda')).toHaveValue('22:30');
    expect(closing).toHaveAttribute('aria-valuenow', '1350');

    const opening = screen.getByRole('slider', { name: 'Ajustar abertura (segunda)' });
    opening.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByLabelText('Abertura segunda')).toHaveValue('06:30');
  });

  it('snaps a dragged handle to the slot size', () => {
    render(<Harness initial={withMondayClose(1320)} />);
    const handle = screen.getByRole('slider', { name: 'Ajustar fechamento (segunda)' });
    const column = handle.parentElement as HTMLElement;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 576,
      left: 0,
      width: 100,
      right: 100,
      bottom: 576,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent(handle, new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    // 544 px of 576 px is 22:40, which snaps to the 22:30 slot boundary.
    act(() => {
      document.dispatchEvent(new MouseEvent('pointermove', { clientY: 544, bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });

    expect(screen.getByLabelText('Fechamento segunda')).toHaveValue('22:30');
  });
});
