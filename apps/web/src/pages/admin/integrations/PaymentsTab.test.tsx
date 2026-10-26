import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  buildGateway,
  type GatewayFixtureOptions,
} from '../../../features/admin-integrations/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { PaymentsTab } from './PaymentsTab';

interface Calls {
  puts: { provider: string; body: Record<string, unknown> }[];
  tests: string[];
  activations: string[];
  reads: number;
}

function stubApi(
  options: GatewayFixtureOptions = {},
  testResult: { ok: boolean; message: string } = { ok: true, message: 'Credenciais válidas.' },
): Calls {
  const calls: Calls = { puts: [], tests: [], activations: [], reads: 0 };
  server.use(
    http.get('*/api/admin/integrations/gateway', () => {
      calls.reads += 1;
      return HttpResponse.json(buildGateway(options));
    }),
    http.put('*/api/admin/integrations/gateway/:provider', async ({ request, params }) => {
      calls.puts.push({
        provider: String(params['provider']),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(buildGateway(options).adapters[1]);
    }),
    http.post('*/api/admin/integrations/gateway/:provider/test', ({ params }) => {
      calls.tests.push(String(params['provider']));
      return HttpResponse.json(testResult);
    }),
    http.post('*/api/admin/integrations/gateway/:provider/activate', ({ params }) => {
      calls.activations.push(String(params['provider']));
      return HttpResponse.json({ activeProvider: params['provider'] });
    }),
  );
  return calls;
}

async function renderTab(
  options: GatewayFixtureOptions = {},
  result?: { ok: boolean; message: string },
) {
  const calls = stubApi(options, result);
  renderWithProviders(<PaymentsTab />);
  const card = await screen.findByRole('region', { name: 'Mercado Pago' });
  return { calls, card };
}

describe('PaymentsTab providers (GES-35)', () => {
  it('lists every provider with its state, the active one marked, and the webhook URL to copy', async () => {
    const { card } = await renderTab();

    const sandbox = screen.getByRole('region', { name: 'Sandbox (simulado)' });
    expect(within(sandbox).getByText('Ativo')).toBeInTheDocument();
    expect(within(card).queryByText('Ativo')).not.toBeInTheDocument();
    expect(within(card).getByText('Configurado')).toBeInTheDocument();
    expect(within(card).getByLabelText('URL do webhook')).toHaveValue(
      'https://bravoclinic.example/api/webhooks/pagamentos/mercadopago',
    );
    expect(within(card).getByLabelText('Ambiente')).toHaveValue('production');
    expect(within(card).getByLabelText('Public key')).toHaveValue('APP_USR-public-key');
  });

  it('shows a spinner while loading and an error alert with retry when the API fails', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/admin/integrations/gateway', () => {
        attempts += 1;
        // The first attempt and its automatic retry fail; the manual retry succeeds.
        return attempts <= 2
          ? apiError(500, 'INTERNAL', 'Falha ao carregar os provedores.')
          : HttpResponse.json(buildGateway());
      }),
    );
    renderWithProviders(<PaymentsTab />);

    expect(screen.getByRole('status', { name: 'Carregando os provedores' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar os provedores.');

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('region', { name: 'Mercado Pago' })).toBeInTheDocument();
  });
});

describe('PaymentsTab credentials (GES-36)', () => {
  it('leaves secret inputs empty with the stored hint as placeholder and sends empty secrets on save', async () => {
    const { calls, card } = await renderTab();

    for (const label of ['Access token', 'Assinatura secreta do webhook']) {
      const input = within(card).getByLabelText(label);
      expect(input).toHaveValue('');
      expect(input).toHaveAttribute('placeholder', '••••a1b2');
    }

    await userEvent.click(within(card).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(calls.puts).toEqual([
        {
          provider: 'mercadopago',
          body: {
            enabled: true,
            environment: 'production',
            config: { publicKey: 'APP_USR-public-key' },
            secrets: { accessToken: '', webhookSecret: '' },
          },
        },
      ]);
    });
    expect(await screen.findByText('Configuração salva.')).toBeInTheDocument();
  });

  it('sends a typed secret, the chosen environment and the enabled flag', async () => {
    const { calls, card } = await renderTab();

    await userEvent.type(within(card).getByLabelText('Access token'), 'APP_USR-novo-token');
    await userEvent.selectOptions(within(card).getByLabelText('Ambiente'), 'Teste');
    await userEvent.click(within(card).getByRole('checkbox', { name: 'Habilitado' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(calls.puts[0]?.body).toEqual({
        enabled: false,
        environment: 'test',
        config: { publicKey: 'APP_USR-public-key' },
        secrets: { accessToken: 'APP_USR-novo-token', webhookSecret: '' },
      });
    });
  });

  it('shows the API message when saving fails and keeps the typed value', async () => {
    const { card } = await renderTab();
    server.use(
      http.put('*/api/admin/integrations/gateway/:provider', () =>
        apiError(422, 'VALIDATION_FAILED', 'Credencial em formato inválido.'),
      ),
    );

    await userEvent.type(within(card).getByLabelText('Access token'), 'x');
    await userEvent.click(within(card).getByRole('button', { name: 'Salvar' }));

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Credencial em formato inválido.',
    );
    expect(within(card).getByLabelText('Access token')).toHaveValue('x');
  });
});

describe('PaymentsTab connection test (GES-37)', () => {
  it('shows the provider message in an error alert when ok is false', async () => {
    const { calls, card } = await renderTab(
      {},
      { ok: false, message: 'Access token recusado pelo Mercado Pago.' },
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Testar conexão' }));

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Access token recusado pelo Mercado Pago.',
    );
    expect(calls.tests).toEqual(['mercadopago']);
  });

  it('shows the message as a success notice when ok is true', async () => {
    const { card } = await renderTab();

    await userEvent.click(within(card).getByRole('button', { name: 'Testar conexão' }));

    const notice = await within(card).findByText('Credenciais válidas.');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('PaymentsTab activation (GES-38, GES-39)', () => {
  it('disables Ativar for a provider that is not configured', async () => {
    const { card } = await renderTab({ mercadoPagoConfigured: false });

    expect(within(card).getByText('Não configurado')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Ativar' })).toBeDisabled();
  });

  it('activates a configured provider after confirmation and reloads the list', async () => {
    const { calls, card } = await renderTab();
    const reads = calls.reads;

    await userEvent.click(within(card).getByRole('button', { name: 'Ativar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ativar Mercado Pago' });
    expect(calls.activations).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ativar provedor' }));

    await waitFor(() => {
      expect(calls.activations).toEqual(['mercadopago']);
    });
    await waitFor(() => {
      expect(calls.reads).toBeGreaterThan(reads);
    });
  });

  it('marks the active provider and offers no activation for it', async () => {
    await renderTab({ activeProvider: 'mercadopago' });

    const active = screen.getByRole('region', { name: 'Mercado Pago' });
    expect(within(active).getByText('Ativo')).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Ativar' })).toBeDisabled();
    expect(
      within(screen.getByRole('region', { name: 'Sandbox (simulado)' })).getByRole('button', {
        name: 'Ativar',
      }),
    ).toBeEnabled();
  });
});

describe('PaymentsTab test-mode banner (GES-41)', () => {
  it('warns "Pagamentos em modo de teste" when the API flags it', async () => {
    await renderTab({ productionWarning: true });

    expect(screen.getByText('Pagamentos em modo de teste')).toBeInTheDocument();
  });

  it('shows no banner when the API does not flag it', async () => {
    await renderTab({ productionWarning: false });

    expect(screen.queryByText('Pagamentos em modo de teste')).not.toBeInTheDocument();
  });
});
