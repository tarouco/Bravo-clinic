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
    for (const time of ['09:00', '11:00', '13:00']) {
      expect(cell(time)).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(cell(time));
    }

    expect(onChange).not.toHaveBeenCalled();
    expect(cell('11:30')).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByRole('group', { name: 'Duração' })).toBeNull();
  });

  it('shows "−10%" on a cell with a slot discount', () => {
    const cells = availabilityDay.cells.map((c) =>
      c.startMinute === 1020 ? { ...c, discountPercent: 10 } : c,
    );
    render(<Harness cells={cells} />);

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
