import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Alert, ComingSoon, Spinner } from './Feedback';
import { ToastProvider, useToast, type ToastInput } from './Toast';

function Trigger({ input }: { input: ToastInput }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(input)}>
      Disparar
    </button>
  );
}

function setup(input: ToastInput) {
  render(
    <ToastProvider>
      <Trigger input={input} />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a polite status toast that disappears after 6000 ms', () => {
    setup({ message: 'Reserva criada' });
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Reserva criada');
    expect(toast).toHaveAttribute('aria-live', 'polite');

    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a toast with an action after 6000 ms and runs the action on click', () => {
    const onAction = vi.fn();
    setup({ message: 'Reserva cancelada', action: { label: 'Desfazer', onAction } });
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reserva cancelada');

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Toast look', () => {
  it('is a pearl card with lift-3 and an icon in the tone color', () => {
    setup({ message: 'Não foi possível salvar', tone: 'error' });
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('rounded-md', 'bg-surface-raised', 'shadow-panel');
    expect(toast.querySelector('svg')).toHaveClass('text-danger');
  });
});

describe('Alert, Spinner and ComingSoon', () => {
  it('renders an error Alert with role="alert"', () => {
    render(<Alert tone="error">Falha ao salvar</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao salvar');
  });

  it('renders info and success Alerts as status, not alert', () => {
    render(
      <>
        <Alert tone="info">Informação</Alert>
        <Alert tone="success">Tudo certo</Alert>
      </>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('paints each tone with the derived status colors', () => {
    render(
      <>
        <Alert tone="error">Erro</Alert>
        <Alert tone="success">Sucesso</Alert>
        <Alert tone="warning">Aviso</Alert>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveClass('rounded-md', 'bg-danger-soft', 'text-danger');
    const [success, warning] = screen.getAllByRole('status');
    expect(success).toHaveClass('bg-emerald', 'text-on-emerald');
    expect(warning).toHaveClass('bg-gold', 'text-on-gold');
  });

  it('renders a Spinner with an accessible name', () => {
    render(<Spinner />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeInTheDocument();
  });

  it('renders ComingSoon with its title as a heading and "Em construção"', () => {
    render(<ComingSoon title="Financeiro" />);
    expect(screen.getByRole('heading', { name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.getByText('Em construção')).toBeInTheDocument();
  });
});
