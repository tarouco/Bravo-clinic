import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  buildNotifications,
  outboxPage,
  RECIPIENT_IDS,
} from '../../../features/admin-integrations/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { EmailsTab } from './EmailsTab';

interface Calls {
  recipients: Record<string, unknown>[];
  patches: { id: string; body: unknown }[];
  deletes: string[];
  events: unknown[];
  tests: unknown[];
  outbox: URL[];
}

function stubApi(
  options: { providerConfigured?: boolean; testStatuses?: [string, string][] } = {},
): Calls {
  const calls: Calls = {
    recipients: [],
    patches: [],
    deletes: [],
    events: [],
    tests: [],
    outbox: [],
  };
  server.use(
    http.get('*/api/admin/integrations/notifications', () =>
      HttpResponse.json(buildNotifications(options)),
    ),
    http.post('*/api/admin/integrations/notifications/recipients', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.recipients.push(body);
      return HttpResponse.json(
        { id: 'a0000000-0000-4000-8000-0000000000ff', email: body['email'], active: true },
        { status: 201 },
      );
    }),
    http.patch(
      '*/api/admin/integrations/notifications/recipients/:id',
      async ({ request, params }) => {
        calls.patches.push({ id: String(params['id']), body: await request.json() });
        return HttpResponse.json(buildNotifications().recipients[0]);
      },
    ),
    http.delete('*/api/admin/integrations/notifications/recipients/:id', ({ params }) => {
      calls.deletes.push(String(params['id']));
      return new HttpResponse(null, { status: 204 });
    }),
    http.put('*/api/admin/integrations/notifications/events', async ({ request }) => {
      const body = await request.json();
      calls.events.push(body);
      return HttpResponse.json(body);
    }),
    http.post('*/api/admin/integrations/notifications/test', async ({ request }) => {
      calls.tests.push(await request.json());
      return HttpResponse.json({
        results: (
          options.testStatuses ?? [
            ['carla@bravo.example', 'sent'],
            ['rui@bravo.example', 'failed'],
          ]
        ).map(([to, status]) => ({ to, status })),
      });
    }),
    http.get('*/api/admin/integrations/outbox', ({ request }) => {
      calls.outbox.push(new URL(request.url));
      return HttpResponse.json(outboxPage);
    }),
  );
  return calls;
}

async function renderTab(options: Parameters<typeof stubApi>[0] = {}) {
  const calls = stubApi(options);
  renderWithProviders(<EmailsTab />);
  await screen.findByRole('region', { name: 'Avisos para a equipe' });
  return calls;
}

const EVENT_LABELS = [
  'Nova reserva',
  'Pagamento recebido',
  'Reserva cancelada',
  'Nova assinatura',
  'Falha na renovação de assinatura',
  'Pré-reserva expirada',
  'Novo pedido de orçamento',
];

describe('EmailsTab provider status (GES-74)', () => {
  it('shows the missing-provider message when the API reports no e-mail provider', async () => {
    await renderTab({ providerConfigured: false });

    expect(
      screen.getByText(
        'Provedor de e-mail não configurado — mensagens ficam registradas no histórico',
      ),
    ).toBeInTheDocument();
  });

  it('shows no such message when the provider is configured', async () => {
    await renderTab({ providerConfigured: true });

    expect(screen.queryByText(/Provedor de e-mail não configurado/)).not.toBeInTheDocument();
  });
});

