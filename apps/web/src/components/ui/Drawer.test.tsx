import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Drawer } from './Drawer';

function Harness({ side }: { side?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir reserva
      </button>
      <Drawer
        open={open}
        title="Reserva BRV-7K2Q9X"
        {...(side ? { side } : {})}
        onClose={() => setOpen(false)}
      >
        <button type="button">Reagendar</button>
        <button type="button">Cancelar reserva</button>
      </Drawer>
    </>
  );
}

describe('Drawer', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a modal dialog named by its title with focus inside', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Abrir reserva' }));

    const dialog = screen.getByRole('dialog', { name: 'Reserva BRV-7K2Q9X' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('traps focus: Tab from the last control returns to the first, Shift+Tab goes back', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir reserva' }));
    const close = screen.getByRole('button', { name: 'Fechar' });
    const last = screen.getByRole('button', { name: 'Cancelar reserva' });
    expect(close).toHaveFocus();

    last.focus();
    await userEvent.tab();
    expect(close).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir reserva' });
    await userEvent.click(opener);

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes on a click on the backdrop and slides from the chosen side', async () => {
    render(<Harness side="left" />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir reserva' }));
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    expect(backdrop).toHaveClass('bv-scrim', 'justify-start');
    expect(screen.getByRole('dialog')).toHaveClass('bg-surface-raised', 'rounded-r-xl');

    await userEvent.click(backdrop);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
