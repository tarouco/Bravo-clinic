import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { availabilityDay } from '../../test/fixtures/nucleo';
import { SlotGrid, type SlotSelection } from './SlotGrid';

type Props = Partial<React.ComponentProps<typeof SlotGrid>>;

function Harness({ onChange, ...props }: Props) {
  const [value, setValue] = useState<SlotSelection>({ startMinute: null, endMinute: null });
  return (
    <SlotGrid
      cells={availabilityDay.cells}
      slotMinutes={availabilityDay.slotMinutes}
      minBookingMinutes={availabilityDay.minBookingMinutes}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      {...props}
    />
  );
}

const cell = (time: string) => screen.getByRole('button', { name: new RegExp(`^${time}`) });
const period = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });
const starts = () =>
  within(screen.getByRole('list', { name: 'Horários de início' }))
    .getAllByRole('button')
    .map((b) => b.textContent);
const durations = () =>
  within(screen.getByRole('group', { name: 'Duração' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('SlotGrid (CL-4: bookings 09:00–11:00 and 14:00–16:00)', () => {
  it('offers only durations from the minimum up to maxEndMinute after picking 11:30', async () => {
    render(<Harness />);

    await userEvent.click(cell('11:30'));

    expect(durations()).toEqual(['1h', '1h30', '2h']);
  });

  it('reports the chosen start and end when a duration is picked', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(cell('11:30'));
    await userEvent.click(screen.getByRole('button', { name: '1h30' }));

    expect(onChange).toHaveBeenNthCalledWith(1, { startMinute: 690, endMinute: null });
    expect(onChange).toHaveBeenNthCalledWith(2, { startMinute: 690, endMinute: 780 });
    expect(screen.getByRole('button', { name: '1h30' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks unavailable cells aria-disabled and ignores clicks on them', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // 09:00 is booked; 11:00 is the cleanup after the booking; 13:00 is a leftover under the minimum.
    for (const time of ['09:00', '11:00']) {
      expect(cell(time)).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(cell(time));
    }
    expect(cell('11:30')).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(period('Tarde'));
    expect(cell('13:00')).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(cell('13:00'));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Duração' })).toBeNull();
  });

  it('shows "−10%" on a cell with a slot discount', async () => {
    const cells = availabilityDay.cells.map((c) =>
      c.startMinute === 1020 ? { ...c, discountPercent: 10 } : c,
    );
    render(<Harness cells={cells} />);
    await userEvent.click(period('Tarde'));

    expect(cell('17:00')).toHaveTextContent('−10%');
    expect(cell('17:30')).not.toHaveTextContent('%');
  });

  it('lists block options and selects only the available ones', async () => {
    const onSelectBlock = vi.fn();
    const options = [
      {
        categoryId: 'a',
        name: 'Meio turno comercial',
        startMinute: 420,
        endMinute: 570,
        priceCents: 28000,
        available: true,
      },
      {
        categoryId: 'b',
        name: 'Turno completo comercial',
        startMinute: 420,
        endMinute: 720,
        priceCents: 50000,
        available: false,
      },
    ];
    render(<Harness blockOptions={options} onSelectBlock={onSelectBlock} />);
    const group = screen.getByRole('group', { name: 'Blocos fechados' });

    await userEvent.click(within(group).getByRole('button', { name: /Turno completo/ }));
    expect(onSelectBlock).not.toHaveBeenCalled();
    expect(within(group).getByRole('button', { name: /Turno completo/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await userEvent.click(within(group).getByRole('button', { name: /Meio turno/ }));
    expect(onSelectBlock).toHaveBeenCalledWith(options[0]);
    expect(group).toHaveTextContent('07:00–09:30');
  });

  it('says there are no times when the day has no cells', () => {
    render(<Harness cells={[]} />);

    expect(screen.getByText('Sem horários neste dia.')).toBeInTheDocument();
  });
});

describe('SlotGrid periods (07:00–24:00 window, CL-4 occupancy)', () => {
  it('opens on Manhã and lists only the times before 12:00', () => {
    render(<Harness />);

    expect(period('Manhã')).toHaveAttribute('aria-pressed', 'true');
    expect(period('Tarde')).toHaveAttribute('aria-pressed', 'false');
    expect(starts()).toEqual([
      '07:00',
      '07:30',
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
  });

  it('names each period with its count of free starts', () => {
    render(<Harness />);

    const names = within(screen.getByRole('group', { name: 'Período' }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Manhã, 3 livres', 'Tarde, 5 livres', 'Noite, 11 livres']);
    expect(period('Tarde')).toHaveTextContent('5 livres');
  });

  it('splits the day at 12:00 and at 18:00', async () => {
    render(<Harness />);

    await userEvent.click(period('Tarde'));
    expect(starts().at(0)).toBe('12:00');
    expect(starts().at(-1)).toBe('17:30');

    await userEvent.click(period('Noite'));
    expect(starts().at(0)).toBe('18:00');
    expect(starts().at(-1)).toBe('23:30');
  });

  it('opens on the first period with a free start and says "Sem horários" on a full one', () => {
    const cells = availabilityDay.cells.map((c) =>
      c.startMinute < 720 ? { ...c, available: false, maxEndMinute: null } : c,
    );
    render(<Harness cells={cells} />);

    expect(period('Manhã')).toHaveAccessibleName('Manhã, Sem horários');
    expect(period('Tarde')).toHaveAttribute('aria-pressed', 'true');
    expect(starts().at(0)).toBe('12:00');
  });

  it('says "1 livre" for a period with a single free start', () => {
    const cells = availabilityDay.cells.map((c) =>
      c.startMinute < 720 && c.startMinute !== 690
        ? { ...c, available: false, maxEndMinute: null }
        : c,
    );
    render(<Harness cells={cells} />);

    expect(period('Manhã')).toHaveAccessibleName('Manhã, 1 livre');
    expect(period('Manhã')).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens on the period of a start that is already chosen', () => {
    render(<Harness value={{ startMinute: 1050, endMinute: 1200 }} />);

    expect(period('Tarde')).toHaveAttribute('aria-pressed', 'true');
    expect(cell('17:30')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the chosen start and its durations while another period is open', async () => {
    render(<Harness />);

    await userEvent.click(cell('11:30'));
    await userEvent.click(period('Noite'));

    expect(screen.queryByRole('button', { name: /^11:30/ })).toBeNull();
    expect(durations()).toEqual(['1h', '1h30', '2h']);

    await userEvent.click(period('Manhã'));
    expect(cell('11:30')).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves the period picker out when every time is in one period', () => {
    const cells = availabilityDay.cells.filter((c) => c.startMinute < 720);
    render(<Harness cells={cells} />);

    expect(screen.queryByRole('group', { name: 'Período' })).toBeNull();
    expect(starts()).toHaveLength(10);
  });
});
