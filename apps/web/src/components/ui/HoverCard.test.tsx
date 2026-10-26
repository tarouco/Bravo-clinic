import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HoverCard } from './HoverCard';

function Harness({ onCheckIn }: { onCheckIn?: () => void }) {
  return (
    <>
      <HoverCard
        label="Detalhes da reserva"
        trigger={(props) => (
          <button type="button" {...props}>
            Camila · Sala Principal
          </button>
        )}
      >
        <p>Camila Souza</p>
        <button type="button" onClick={onCheckIn}>
          Check-in
        </button>
      </HoverCard>
      <button type="button">Outro</button>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Camila · Sala Principal' });

describe('HoverCard', () => {
  it('is closed until the trigger is hovered or focused', () => {
    render(<Harness />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on hover as a dialog named by its label', async () => {
    render(<Harness />);

    await userEvent.hover(trigger());

    const card = screen.getByRole('dialog', { name: 'Detalhes da reserva' });
    expect(card).toHaveTextContent('Camila Souza');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', card.id);
  });

  it('opens on keyboard focus', async () => {
    render(<Harness />);

    await userEvent.tab();

    expect(trigger()).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Detalhes da reserva' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<Harness />);
    await userEvent.hover(trigger());

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the pointer leaves the trigger', async () => {
    render(<Harness />);
    await userEvent.hover(trigger());

    await userEvent.unhover(trigger());

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open while the pointer moves from the trigger into the card and runs its actions', async () => {
    const onCheckIn = vi.fn();
    render(<Harness onCheckIn={onCheckIn} />);
    await userEvent.hover(trigger());

    await userEvent.hover(screen.getByRole('button', { name: 'Check-in' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Check-in' }));
    expect(onCheckIn).toHaveBeenCalledTimes(1);
  });

  it('keeps the card reachable by Tab and closes it when focus moves on', async () => {
    render(<Harness />);
    await userEvent.tab();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Check-in' })).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Outro' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
