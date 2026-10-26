import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover';

function Harness() {
  return (
    <>
      <Popover
        label="Filtros"
        trigger={(props) => (
          <button type="button" {...props}>
            Filtrar
          </button>
        )}
      >
        <p>Opções de filtro</p>
      </Popover>
      <p>Fora</p>
    </>
  );
}

describe('Popover', () => {
  it('toggles its panel on click and reflects aria-expanded', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Filtrar' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Filtros' })).toHaveTextContent('Opções de filtro');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Filtrar' });
    await userEvent.click(trigger);

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on a click outside but not on a click inside the panel', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await userEvent.click(screen.getByText('Opções de filtro'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Fora'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
