import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORY_IDS,
  EXPENSE_IDS,
  expenseCategories,
  expenses,
} from '../../../features/admin-finance/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { ExpensesTab } from './ExpensesTab';

const TODAY = '2026-10-26' as const;

interface Calls {
  lists: URL[];
  posts: unknown[];
  patches: { id: string; body: unknown }[];
  deletes: string[];
  puts: { id: string; type: string | null; name: string | null; text: string }[];
}

function stubApi(overrides: { list?: unknown } = {}): Calls {
  const calls: Calls = { lists: [], posts: [], patches: [], deletes: [], puts: [] };
  server.use(
    http.get('*/api/admin/finance/expense-categories', () => HttpResponse.json(expenseCategories)),
    http.get('*/api/admin/finance/expenses', ({ request }) => {
      calls.lists.push(new URL(request.url));
      return HttpResponse.json(overrides.list ?? expenses);
    }),
    http.post('*/api/admin/finance/expenses', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.posts.push(body);
      return HttpResponse.json(
        { ...expenses.items[1], ...body, id: 'e9999999-9999-4999-8999-999999999999' },
        { status: 201 },
      );
    }),
    http.patch('*/api/admin/finance/expenses/:id', async ({ request, params }) => {
      calls.patches.push({ id: String(params['id']), body: await request.json() });
      return HttpResponse.json(expenses.items[0]);
    }),
    http.delete('*/api/admin/finance/expenses/:id', ({ params }) => {
      calls.deletes.push(String(params['id']));
      return new HttpResponse(null, { status: 204 });
    }),
    http.put('*/api/admin/finance/expenses/:id/attachment', async ({ request, params }) => {
      calls.puts.push({
        id: String(params['id']),
        type: request.headers.get('Content-Type'),
        name: request.headers.get('X-File-Name'),
        text: await request.text(),
      });
      return HttpResponse.json(expenses.items[1]);
    }),
  );
  return calls;
}

async function renderTab() {
  const calls = stubApi();
  renderWithProviders(<ExpensesTab today={TODAY} />);
  await screen.findByText('Conta de luz de setembro');
  return calls;
}

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

async function openNewForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Nova despesa' }));
  return screen.findByRole('dialog', { name: 'Nova despesa' });
}

async function fillValid(dialog: HTMLElement) {
  await userEvent.selectOptions(within(dialog).getByLabelText('Categoria'), 'Energia elétrica');
  await userEvent.type(within(dialog).getByLabelText('Descrição'), 'Conta de luz de outubro');
  await userEvent.type(within(dialog).getByLabelText('Valor'), '312,50');
}

