import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { buildStaffUsers, USER_IDS } from '../../../features/admin-users/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain, stubStaffSession } from '../../../test/session';
import { UsersPage } from './UsersPage';

interface Calls {
  invites: Record<string, unknown>[];
  patches: { id: string; body: unknown }[];
  resets: { id: string; body: unknown }[];
}

function stubApi(): Calls {
  const calls: Calls = { invites: [], patches: [], resets: [] };
  server.use(
    http.get('*/api/admin/users', () => HttpResponse.json(buildStaffUsers())),
    http.post('*/api/admin/users/:id/totp-reset', async ({ request, params }) => {
      calls.resets.push({ id: String(params['id']), body: await request.json() });
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/api/admin/users', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.invites.push(body);
      return HttpResponse.json(
        {
          ...body,
          id: 'b1000000-0000-4000-8000-0000000000ff',
          status: 'active',
          totpConfirmed: false,
          lastLoginAt: null,
        },
        { status: 201 },
      );
    }),
    http.patch('*/api/admin/users/:id', async ({ request, params }) => {
      calls.patches.push({ id: String(params['id']), body: await request.json() });
      return HttpResponse.json(buildStaffUsers().items[1]);
    }),
  );
  return calls;
}

async function renderPage() {
  stubStaffSession('admin');
  const calls = stubApi();
  renderWithProviders(<UsersPage />);
  await screen.findByText('Rui Lima');
  // The own-row rules need the session.
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Alterar perfil de Carla Mendes' })).toBeDisabled();
  });
  return calls;
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('UsersPage list (GES-110)', () => {
  it('lists staff with role, status, 2FA status and last login', async () => {
    await renderPage();

    expect(
      within(rowOf('Rui Lima'))
        .getAllByRole('cell')
        .map((c) => plain(c.textContent)),
    ).toEqual([
      'Rui Lima',
      'rui@bravo.example',
      'Recepção',
      'Ativo',
      'Ativa',
      '25/10/2026 15:00',
      expect.stringContaining('Alterar perfil'),
    ]);
    const marta = within(rowOf('Marta Reis')).getAllByRole('cell');
    expect(marta.slice(2, 6).map((c) => c.textContent)).toEqual([
      'Recepção',
      'Desativado',
      'Pendente',
      'Nunca',
    ]);
    expect(within(rowOf('Carla Mendes')).getByText('Administrador')).toBeInTheDocument();
  });

  it('shows an error alert with retry when the list cannot be loaded', async () => {
    stubStaffSession('admin');
    let attempts = 0;
    server.use(
      http.get('*/api/admin/users', () => {
        attempts += 1;
        // The first attempt and its automatic retry fail; the manual retry succeeds.
        return attempts <= 2
          ? apiError(500, 'INTERNAL', 'Falha ao carregar os usuários.')
          : HttpResponse.json(buildStaffUsers());
      }),
    );
    renderWithProviders(<UsersPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar os usuários.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Rui Lima')).toBeInTheDocument();
  });
});

describe('UsersPage own account (GES-113)', () => {
  it('disables the role, status and 2FA actions on the own row and leaves the others enabled', async () => {
    await renderPage();

    const own = within(rowOf('Carla Mendes'));
    expect(own.getByRole('button', { name: 'Alterar perfil de Carla Mendes' })).toBeDisabled();
    expect(own.getByRole('button', { name: 'Desativar Carla Mendes' })).toBeDisabled();
    expect(own.getByRole('button', { name: 'Redefinir 2FA de Carla Mendes' })).toBeDisabled();

    const other = within(rowOf('Rui Lima'));
    expect(other.getByRole('button', { name: 'Alterar perfil de Rui Lima' })).toBeEnabled();
    expect(other.getByRole('button', { name: 'Desativar Rui Lima' })).toBeEnabled();
    expect(other.getByRole('button', { name: 'Redefinir 2FA de Rui Lima' })).toBeEnabled();
  });

  it('shows the pt-BR message of LAST_ADMIN when the API refuses the change', async () => {
    await renderPage();
    server.use(
      http.patch('*/api/admin/users/:id', () =>
        apiError(409, 'LAST_ADMIN', 'At least one active admin is required.'),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Desativar Rui Lima' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desativar usuário' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desativar usuário' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'É preciso manter ao menos um administrador ativo',
    );
  });
});

describe('UsersPage role and status actions (GES-112)', () => {
  it('changes the role only after confirmation, naming the new role', async () => {
    const calls = await renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Alterar perfil de Rui Lima' }));
    const dialog = await screen.findByRole('dialog', { name: 'Alterar perfil' });
    expect(dialog).toHaveTextContent('Rui Lima passa a ser Administrador');
    expect(calls.patches).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar alteração' }));

    await waitFor(() => {
      expect(calls.patches).toEqual([{ id: USER_IDS.rui, body: { role: 'admin' } }]);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('disables an active user and reactivates a disabled one, each after confirmation', async () => {
    const calls = await renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Desativar Rui Lima' }));
    let dialog = await screen.findByRole('dialog', { name: 'Desativar usuário' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desativar usuário' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Reativar Marta Reis' }));
    dialog = await screen.findByRole('dialog', { name: 'Reativar usuário' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reativar usuário' }));

    await waitFor(() => {
      expect(calls.patches).toEqual([
        { id: USER_IDS.rui, body: { status: 'disabled' } },
        { id: USER_IDS.marta, body: { status: 'active' } },
      ]);
    });
  });
});

describe('UsersPage 2FA reset (GES-114)', () => {
  it('needs a justification of 5 characters or more before it can be confirmed', async () => {
    const calls = await renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Redefinir 2FA de Rui Lima' }));
    const dialog = await screen.findByRole('dialog', { name: 'Redefinir 2FA' });
    const confirm = within(dialog).getByRole('button', { name: 'Redefinir 2FA' });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'abc');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'de, celular perdido');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => {
      expect(calls.resets).toEqual([
        { id: USER_IDS.rui, body: { justification: 'abcde, celular perdido' } },
      ]);
    });
  });

  it('offers no reset to a user who has no second factor', async () => {
    await renderPage();

    expect(screen.getByRole('button', { name: 'Redefinir 2FA de Marta Reis' })).toBeDisabled();
  });
});

describe('UsersPage invite and promote (GES-111)', () => {
  async function openInvite() {
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar usuário' }));
    return screen.findByRole('dialog', { name: 'Adicionar usuário' });
  }

  it('shows the core messages for an empty form and sends nothing', async () => {
    const calls = await renderPage();
    const dialog = await openInvite();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));

    expect(await within(dialog).findByText('E-mail inválido')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Informe o nome com pelo menos 2 caracteres'),
    ).toBeInTheDocument();
    expect(calls.invites).toEqual([]);
  });

  it('invites a new e-mail with the chosen role', async () => {
    const calls = await renderPage();
    const dialog = await openInvite();

    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Paulo Reis');
    await userEvent.type(within(dialog).getByLabelText('E-mail'), 'Paulo@Bravo.example');
    await userEvent.selectOptions(within(dialog).getByLabelText('Perfil'), 'Administrador');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));

    await waitFor(() => {
      expect(calls.invites).toEqual([
        { name: 'Paulo Reis', email: 'paulo@bravo.example', role: 'admin' },
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows the API message when the e-mail already belongs to staff', async () => {
    await renderPage();
    server.use(
      http.post('*/api/admin/users', () =>
        apiError(409, 'CONFLICT', 'Este e-mail já pertence a um usuário da equipe.'),
      ),
    );
    const dialog = await openInvite();

    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Rui Lima');
    await userEvent.type(within(dialog).getByLabelText('E-mail'), 'rui@bravo.example');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar convite' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Este e-mail já pertence a um usuário da equipe.',
    );
  });
});
