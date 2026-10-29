import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Chip, ChipGroup } from './Chip';
import { Slider } from './Slider';
import { Toggle } from './Toggle';

const SLOTS = [
  { value: '9h', label: '9h' },
  { value: '11h', label: '11h' },
  { value: '14h', label: '14h' },
] as const;

type Slot = (typeof SLOTS)[number]['value'];

function SingleGroup() {
  const [value, setValue] = useState<Slot | null>('9h');
  return <ChipGroup label="Horários" options={SLOTS} value={value} onChange={setValue} />;
}

function MultiGroup() {
  const [value, setValue] = useState<Slot[]>([]);
  return <ChipGroup multiple label="Horários" options={SLOTS} value={value} onChange={setValue} />;
}

const pressed = () =>
  screen
    .getAllByRole('button')
    .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
    .map((chip) => chip.textContent);

describe('Chip and ChipGroup', () => {
  it('renders a pearl chip that reports its selection through aria-pressed', () => {
    render(
      <>
        <Chip>Estética</Chip>
        <Chip selected>Médico</Chip>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Estética' })).toHaveClass('bv-chip');
    expect(screen.getByRole('button', { name: 'Estética' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Médico' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps exactly one chip selected in a single-choice group', async () => {
    render(<SingleGroup />);
    expect(screen.getByRole('group', { name: 'Horários' })).toHaveClass('bv-chips');
    expect(pressed()).toEqual(['9h']);

    await userEvent.click(screen.getByRole('button', { name: '14h' }));
    expect(pressed()).toEqual(['14h']);

    await userEvent.click(screen.getByRole('button', { name: '14h' }));
    expect(pressed()).toEqual(['14h']);
  });

  it('does not report a click on the chip that is already selected', async () => {
    const onChange = vi.fn();
    render(<ChipGroup label="Horários" options={SLOTS} value="11h" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '11h' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '9h' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('9h');
  });

  it('toggles each chip on its own in a multiple group', async () => {
    render(<MultiGroup />);
    await userEvent.click(screen.getByRole('button', { name: '9h' }));
    await userEvent.click(screen.getByRole('button', { name: '14h' }));
    expect(pressed()).toEqual(['9h', '14h']);
    await userEvent.click(screen.getByRole('button', { name: '9h' }));
    expect(pressed()).toEqual(['14h']);
  });
});

function ControlledToggle({ onChange }: { onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Toggle
      label="Lembretes por e-mail"
      description="Um dia antes da reserva"
      checked={checked}
      onCheckedChange={(next) => {
        onChange?.(next);
        setChecked(next);
      }}
    />
  );
}

describe('Toggle', () => {
  it('is a switch named by the label next to it, with aria-checked following the value', async () => {
    const onChange = vi.fn();
    render(<ControlledToggle onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Lembretes por e-mail' });
    expect(toggle).toHaveClass('bv-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('Um dia antes da reserva');

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByText('Lembretes por e-mail'));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('flips with the keyboard and stays put while disabled', async () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Toggle label="Notificações" checked onCheckedChange={onCheckedChange} />,
    );
    screen.getByRole('switch').focus();
    await userEvent.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(false);

    rerender(<Toggle label="Notificações" checked disabled onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
  });
});

function ControlledSlider({ initial = 50 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <Slider
      label="Horas por semana"
      max={40}
      value={value}
      onValueChange={setValue}
      formatValue={(hours) => `${String(hours)} h`}
    />
  );
}

const slider = () => screen.getByRole('slider', { name: 'Horas por semana' });

/** jsdom has no PointerEvent; a MouseEvent with `pointerId` carries `clientX` and `button`. */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

describe('Slider', () => {
  beforeAll(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the slider role with its range, value and value text, and shows the value', () => {
    render(<ControlledSlider initial={10} />);
    expect(slider()).toHaveAttribute('aria-valuemin', '0');
    expect(slider()).toHaveAttribute('aria-valuemax', '40');
    expect(slider()).toHaveAttribute('aria-valuenow', '10');
    expect(slider()).toHaveAttribute('aria-valuetext', '10 h');
    expect(slider()).toHaveClass('bv-slider');
    expect(screen.getByText('10 h')).toBeInTheDocument();
    expect(slider().querySelector('.bv-slider-fill')).toHaveStyle({ width: '25%' });
    expect(slider().querySelector('.bv-slider-knob')).toHaveStyle({ left: '25%' });
  });

  it('moves one step with the arrows and jumps to the ends with Home and End', async () => {
    render(<ControlledSlider initial={10} />);
    slider().focus();
    await userEvent.keyboard('{ArrowRight}{ArrowUp}');
    expect(slider()).toHaveAttribute('aria-valuenow', '12');
    await userEvent.keyboard('{ArrowLeft}');
    expect(slider()).toHaveAttribute('aria-valuenow', '11');
    await userEvent.keyboard('{End}');
    expect(slider()).toHaveAttribute('aria-valuenow', '40');
    await userEvent.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '40');
    await userEvent.keyboard('{Home}');
    expect(slider()).toHaveAttribute('aria-valuenow', '0');
    await userEvent.keyboard('{ArrowDown}');
    expect(slider()).toHaveAttribute('aria-valuenow', '0');
  });

  it('jumps to the clicked point and follows a pointer drag', () => {
    render(<ControlledSlider initial={0} />);
    const track = slider();
    track.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;

    fireEvent.pointerDown(track, { button: 0, clientX: 200, pointerId: 1 });
    expect(track).toHaveAttribute('aria-valuenow', '20');
    expect(track).toHaveClass('is-dragging');

    fireEvent.pointerMove(track, { clientX: 250, pointerId: 1 });
    expect(track).toHaveAttribute('aria-valuenow', '30');

    fireEvent.pointerMove(track, { clientX: 999, pointerId: 1 });
    expect(track).toHaveAttribute('aria-valuenow', '40');

    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(track).not.toHaveClass('is-dragging');
    fireEvent.pointerMove(track, { clientX: 100, pointerId: 1 });
    expect(track).toHaveAttribute('aria-valuenow', '40');
  });

  it('ignores keys and pointer while disabled', async () => {
    const onValueChange = vi.fn();
    render(<Slider label="Volume" value={5} disabled onValueChange={onValueChange} />);
    const track = screen.getByRole('slider', { name: 'Volume' });
    expect(track).toHaveAttribute('aria-disabled', 'true');
    track.focus();
    await userEvent.keyboard('{ArrowRight}');
    fireEvent.pointerDown(track, { button: 0, clientX: 10 });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