describe('ExpensesTab list', () => {
  it('requests the current month by default and lists date, category, description, amount and attachment', async () => {
    const calls = await renderTab();

    expect(Object.fromEntries(calls.lists[0]?.searchParams ?? [])).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const energy = within(rowOf('Conta de luz de setembro')).getAllByRole('cell');
    expect(energy.map((c) => plain(c.textContent))).toEqual([
      '10/10/2026',
      'Energia elétrica',
      'Conta de luz de setembro',
      'R$ 312,50',
      '—',
      expect.stringContaining('Editar'),
    ]);
  });

  it('marks a recurring parent with its recurrence, the generated rows as automatic, and links the attachment', async () => {
    await renderTab();

    const parent = within(
      screen.getAllByText('Aluguel da sala comercial')[0]?.closest('tr') as HTMLElement,
    );
    expect(parent.getByText('Mensal')).toBeInTheDocument();
    expect(
      parent.getByRole('link', { name: 'Ver anexo de Aluguel da sala comercial' }),
    ).toHaveAttribute('href', `/api/admin/finance/expenses/${EXPENSE_IDS.rent}/attachment`);
    expect(screen.getByText('Automática')).toBeInTheDocument();
  });

  it('filters by category and reloads', async () => {
    const calls = await renderTab();

    await userEvent.selectOptions(screen.getByLabelText('Categoria'), 'Aluguel');

    await waitFor(() => {
      expect(calls.lists.at(-1)?.searchParams.get('categoryId')).toBe(EXPENSE_CATEGORY_IDS.rent);
    });
  });

  it('shows the empty message when the period has no expenses', async () => {
    server.use(
      http.get('*/api/admin/finance/expense-categories', () =>
        HttpResponse.json(expenseCategories),
      ),
      http.get('*/api/admin/finance/expenses', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<ExpensesTab today={TODAY} />);
    expect(await screen.findByText('Nenhuma despesa no período.')).toBeInTheDocument();
  });

  it('shows the API error of the list with a retry button', async () => {
    server.use(
      http.get('*/api/admin/finance/expense-categories', () =>
        HttpResponse.json(expenseCategories),
      ),
      http.get('*/api/admin/finance/expenses', () => apiError(403, 'FORBIDDEN', 'Acesso negado.')),
    );
    renderWithProviders(<ExpensesTab today={TODAY} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Acesso negado.');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});

describe('Expense form (GES-11, GES-16)', () => {
  it('shows the core schema messages and sends nothing when the form is empty', async () => {
    const calls = await renderTab();
    const dialog = await openNewForm();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar despesa' }));

    expect(
      await within(dialog).findByText('Escolha a categoria', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Informe a descrição')).toBeInTheDocument();
    expect(within(dialog).getByText('Informe um valor maior que zero')).toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);
  });

  it('offers only active categories for a new expense', async () => {
    await renderTab();
    const dialog = await openNewForm();

    const options = within(within(dialog).getByLabelText('Categoria'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Escolha a categoria', 'Aluguel', 'Energia elétrica', 'Marketing']);
  });

  it('posts the expense in cents, then PUTs the attachment with its media type', async () => {
    const calls = await renderTab();
    const dialog = await openNewForm();
    await fillValid(dialog);
    await userEvent.selectOptions(within(dialog).getByLabelText('Recorrência'), 'Mensal');
    const file = new File(['%PDF-1.4 nota'], 'nota.pdf', { type: 'application/pdf' });
    await userEvent.upload(within(dialog).getByLabelText('Anexo (nota ou comprovante)'), file);
    expect(within(dialog).getByText('Será enviado: nota.pdf')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar despesa' }));

    await waitFor(() => {
      expect(calls.puts).toHaveLength(1);
    });
    expect(calls.posts).toEqual([
      {
        date: '2026-10-26',
        categoryId: EXPENSE_CATEGORY_IDS.energy,
        description: 'Conta de luz de outubro',
        amountCents: 31250,
        recurrence: 'monthly',
      },
    ]);
    // jsdom's File is not undici's, so the test server cannot read the body back: the media type
    // header and the target expense are what this test can observe.
    expect(calls.puts).toHaveLength(1);
    expect(calls.puts[0]).toMatchObject({
      id: 'e9999999-9999-4999-8999-999999999999',
      type: 'application/pdf',
      name: 'nota.pdf',
    });
    expect(await screen.findByText('Despesa criada.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('posts without a PUT when no file was chosen', async () => {
    const calls = await renderTab();
    const dialog = await openNewForm();
    await fillValid(dialog);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar despesa' }));

    expect(await screen.findByText('Despesa criada.')).toBeInTheDocument();
    expect(calls.posts).toHaveLength(1);
    expect(calls.puts).toHaveLength(0);
  });

  it('refuses a file over 5 MB in the form, before any request', async () => {
    const calls = await renderTab();
    const dialog = await openNewForm();
    const big = new File(['x'], 'grande.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });

    await userEvent.upload(within(dialog).getByLabelText('Anexo (nota ou comprovante)'), big);

    expect(await within(dialog).findByText('Arquivo maior que 5 MB')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Será enviado/)).not.toBeInTheDocument();
    expect(calls.puts).toHaveLength(0);
  });

  it('maps a server 422 onto the fields and keeps the form open', async () => {
    await renderTab();
    server.use(
      http.post('*/api/admin/finance/expenses', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos',
              details: [{ path: 'categoryId', message: 'Categoria inativa ou inexistente' }],
            },
          },
          { status: 422 },
        ),
      ),
    );
    const dialog = await openNewForm();
    await fillValid(dialog);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar despesa' }));

    expect(await within(dialog).findByText('Categoria inativa ou inexistente')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Nova despesa' })).toBeInTheDocument();
  });

  it('keeps the saved expense and tells the admin when only the attachment fails', async () => {
    const calls = await renderTab();
    server.use(
      http.put('*/api/admin/finance/expenses/:id/attachment', () =>
        apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Formato não suportado'),
      ),
    );
    const dialog = await openNewForm();
    await fillValid(dialog);
    await userEvent.upload(
      within(dialog).getByLabelText('Anexo (nota ou comprovante)'),
      new File(['x'], 'nota.png', { type: 'image/png' }),
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar despesa' }));

    expect(
      await screen.findByText('Despesa salva, mas o anexo não foi enviado: Formato não suportado'),
    ).toBeInTheDocument();
    expect(calls.posts).toHaveLength(1);
  });

  it('edits an expense with PATCH and shows its current attachment', async () => {
    const calls = await renderTab();

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Editar Aluguel da sala comercial' })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar despesa' });
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Aluguel da sala comercial');
    expect(within(dialog).getByLabelText('Valor')).toHaveValue('4.500,00');
    expect(within(dialog).getByText('Anexo atual: contrato.pdf')).toBeInTheDocument();

    await userEvent.selectOptions(within(dialog).getByLabelText('Recorrência'), 'Não se repete');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar despesa' }));

    await waitFor(() => {
      expect(calls.patches).toHaveLength(1);
    });
    expect(calls.patches[0]).toEqual({
      id: EXPENSE_IDS.rent,
      body: {
        date: '2026-10-05',
        categoryId: EXPENSE_CATEGORY_IDS.rent,
        description: 'Aluguel da sala comercial',
        amountCents: 450000,
        recurrence: 'none',
      },
    });
    expect(await screen.findByText('Despesa salva.')).toBeInTheDocument();
  });

  it('removes the current attachment with DELETE', async () => {
    const calls = await renderTab();
    let removed = '';
    server.use(
      http.delete('*/api/admin/finance/expenses/:id/attachment', ({ params }) => {
        removed = String(params['id']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Editar Aluguel da sala comercial' })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Editar despesa' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover anexo' }));

    await waitFor(() => {
      expect(removed).toBe(EXPENSE_IDS.rent);
    });
    expect(within(dialog).queryByText(/Anexo atual/)).not.toBeInTheDocument();
    expect(calls.deletes).toHaveLength(0);
  });
});

describe('Delete expense', () => {
  it('asks for confirmation, then DELETEs the expense', async () => {
    const calls = await renderTab();

    await userEvent.click(screen.getByRole('button', { name: 'Excluir Conta de luz de setembro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Excluir despesa' });
    expect(dialog).toHaveTextContent('Conta de luz de setembro');
    expect(calls.deletes).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir despesa' }));

    await waitFor(() => {
      expect(calls.deletes).toEqual([EXPENSE_IDS.energy]);
    });
    expect(await screen.findByText('Despesa excluída.')).toBeInTheDocument();
  });

  it('keeps the expense when the admin cancels', async () => {
    const calls = await renderTab();

    await userEvent.click(screen.getByRole('button', { name: 'Excluir Conta de luz de setembro' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(calls.deletes).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
