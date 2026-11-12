import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { availabilityDay } from '../../test/fixtures/nucleo';
import type { SlotSelection } from '../calendar/SlotGrid';
import { SlotChips } from './SlotChips';

type Props = Partial<React.ComponentProps<typeof SlotChips>>;

function Harness({ onChange, ...props }: Props) {
  const [value, setValue] = useState<SlotSelection>({ startMinute: null, endMinute: null });
  return (
    <MemoryRouter>
      <SlotChips
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
    </MemoryRouter>
  );
}

const cell = (time: string) => screen.getByRole('button', { name: new RegExp(`^${time}`) });
const period = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });
const starts = () =>
  within(screen.getByRole('list', { name: 'Horários de início' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('SlotChips durations (4 h at most)', () => {
  const durations = () =>
    within(screen.getByRole('group', { name: 'Duração' }))
      .getAllByRole('button')
      .map((b) => b.textContent);

  it('stops at 4h and offers the packages when asked to', async () => {
    render(<Harness offerMoreHours />);

    // 17:30 is free until 24:00 (6h30).
    await userEvent.click(period('Tarde'));
    await userEvent.click(cell('17:30'));

    expect(durations()).toEqual(['1h', '1h30', '2h', '2h30', '3h', '3h30', '4h']);
    expect(screen.getByRole('link', { name: 'Quero mais horas' })).toHaveAttribute(
      'href',
      '/precos#packages-title',
    );
  });

  it('shows no "Quero mais horas" unless asked to (the reschedule dialog)', async () => {
    render(<Harness />);

    await userEvent.click(cell('11:30'));

    expect(durations()).toEqual(['1h', '1h30', '2h']);
    expect(screen.queryByRole('link', { name: 'Quero mais horas' })).toBeNull();
  });
});

describe('SlotChips periods (07:00–24:00 window, CL-4 occupancy)', () => {
  it('opens on Manhã and shows the times of the period that is picked', async () => {
    render(<Harness />);

    expect(period('Manhã')).toHaveAttribute('aria-pressed', 'true');
    expect(starts().at(0)).toBe('07:00');
    expect(starts().at(-1)).toBe('11:30');

    await userEvent.click(period('Tarde'));
    expect(period('Tarde')).toHaveAttribute('aria-pressed', 'true');
    expect(starts().at(0)).toBe('12:00');
    expect(starts().at(-1)).toBe('17:30');
  });

  it('reports a start picked in another period and keeps taken times disabled', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await userEvent.click(period('Tarde'));
    // 14:00 is booked on the CL-4 day.
    expect(cell('14:00')).toBeDisabled();
    await userEvent.click(cell('17:30'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ startMinute: 1050, endMinute: null });
    expect(cell('17:30')).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens on the period of a start that is already chosen', () => {
    render(<Harness value={{ startMinute: 1140, endMinute: 1200 }} />);

    expect(period('Noite')).toHaveAttribute('aria-pressed', 'true');
    expect(cell('19:00')).toHaveAttribute('aria-pressed', 'true');
  });
});
