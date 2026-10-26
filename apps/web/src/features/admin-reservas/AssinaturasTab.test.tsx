import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { registerRevenueSlots } from '../../extensions/receita';
import { resetSlots } from '../../extensions/slots';
import {
  ReservationsPage,
  ReservationsSlotTab,
} from '../../pages/admin/reservations/ReservationsPage';
import { ID } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { plain, stubStaffSession, type StaffRole } from '../../test/session';
import {
  adjustedPeriod,
  adminSubscriptionList,
  creditsSummary,
  ledgerPage,
  RID,
  subscriptionActive,
  subscriptionAwaiting,
} from '../purchases/fixtures';
import { AssinaturasTab } from './AssinaturasTab';

const ADMIN_ONLY_BUTTONS = [
  'Ajustar saldo',
  'Conceder crédito',
  'Reenviar link',
  'Cancelar assinatura',
];

interface Calls {
  listUrls: URL[];
  posts: { url: string; body: unknown; key: string | null }[];
}

function stubAdmin(role: StaffRole = 'admin'): Calls {
  stubStaffSession(role);
  const calls: Calls = { listUrls: [], posts: [] };
  const record = async (request: Request) => {
    calls.posts.push({
      url: new URL(request.url).pathname,
      body: await request.json().catch(() => null),
      key: request.headers.get('Idempotency-Key'),
    });
  };
  server.use(
    http.get('*/api/admin/subscriptions', ({ request }) => {
      calls.listUrls.push(new URL(request.url));
      return HttpResponse.json(adminSubscriptionList);
    }),
    http.get('*/api/admin/subscriptions/:id', ({ params }) =>
      HttpResponse.json(params['id'] === RID.subActive ? subscriptionActive : subscriptionAwaiting),
    ),
    http.get('*/api/admin/subscriptions/:id/ledger', () => HttpResponse.json(ledgerPage)),
    http.post('*/api/admin/subscriptions/:id/adjust-balance', async ({ request }) => {
      await record(request);
      return HttpResponse.json({ period: adjustedPeriod });
    }),
    http.post('*/api/admin/subscriptions/:id/cancel', async ({ request }) => {
      await record(request);
      return HttpResponse.json({ subscription: { ...subscriptionActive, status: 'cancelled' } });
    }),
    http.post('*/api/admin/subscriptions/:id/resend-link', async ({ request }) => {
      await record(request);
      return HttpResponse.json({ ok: true });
    }),
    http.post('*/api/admin/customers/:userId/credits', async ({ request }) => {
      await record(request);
      return HttpResponse.json({ lot: creditsSummary.lots[0] }, { status: 201 });
    }),
  );
  return calls;
}

async function renderTab(role: StaffRole = 'admin') {
  const calls = stubAdmin(role);
  renderWithProviders(<AssinaturasTab />);
  await screen.findByText('Meio turno');
  return calls;
}

/** Opens the detail drawer of one row by its accessible name. */
async function openRow(name: RegExp) {
  await userEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: /Ana Souza ·/ });
}

const activeRow = /Abrir assinatura de Ana Souza: Pacote 20h/;
const awaitingRow = /Abrir assinatura de Ana Souza: Meio turno/;