describe('EmailsTab event toggles (GES-66)', () => {
  it('lists the 7 events in pt-BR with their current state', async () => {
    await renderTab();
    const section = screen.getByRole('region', { name: 'Avisos para a equipe' });

    expect(
      within(section)
        .getAllByRole('checkbox')
        .map((box) => (box as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual(EVENT_LABELS);
    expect(within(section).getByRole('checkbox', { name: 'Nova reserva' })).toBeChecked();
    expect(within(section).getByRole('checkbox', { name: 'Reserva cancelada' })).not.toBeChecked();
  });

  it('saves all 7 keys with the changed toggle', async () => {
    const calls = await renderTab();
    const section = screen.getByRole('region', { name: 'Avisos para a equipe' });

    await userEvent.click(within(section).getByRole('checkbox', { name: 'Reserva cancelada' }));
    await userEvent.click(within(section).getByRole('checkbox', { name: 'Nova reserva' }));
    await userEvent.click(within(section).getByRole('button', { name: 'Salvar avisos' }));

    await waitFor(() => {
      expect(calls.events).toEqual([
        {
          new_booking: false,
          payment_received: true,
          booking_cancelled: true,
          new_subscription: true,
          renewal_failed: true,
          pre_reservation_expired: false,
          new_quote_request: true,
        },
      ]);
    });
    expect(await screen.findByText('Avisos salvos.')).toBeInTheDocument();
  });
});

describe('EmailsTab recipients (GES-65)', () => {
  it('lists recipients with their state and adds a valid address, normalized by the shared schema', async () => {
    const calls = await renderTab();
    const section = screen.getByRole('region', { name: 'Destinatários' });

    expect(within(section).getByText('carla@bravo.example')).toBeInTheDocument();
    expect(within(section).getByText('rui@bravo.example')).toBeInTheDocument();
    expect(within(section).getByText('Pausado')).toBeInTheDocument();

    await userEvent.type(within(section).getByLabelText('Novo destinatário'), 'Nova@Bravo.example');
    await userEvent.click(within(section).getByRole('button', { name: 'Adicionar destinatário' }));

    await waitFor(() => {
      expect(calls.recipients).toEqual([{ email: 'nova@bravo.example' }]);
    });
  });

  it('refuses an invalid address with the core message and sends nothing', async () => {
    const calls = await renderTab();
    const section = screen.getByRole('region', { name: 'Destinatários' });

    await userEvent.type(within(section).getByLabelText('Novo destinatário'), 'sem-arroba');
    await userEvent.click(within(section).getByRole('button', { name: 'Adicionar destinatário' }));

    expect(await within(section).findByText(/e-mail/i)).toBeInTheDocument();
    expect(calls.recipients).toEqual([]);
  });

  it('shows the API message when the address is a duplicate', async () => {
    await renderTab();
    server.use(
      http.post('*/api/admin/integrations/notifications/recipients', () =>
        apiError(409, 'CONFLICT', 'Este e-mail já está na lista.'),
      ),
    );
    const section = screen.getByRole('region', { name: 'Destinatários' });

    await userEvent.type(
      within(section).getByLabelText('Novo destinatário'),
      'carla@bravo.example',
    );
    await userEvent.click(within(section).getByRole('button', { name: 'Adicionar destinatário' }));

    expect(await within(section).findByText('Este e-mail já está na lista.')).toBeInTheDocument();
  });

  it('pauses, resumes and removes a recipient', async () => {
    const calls = await renderTab();
    const section = screen.getByRole('region', { name: 'Destinatários' });

    await userEvent.click(
      within(section).getByRole('button', { name: 'Pausar carla@bravo.example' }),
    );
    await userEvent.click(
      within(section).getByRole('button', { name: 'Reativar rui@bravo.example' }),
    );
    await userEvent.click(
      within(section).getByRole('button', { name: 'Remover rui@bravo.example' }),
    );

    await waitFor(() => {
      expect(calls.patches).toEqual([
        { id: RECIPIENT_IDS.carla, body: { active: false } },
        { id: RECIPIENT_IDS.rui, body: { active: true } },
      ]);
    });
    await waitFor(() => {
      expect(calls.deletes).toEqual([RECIPIENT_IDS.rui]);
    });
  });
});

describe('EmailsTab test e-mail (GES-70)', () => {
  it('sends to every active recipient and shows the status of each address', async () => {
    const calls = await renderTab();
    const section = screen.getByRole('region', { name: 'E-mail de teste' });

    await userEvent.click(within(section).getByRole('button', { name: 'Enviar e-mail de teste' }));

    const results = await within(section).findByRole('list', { name: 'Resultado do envio' });
    expect(
      within(results)
        .getAllByRole('listitem')
        .map((li) => plain(li.textContent)),
    ).toEqual(['carla@bravo.example: Enviado', 'rui@bravo.example: Falhou']);
    expect(calls.tests).toEqual([{}]);
  });

  it('sends to the typed address only', async () => {
    const calls = await renderTab({ testStatuses: [['eu@bravo.example', 'pending']] });
    const section = screen.getByRole('region', { name: 'E-mail de teste' });

    await userEvent.type(
      within(section).getByLabelText('Enviar para (opcional)'),
      'eu@bravo.example',
    );
    await userEvent.click(within(section).getByRole('button', { name: 'Enviar e-mail de teste' }));

    expect(await within(section).findByText('eu@bravo.example: Pendente')).toBeInTheDocument();
    expect(calls.tests).toEqual([{ to: 'eu@bravo.example' }]);
  });

  it('shows the rate-limit message from the API', async () => {
    await renderTab();
    server.use(
      http.post('*/api/admin/integrations/notifications/test', () =>
        apiError(429, 'TOO_MANY_ATTEMPTS', 'Limite de 5 e-mails de teste por hora atingido.'),
      ),
    );
    const section = screen.getByRole('region', { name: 'E-mail de teste' });

    await userEvent.click(within(section).getByRole('button', { name: 'Enviar e-mail de teste' }));

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Limite de 5 e-mails de teste por hora atingido.',
    );
  });
});

describe('EmailsTab outbox (GES-71)', () => {
  it('lists the last messages with recipient, template, subject, status, attempts and error', async () => {
    await renderTab();
    const section = screen.getByRole('region', { name: 'Histórico de envios' });

    const failed = within(
      await within(section)
        .findByText('Reserva confirmada')
        .then((n) => n.closest('tr') as HTMLElement),
    );
    expect(failed.getAllByRole('cell').map((c) => plain(c.textContent))).toEqual([
      '24/10/2026 09:00',
      'ana@example.com',
      'booking.confirmed',
      'Reserva confirmada',
      'Falhou',
      '3',
      'Resend: domínio não verificado',
    ]);
  });

  it('filters by status and reloads', async () => {
    const calls = await renderTab();
    const section = screen.getByRole('region', { name: 'Histórico de envios' });
    await within(section).findByText('Reserva confirmada');

    await userEvent.selectOptions(within(section).getByLabelText('Situação'), 'Falhou');

    await waitFor(() => {
      expect(calls.outbox.some((url) => url.searchParams.get('status') === 'failed')).toBe(true);
    });
    expect(calls.outbox[0]?.searchParams.get('status')).toBeNull();
  });
});
