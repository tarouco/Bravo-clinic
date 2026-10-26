import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { RECEIPT_IDS, receipts } from '../../../features/admin-finance/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { ReceiptsTab } from './ReceiptsTab';

const TODAY = '2026-10-26' as const;
const CUSTOMER_ID = '55555555-5555-4555-8555-555555555555';

interface Calls {
  lists: URL[];
  posts: unknown[];
  deletes: { id: string; body: unknown }[];
}

function stubApi(): Calls {
  const calls: Calls = { lists: [], posts: [], deletes: [] };
  server.use(
    http.get('*/api/admin/finance/receipts', ({ request }) => {
      calls.lists.push(new URL(request.url));
      return HttpResponse.json(receipts);
    }),
    http.post('*/api/admin/finance/receipts', async ({ request }) => {
      calls.posts.push(await request.json());
      return HttpResponse.json(receipts.items[0], { status: 201 });
    }),
    http.delete('*/api/admin/finance/receipts/:id', async ({ request, params }) => {
      calls.deletes.push({ id: String(params['id']), body: await request.json() });
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('*/api/admin/customers/search', () =>
      HttpResponse.json({
        items: [{ id: CUSTOMER_ID, name: 'Ana Souza', email: 'ana@example.com', docMasked: null }],
      }),
    ),
  );
  return calls;
}

async function renderTab() {
  const calls = stubApi();
  renderWithProviders(<ReceiptsTab today={TODAY} />);
  await screen.findByText('Locação no balcão');
  return calls;
}

describe('ReceiptsTab list', () => {
  it('requests the current month and lists the receipts with category, method, customer and booking', async () => {
    const calls = await renderTab();

    expect(Object.fromEntries(calls.lists[0]?.searchParams ?? [])).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const first = screen.getByText('Locação no balcão').closest('tr') as HTMLElement;
    expect(
      within(first)
        .getAllByRole('cell')
        .map((c) => plain(c.textContent)),
    ).toEqual([
      '12/10/2026',
      'Locação avulsa',
      'Pix direto',
      'R$ 150,00',
      'Ana Souza',
      'BRV-7K2Q9X',
      'Locação no balcão',
      expect.stringContaining('Excluir'),
    ]);
    const second = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
    expect(second[1]).toHaveTextContent('Serviços extras');
    expect(second[2]).toHaveTextContent('Dinheiro');
  });

  it('shows the empty message', async () => {
    server.use(
      http.get('*/api/admin/finance/receipts', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<ReceiptsTab today={TODAY} />);

    expect(await screen.findByText('Nenhum recebimento manual no período.')).toBeInTheDocument();
  });
});

describe('Manual receipt form (GES-20)', () => {
  it('shows the core schema messages and sends nothing when the form is empty', async () => {
    const calls = await renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Novo recebimento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo recebimento manual' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar recebimento' }));

    expect(await within(dialog).findByText('Escolha a categoria de receita')).toBeInTheDocument();
    expect(within(dialog).getByText('Escolha a forma de recebimento')).toBeInTheDocument();
    expect(within(dialog).getByText('Informe um valor maior que zero')).toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);
  });

  it('posts the receipt in cents with the chosen customer', async () => {
    const calls = await renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Novo recebimento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo recebimento manual' });

    await userEvent.selectOptions(
      within(dialog).getByLabelText('Categoria da receita'),
      'Horas extras',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Forma de recebimento'),
      'Maquininha',
    );
    await userEvent.type(within(dialog).getByLabelText('Valor'), '99,90');
    await userEvent.type(within(dialog).getByLabelText('Buscar cliente'), 'ana');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Ana Souza/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar recebimento' }));

    await waitFor(() => {
      expect(calls.posts).toHaveLength(1);
    });
    expect(calls.posts[0]).toEqual({
      date: '2026-10-26',
      revenueCategory: 'extra_hours',
      method: 'card_machine',
      amountCents: 9990,
      userId: CUSTOMER_ID,
    });
    expect(await screen.findByText('Recebimento registrado.')).toBeInTheDocument();
  });

  it('maps a server 422 onto the field', async () => {
    await renderTab();
    server.use(
      http.post('*/api/admin/finance/receipts', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos',
              details: [{ path: 'userId', message: 'Cliente não encontrado' }],
            },
          },
          { status: 422 },
        ),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Novo recebimento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo recebimento manual' });
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Categoria da receita'),
      'Outras receitas',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Forma de recebimento'),
      'Dinheiro',
    );
    await userEvent.type(within(dialog).getByLabelText('Valor'), '10');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar recebimento' }));

    expect(await within(dialog).findByText('Cliente não encontrado')).toBeInTheDocument();
  });
});

describe('Delete manual receipt (GES-21)', () => {
  // formatBRL separates "R$" and the digits with a no-break space.
  const deleteButton = () =>
    screen.getByRole('button', { name: /^Excluir recebimento de R\$\s150,00 em 12\/10\/2026$/ });

  it('keeps the confirm button disabled until the justification has 5 characters', async () => {
    const calls = await renderTab();
    await userEvent.click(deleteButton());
    const dialog = await screen.findByRole('dialog', { name: 'Excluir recebimento' });
    const confirm = within(dialog).getByRole('button', { name: 'Excluir recebimento' });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'erro');
    expect(confirm).toBeDisabled();
    expect(
      within(dialog).getByText('A justificativa precisa ter pelo menos 5 caracteres'),
    ).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'o');
    expect(confirm).toBeEnabled();
    expect(calls.deletes).toHaveLength(0);
  });

  it('DELETEs with the justification in the body', async () => {
    const calls = await renderTab();
    await userEvent.click(deleteButton());
    const dialog = await screen.findByRole('dialog', { name: 'Excluir recebimento' });

    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'Lançado em duplicidade');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir recebimento' }));

    await waitFor(() => {
      expect(calls.deletes).toEqual([
        { id: RECEIPT_IDS.rental, body: { justification: 'Lançado em duplicidade' } },
      ]);
    });
    expect(await screen.findByText('Recebimento excluído.')).toBeInTheDocument();
  });

  it('shows the API error and keeps the dialog open', async () => {
    await renderTab();
    server.use(
      http.delete('*/api/admin/finance/receipts/:id', () =>
        apiError(404, 'NOT_FOUND', 'Recebimento não encontrado.'),
      ),
    );
    await userEvent.click(deleteButton());
    const dialog = await screen.findByRole('dialog', { name: 'Excluir recebimento' });
    await userEvent.type(within(dialog).getByLabelText('Justificativa'), 'Motivo válido');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir recebimento' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Recebimento não encontrado.',
    );
  });
});