describe('AssinaturasTab list (REC-148)', () => {
  it('shows customer, category, base date, next charge, status label and the balance', async () => {
    await renderTab();

    const cells = within(screen.getByText('Pacote 20h').closest('tr') as HTMLElement).getAllByRole(
      'cell',
    );
    expect(plain(cells[0]?.textContent)).toBe('Ana Souza');
    expect(plain(cells[1]?.textContent)).toBe('Pacote 20h');
    expect(plain(cells[2]?.textContent)).toBe('Pacote de horas');
    expect(plain(cells[4]?.textContent)).toBe('02/11/2026');
    expect(plain(cells[5]?.textContent)).toBe('30/11/2026');
    expect(plain(cells[6]?.textContent)).toBe('Ativa');
    expect(plain(cells[7]?.textContent)).toContain('12h 30min');
  });

  it('shows the room and "Aguardando pgto" of a fixed schedule without a next charge', async () => {
    await renderTab();

    const cells = within(screen.getByText('Meio turno').closest('tr') as HTMLElement).getAllByRole(
      'cell',
    );
    expect(plain(cells[3]?.textContent)).toBe('Sala Principal');
    expect(plain(cells[5]?.textContent)).toBe('—');
    expect(plain(cells[6]?.textContent)).toBe('Aguardando pgto');
  });

  it('sends the status, type and search filters as query parameters', async () => {
    const calls = await renderTab();
    expect(calls.listUrls[0]?.search).toBe('');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Suspensa');
    await waitFor(() => {
      expect(calls.listUrls.at(-1)?.searchParams.get('status')).toBe('suspended');
    });
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'Horário fixo');
    await waitFor(() => {
      expect(calls.listUrls.at(-1)?.searchParams.get('type')).toBe('fixed_schedule');
    });
    await userEvent.type(screen.getByLabelText('Buscar cliente'), 'ana');
    await waitFor(() => {
      expect(calls.listUrls.at(-1)?.searchParams.get('search')).toBe('ana');
    });
    expect(calls.listUrls.at(-1)?.searchParams.get('status')).toBe('suspended');
  });

  it('says so when nothing matches', async () => {
    stubStaffSession('admin');
    server.use(
      http.get('*/api/admin/subscriptions', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<AssinaturasTab />);

    expect(await screen.findByText('Nenhuma assinatura encontrada.')).toBeInTheDocument();
  });
});

