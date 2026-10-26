import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  buildMcp,
  MCP_TOKEN_IDS,
  RAW_MCP_TOKEN,
  type McpFixtureOptions,
} from '../../../features/admin-integrations/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { McpTab } from './McpTab';

interface Calls {
  enabled: unknown[];
  tokens: Record<string, unknown>[];
  revoked: string[];
}

function stubApi(options: McpFixtureOptions = {}): Calls {
  const calls: Calls = { enabled: [], tokens: [], revoked: [] };
  const state = buildMcp(options);
  server.use(
    http.get('*/api/admin/integrations/mcp', () => HttpResponse.json(state)),
    http.put('*/api/admin/integrations/mcp', async ({ request }) => {
      const body = (await request.json()) as { enabled: boolean };
      calls.enabled.push(body);
      state.enabled = body.enabled;
      return HttpResponse.json(body);
    }),
    http.post('*/api/admin/integrations/mcp/tokens', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.tokens.push(body);
      const record = {
        id: 'c0000000-0000-4000-8000-0000000000aa',
        name: String(body['name']),
        scope: body['scope'] as 'read' | 'read_write',
        prefix: RAW_MCP_TOKEN.slice(0, 9),
        createdAt: '2026-10-26T13:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      };
      state.tokens = [...state.tokens, record];
      return HttpResponse.json({ token: RAW_MCP_TOKEN, record }, { status: 201 });
    }),
    http.delete('*/api/admin/integrations/mcp/tokens/:id', ({ params }) => {
      calls.revoked.push(String(params['id']));
      state.tokens = state.tokens.map((t) =>
        t.id === params['id'] ? { ...t, revokedAt: '2026-10-26T13:00:00.000Z' } : t,
      );
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

async function renderTab(options: McpFixtureOptions = {}) {
  const calls = stubApi(options);
  renderWithProviders(<McpTab />);
  await screen.findByRole('table', { name: 'Ferramentas do servidor MCP' });
  return calls;
}

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

describe('McpTab server (GES-63)', () => {
  it('shows the server URL to copy and no warning when the API sends none', async () => {
    await renderTab();

    expect(screen.getByLabelText('URL do servidor MCP')).toHaveValue(
      'https://api.bravoclinic.example/mcp',
    );
    expect(screen.queryByText(/proxy da Netlify/)).not.toBeInTheDocument();
  });

  it('shows the URL warning from the API', async () => {
    await renderTab({
      serverUrlWarning: 'Esta URL passa pelo proxy da Netlify, que corta chamadas longas.',
    });

    expect(
      screen.getByText('Esta URL passa pelo proxy da Netlify, que corta chamadas longas.'),
    ).toBeInTheDocument();
  });

  it('lists the tools with their scope and marks only the destructive one as requiring confirmation', async () => {
    await renderTab();

    const read = within(rowOf('agenda_list')).getAllByRole('cell');
    expect(read.map((c) => c.textContent)).toEqual([
      'agenda_list',
      'Lista os eventos da agenda em um período.',
      'Leitura',
      '—',
    ]);
    const write = within(rowOf('booking_create')).getAllByRole('cell');
    expect(write.map((c) => c.textContent)).toEqual([
      'booking_create',
      'Cria uma reserva para um cliente.',
      'Leitura e escrita',
      '—',
    ]);
    expect(within(rowOf('booking_cancel')).getByText('Requer confirmação')).toBeInTheDocument();
    expect(screen.getAllByText('Requer confirmação')).toHaveLength(1);
  });

  it('turns the server off and on with the enable switch', async () => {
    const calls = await renderTab();
    const toggle = screen.getByRole('checkbox', { name: 'Servidor MCP ativo' });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(calls.enabled).toEqual([{ enabled: false }]);
    });
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Servidor MCP ativo' })).not.toBeChecked();
    });
  });
});

describe('McpTab tokens (GES-53, GES-54)', () => {
  async function openModal() {
    await userEvent.click(screen.getByRole('button', { name: 'Novo token' }));
    return screen.findByRole('dialog', { name: 'Novo token de acesso' });
  }

  it('validates the name with the core message and creates nothing', async () => {
    const calls = await renderTab();
    const dialog = await openModal();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar token' }));

    expect(await within(dialog).findByText('Informe um nome para o token')).toBeInTheDocument();
    expect(calls.tokens).toEqual([]);
  });

  it('rejects an expiry outside 1..365 days', async () => {
    const calls = await renderTab();
    const dialog = await openModal();

    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Claude Desktop');
    await userEvent.type(within(dialog).getByLabelText('Validade em dias (opcional)'), '400');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar token' }));

    expect(
      await within(dialog).findByText('A validade precisa ser de 1 a 365 dias'),
    ).toBeInTheDocument();
    expect(calls.tokens).toEqual([]);
  });

  it('creates the token, shows the raw value once with the copy warning, and clears it on close', async () => {
    const calls = await renderTab();
    const dialog = await openModal();

    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Claude Desktop');
    await userEvent.selectOptions(within(dialog).getByLabelText('Escopo'), 'Leitura e escrita');
    await userEvent.type(within(dialog).getByLabelText('Validade em dias (opcional)'), '30');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar token' }));

    expect(await within(dialog).findByLabelText('Token de acesso')).toHaveValue(RAW_MCP_TOKEN);
    expect(
      within(dialog).getByText('Copie agora: o token não será exibido de novo'),
    ).toBeInTheDocument();
    expect(calls.tokens).toEqual([
      { name: 'Claude Desktop', scope: 'read_write', expiresInDays: 30 },
    ]);
    // The list shows the token by prefix only, never the raw value.
    const listed = await screen.findByText('Claude Desktop');
    expect(listed.closest('tr')).toHaveTextContent('bmcp_Qk3v…');
    expect(listed.closest('tr')).not.toHaveTextContent(RAW_MCP_TOKEN);
    expect(screen.getAllByDisplayValue(RAW_MCP_TOKEN)).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Concluir' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(RAW_MCP_TOKEN)).not.toBeInTheDocument();
    const reopened = await openModal();
    expect(within(reopened).queryByLabelText('Token de acesso')).not.toBeInTheDocument();
    expect(within(reopened).getByLabelText('Nome')).toHaveValue('');
  });

  it('shows the API message when creation fails and keeps the form', async () => {
    await renderTab();
    server.use(
      http.post('*/api/admin/integrations/mcp/tokens', () =>
        apiError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas. Aguarde um pouco.'),
      ),
    );
    const dialog = await openModal();

    await userEvent.type(within(dialog).getByLabelText('Nome'), 'Claude Desktop');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar token' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Aguarde um pouco.',
    );
    expect(within(dialog).getByLabelText('Nome')).toHaveValue('Claude Desktop');
  });

  it('lists tokens by prefix and revokes one after confirmation', async () => {
    const calls = await renderTab();

    expect(within(rowOf('Assistente da Carla')).getByText('bmcp_Qk3v…')).toBeInTheDocument();
    expect(within(rowOf('Teste antigo')).getByText('Revogado')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Revogar token Assistente da Carla' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Revogar token' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revogar token' }));

    await waitFor(() => {
      expect(calls.revoked).toEqual([MCP_TOKEN_IDS.assistant]);
    });
    await waitFor(() => {
      expect(within(rowOf('Assistente da Carla')).getByText('Revogado')).toBeInTheDocument();
    });
  });
});
