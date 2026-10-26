import type { HourlyCategory } from '@bravo/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { plain } from '../../test/session';
import { CategoryBandOverlay } from './CategoryBandOverlay';

// The seeded hourly categories (design.md "Seeds"); ids are plain strings here.
const seed = (
  id: string,
  name: string,
  startMinute: number,
  endMinute: number,
  minDurationMinutes: number,
  weekdayRateCents: number,
  status: HourlyCategory['status'] = 'active',
): HourlyCategory => ({
  id,
  name,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  appliesOnHolidays: true,
  startMinute,
  endMinute,
  weekdayRateCents,
  weekendRateCents: weekdayRateCents,
  minDurationMinutes,
  status,
  isReference: id === 'h1',
  displayOrder: 1,
});

const HOUR = seed('h1', '1 hora', 0, 1140, 60, 9700);
const TWO_HOURS = seed('h2', '2 horas ou mais', 0, 1140, 120, 8000);
const NIGHT = seed('h3', '1 hora — noite', 1140, 1440, 60, 12000);
const TWO_NIGHT = seed('h4', '2 horas ou mais — noite', 1140, 1440, 120, 9900);
const WINDOW = { openMinute: 420, closeMinute: 1440 };

function overlay(
  categories: HourlyCategory[],
  selected: string[],
  props: { durationMinutes?: number } = {},
) {
  return render(
    <div style={{ position: 'relative' }}>
      <CategoryBandOverlay
        categories={categories}
        selectedIds={new Set(selected)}
        weekday={2}
        isHoliday={false}
        window={WINDOW}
        durationMinutes={props.durationMinutes ?? 60}
        pxPerMinute={0.4}
      />
    </div>,
  );
}

describe('CategoryBandOverlay (NUC-72)', () => {
  it('hatches 19:00–00:00 as "Horário sem categoria" when "1 hora — noite" is inactive', () => {
    const { container } = overlay(
      [HOUR, TWO_HOURS, { ...NIGHT, status: 'inactive' }, TWO_NIGHT],
      ['h1'],
    );

    expect(screen.getByText('Horário sem categoria')).toBeInTheDocument();
    const hatch = container.querySelector<HTMLElement>('[data-kind="uncovered"]');
    expect(hatch).toHaveAttribute('data-start', '1140');
    expect(hatch).toHaveAttribute('data-end', '1440');
    expect(hatch).toHaveStyle({ top: `${String(1140 * 0.4)}px`, height: `${String(300 * 0.4)}px` });
  });

  it('draws a band labelled with the hourly rate for each selected category only', () => {
    const { container } = overlay([HOUR, TWO_HOURS, NIGHT, TWO_NIGHT], ['h1', 'h3']);

    const bands = [...container.querySelectorAll<HTMLElement>('[data-kind="band"]')];
    expect(bands.map((b) => plain(b.getAttribute('title')))).toEqual([
      '1 hora · R$ 97,00/h',
      '1 hora — noite · R$ 120,00/h',
    ]);
    expect(screen.queryByText('Horário sem categoria')).toBeNull();
  });

  it('draws nothing while no category is selected', () => {
    const { container } = overlay([HOUR, NIGHT], []);

    expect(container.querySelector('[data-kind]')).toBeNull();
  });
});