describe('Subscription drawer (REC-149)', () => {
  it('shows the periods, the balance and the extrato of the subscription', async () => {
    await renderTab();

    const drawer = await openRow(activeRow);

    const periods = await within(drawer).findByRole('list', { name: 'Períodos da assinatura' });
    expect(plain(periods.textContent)).toContain(
      'Período 1 · 02/11/2026 a 02/12/2026 · Vigente · R$ 1.600,00 · saldo 12h 30min',
    );
    expect(within(drawer).getByRole('meter', { name: 'Saldo do pacote' })).toHaveAttribute(
      'aria-valuenow',
      '750',
    );
    expect(await within(drawer).findByText('60 min + 18 min de excedente = 78 min')).toBeVisible();
  });

  it('lets the admin adjust the balance with signed minutes and a justification', async () => {
    const calls = await renderTab();
    const drawer = await openRow(activeRow);
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Ajustar saldo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajustar saldo' });

    await userEvent.type(within(dialog).getByLabelText('Minutos a ajustar'), '-60');
    expect(within(dialog).getByText('Saldo depois do ajuste: 11h 30min')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'abc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ajustar saldo' }));
    expect(
      await within(dialog).findByText('A justificativa precisa ter pelo menos 5 caracteres'),
    ).toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'de lançamento duplicado');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ajustar saldo' }));

    await waitFor(() => {
      expect(calls.posts).toHaveLength(1);
    });
    expect(calls.posts[0]).toMatchObject({
      url: `/api/admin/subscriptions/${RID.subActive}/adjust-balance`,
      body: { minutes: -60, justification: 'abcde lançamento duplicado' },
    });
  });

  it('refuses a zero adjustment and one above 12.000 minutes', async () => {
    const calls = await renderTab();
    const drawer = await openRow(activeRow);
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Ajustar saldo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajustar saldo' });
    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'Correção de saldo');

    await userEvent.type(within(dialog).getByLabelText('Minutos a ajustar'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ajustar saldo' }));
    const message = 'Ajuste de 1 a 12.000 minutos, para mais ou para menos';
    expect(await within(dialog).findByText(message)).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Minutos a ajustar'));
    await userEvent.type(within(dialog).getByLabelText('Minutos a ajustar'), '12001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ajustar saldo' }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);
  });

  it('grants a credit of R$ 50,00 as 5000 cents with the justification and an Idempotency-Key', async () => {
    const calls = await renderTab();
    const drawer = await openRow(activeRow);
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Conceder crédito' }));
    const dialog = await screen.findByRole('dialog', { name: 'Conceder crédito' });

    await userEvent.type(within(dialog).getByLabelText('Valor do crédito (R$)'), 'R$ 50,00');
    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'Cortesia por atraso');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Conceder crédito' }));

    await waitFor(() => {
      expect(calls.posts).toHaveLength(1);
    });
    expect(calls.posts[0]?.url).toBe(`/api/admin/customers/${ID.user}/credits`);
    expect(calls.posts[0]?.body).toEqual({
      amountCents: 5000,
      justification: 'Cortesia por atraso',
    });
    expect(calls.posts[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(/Crédito de R\$\s50,00 concedido\./)).toBeInTheDocument();
  });

  it('requires a justification and a valid amount to grant a credit', async () => {
    const calls = await renderTab();
    const drawer = await openRow(activeRow);
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Conceder crédito' }));
    const dialog = await screen.findByRole('dialog', { name: 'Conceder crédito' });

    await userEvent.type(within(dialog).getByLabelText('Valor do crédito (R$)'), '100.000,01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Conceder crédito' }));

    expect(
      await within(dialog).findByText('Informe um valor entre R$ 0,01 e R$ 100.000,00'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('A justificativa precisa ter pelo menos 5 caracteres'),
    ).toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);
  });

  it('cancels with a justification and refuses to cancel without one', async () => {
    const calls = await renderTab();
    const drawer = await openRow(activeRow);
    await userEvent.click(
      await within(drawer).findByRole('button', { name: 'Cancelar assinatura' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cancelar assinatura' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cancelamento' }));
    expect(
      await within(dialog).findByText('A justificativa precisa ter pelo menos 5 caracteres'),
    ).toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'Pedido do cliente');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cancelamento' }));

    await waitFor(() => {
      expect(calls.posts).toHaveLength(1);
    });
    expect(calls.posts[0]).toMatchObject({
      url: `/api/admin/subscriptions/${RID.subActive}/cancel`,
      body: { justification: 'Pedido do cliente' },
    });
  });

  it('resends the payment link of a sale awaiting payment, and only then', async () => {
    const calls = await renderTab();
    let drawer = await openRow(awaitingRow);

    await userEvent.click(await within(drawer).findByRole('button', { name: 'Reenviar link' }));

    await waitFor(() => {
      expect(calls.posts.map((p) => p.url)).toEqual([
        `/api/admin/subscriptions/${RID.subAwaiting}/resend-link`,
      ]);
    });
    expect(await screen.findByText('Link reenviado ao cliente.')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Ajustar saldo' })).toBeNull();

    await userEvent.click(within(drawer).getByRole('button', { name: 'Fechar' }));
    drawer = await openRow(activeRow);
    await within(drawer).findByRole('button', { name: 'Ajustar saldo' });
    expect(within(drawer).queryByRole('button', { name: 'Reenviar link' })).toBeNull();
  });

  it('hides every admin action from reception while keeping the periods and the extrato', async () => {
    await renderTab('reception');
    const drawer = await openRow(activeRow);

    expect(
      await within(drawer).findByRole('list', { name: 'Períodos da assinatura' }),
    ).toBeVisible();
    expect(await within(drawer).findByText('60 min + 18 min de excedente = 78 min')).toBeVisible();
    for (const name of ADMIN_ONLY_BUTTONS) {
      expect(within(drawer).queryByRole('button', { name })).toBeNull();
    }
  });
});

describe('AssinaturasTab in Gestão de Reservas (REC-148)', () => {
  afterEach(() => {
    resetSlots();
  });

  it('is the "Assinaturas" sub-tab registered in admin.reservations.tabs', async () => {
    registerRevenueSlots();
    stubAdmin('reception');
    renderWithProviders(
      <Routes>
        <Route path="/admin/reservas" element={<ReservationsPage />}>
          <Route path=":tabId" element={<ReservationsSlotTab />} />
        </Route>
      </Routes>,
      '/admin/reservas/assinaturas',
    );

    expect(await screen.findByText('Meio turno')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assinaturas' })).toHaveAttribute(
      'href',
      '/admin/reservas/assinaturas',
    );
  });
});
