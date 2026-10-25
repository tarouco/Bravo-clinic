import type { AvailabilityMonth } from '@bravo/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildAvailabilityMonth } from '../../test/fixtures/nucleo';
import { MonthCalendar } from './MonthCalendar';

type MonthDays = AvailabilityMonth['days'];

function Harness({
  initialMonth = '2026-10',
  value = null,
  onSelect,
  onMonthChange,
}: {
  initialMonth?: string;
  value?: string | null;
  onSelect?: (date: string) => void;
  onMonthChange?: (month: string) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const data = buildAvailabilityMonth(month);
  return (
    <MonthCalendar
      month={month}
      days={data.days as MonthDays}
      value={value}
      onSelect={onSelect ?? vi.fn()}
      onMonthChange={(next) => {
        setMonth(next);
        onMonthChange?.(next);
      }}
    />
  );
}

const day = (name: RegExp) => screen.getByRole('button', { name });

describe('MonthCalendar', () => {
  it('disables past days and ignores clicks on them, while available days are selectable', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    const past = day(/^20 de outubro/);
    expect(past).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(past);
    expect(onSelect).not.toHaveBeenCalled();

    expect(day(/^27 de outubro/)).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(day(/^27 de outubro/));
    expect(onSelect).toHaveBeenCalledWith('2026-10-27');
  });

  it('disables out_of_range days', () => {
    const data = buildAvailabilityMonth('2026-10');
    const days = data.days.map((d) =>
      d.date === '2026-10-30' ? { ...d, status: 'out_of_range' as const } : d,
    ) as MonthDays;
    render(
      <MonthCalendar
        month="2026-10"
        days={days}
        value={null}
        onSelect={vi.fn()}
        onMonthChange={vi.fn()}
      />,
    );

    expect(day(/^30 de outubro/)).toHaveAttribute('aria-disabled', 'true');
    expect(day(/^30 de outubro/)).toHaveAccessibleName(/fora do período de reservas/);
  });

  it('marks 2026-11-02 with the title "Feriado: Finados"', () => {
    render(<Harness initialMonth="2026-11" />);

    const holiday = screen.getByTitle('Feriado: Finados');
    expect(holiday).toHaveTextContent('2');
    expect(holiday).toHaveAccessibleName(/2 de novembro, Feriado: Finados/);
  });

  it('marks the selected day with aria-pressed', () => {
    render(<Harness value="2026-10-28" />);

    expect(day(/^28 de outubro/)).toHaveAttribute('aria-pressed', 'true');
    expect(day(/^27 de outubro/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('moves focus by day with Left/Right and by week with Up/Down', async () => {
    render(<Harness value="2026-10-28" />);
    // Previous and next month arrows come first; the grid has a single tab stop.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(day(/^28 de outubro/)).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(day(/^29 de outubro/)).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(day(/^5 de novembro/)).toHaveFocus();
  });

  it('moves focus back by day and week', async () => {
    render(<Harness value="2026-10-28" />);
    day(/^28 de outubro/).focus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(day(/^27 de outubro/)).toHaveFocus();

    await userEvent.keyboard('{ArrowUp}');
    expect(day(/^20 de outubro/)).toHaveFocus();
  });

  it('changes month with the arrows and reports the new month', async () => {
    const onMonthChange = vi.fn();
    render(<Harness onMonthChange={onMonthChange} />);
    expect(screen.getByRole('heading', { name: 'outubro de 2026' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));

    expect(onMonthChange).toHaveBeenCalledWith('2026-11');
    expect(screen.getByRole('heading', { name: 'novembro de 2026' })).toBeInTheDocument();
  });
});
