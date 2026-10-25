import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/Toast';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const registerSW = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn<(reloadPage?: boolean) => Promise<void>>(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [registerSW.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: registerSW.updateServiceWorker,
  }),
}));

function renderPrompt() {
  return render(
    <ToastProvider>
      <PwaUpdatePrompt />
    </ToastProvider>,
  );
}

beforeEach(() => {
  registerSW.needRefresh = false;
  registerSW.updateServiceWorker.mockReset();
  registerSW.updateServiceWorker.mockResolvedValue(undefined);
});

describe('PwaUpdatePrompt (FND-121)', () => {
  it('shows "Nova versão disponível" with an "Atualizar" action when a new worker is waiting', () => {
    registerSW.needRefresh = true;
    renderPrompt();

    expect(screen.getByText('Nova versão disponível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
  });

  it('activates the waiting worker and reloads when "Atualizar" is clicked', async () => {
    registerSW.needRefresh = true;
    const user = userEvent.setup();
    renderPrompt();

    await user.click(screen.getByRole('button', { name: 'Atualizar' }));

    expect(registerSW.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });

  it('shows nothing while no new version is waiting', () => {
    renderPrompt();

    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atualizar' })).not.toBeInTheDocument();
  });
});
