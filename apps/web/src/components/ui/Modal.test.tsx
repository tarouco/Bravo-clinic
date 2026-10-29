import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <Modal
        open={open}
        title="Confirmar reserva"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <button type="button">Confirmar</button>
        <button type="button">Voltar</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a labelled modal dialog and moves focus inside it', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const title = screen.getByRole('heading', { name: 'Confirmar reserva' });
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('renders the pearl bv-modal over the blurred bv-scrim, in a portal under document.body', async () => {
    const { container } = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    expect(container).not.toContainElement(dialog);
    expect(dialog).toHaveClass('bv-modal');
    expect(dialog.parentElement).toHaveClass('bv-scrim');
    expect(screen.getByRole('heading', { name: 'Confirmar reserva' })).toHaveClass(
      'bv-modal-title',
    );
  });

  it('becomes a bottom sheet under 640px: anchored to the bottom edge, square bottom corners', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toHaveClass('max-sm:items-end', 'max-sm:p-0');
    expect(dialog).toHaveClass('max-sm:max-w-none', 'max-sm:rounded-b-none');
  });

  it('closes through the "Fechar" button', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wraps Tab from the last focusable element to the first and Shift+Tab back to the last', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const close = screen.getByRole('button', { name: 'Fechar' });
    const last = screen.getByRole('button', { name: 'Voltar' });
    expect(close).toHaveFocus();

    last.focus();
    await userEvent.tab();
    expect(close).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('calls onClose on Escape and returns focus to the trigger after closing', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('locks page scroll while open and restores it on close', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });
});
