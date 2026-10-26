import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { CategoriesDrawer } from './CategoriesDrawer';
import { EXPENSE_CATEGORY_IDS, expenseCategories } from './fixtures';

interface Calls {
  patches: { id: string; body: unknown }[];
  posts: unknown[];
}

function stubApi(): Calls {
  const calls: Calls = { patches: [], posts: [] };
  server.use(
    http.get('*/api/admin/finance/expense-categories', () => HttpResponse.json(expenseCategories)),
    http.patch('*/api/admin/finance/expense-categories/:id', async ({ request, params }) => {
      calls.patches.push({ id: String(params['id']), body: await request.json() });
      return HttpResponse.json(expenseCategories.items[0]);
    }),
    http.post('*/api/admin/finance/expense-categories', async ({ request }) => {
      calls.posts.push(await request.json());
      return HttpResponse.json(expenseCategories.items[0], { status: 201 });
    }),
  );
  return calls;
}

async function renderDrawer() {
  const calls = stubApi();
  renderWithProviders(<CategoriesDrawer open onClose={() => undefined} />);
  await screen.findByText('Energia elétrica');
  return calls;
}

describe('CategoriesDrawer (GES-19)', () => {
  it('lists the categories in display order and marks the inactive one', async () => {
    await renderDrawer();

    const items = within(screen.getByRole('list', { name: 'Categorias de despesa' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent?.slice(0, 20))).toEqual([
      expect.stringContaining('1.Aluguel'),
      expect.stringContaining('2.Energia'),
      expect.stringContaining('3.Marketing'),
      expect.stringContaining('4.InternetInativa'),
    ]);
    expect(
      within(items[3] as HTMLElement).getByRole('button', { name: 'Ativar Internet' }),
    ).toBeInTheDocument();
  });

  it('renames a category with PATCH { name } after validating it', async () => {
    const calls = await renderDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Renomear Marketing' }));
    const input = screen.getByLabelText('Novo nome de Marketing');
    await userEvent.clear(input);
    await userEvent.type(input, 'M');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));
    expect(await screen.findByText(/Informe o nome da categoria/)).toBeInTheDocument();
    expect(calls.patches).toHaveLength(0);

    await userEvent.clear(input);
    await userEvent.type(input, 'Marketing digital');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));

    await waitFor(() => {
      expect(calls.patches).toEqual([
        { id: EXPENSE_CATEGORY_IDS.marketing, body: { name: 'Marketing digital' } },
      ]);
    });
  });

  it('shows the API message when the new name duplicates another (409)', async () => {
    await renderDrawer();
    server.use(
      http.patch('*/api/admin/finance/expense-categories/:id', () =>
        apiError(409, 'CONFLICT', 'Já existe uma categoria com este nome'),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Renomear Marketing' }));
    const input = screen.getByLabelText('Novo nome de Marketing');
    await userEvent.clear(input);
    await userEvent.type(input, 'Aluguel');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nome' }));

    expect(await screen.findByText('Já existe uma categoria com este nome')).toBeInTheDocument();
  });

  it('moves a category up by swapping display orders with its neighbour', async () => {
    const calls = await renderDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Subir Energia elétrica' }));

    await waitFor(() => {
      expect(calls.patches).toHaveLength(2);
    });
    expect(calls.patches).toEqual([
      { id: EXPENSE_CATEGORY_IDS.energy, body: { displayOrder: 1 } },
      { id: EXPENSE_CATEGORY_IDS.rent, body: { displayOrder: 2 } },
    ]);
  });

  it('moves a category down and disables the ends of the list', async () => {
    const calls = await renderDrawer();

    expect(screen.getByRole('button', { name: 'Subir Aluguel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descer Internet' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Descer Aluguel' }));

    await waitFor(() => {
      expect(calls.patches).toHaveLength(2);
    });
    expect(calls.patches[0]).toEqual({ id: EXPENSE_CATEGORY_IDS.rent, body: { displayOrder: 2 } });
    expect(calls.patches[1]).toEqual({
      id: EXPENSE_CATEGORY_IDS.energy,
      body: { displayOrder: 1 },
    });
  });

  it('deactivates an active category and reactivates an inactive one', async () => {
    const calls = await renderDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Desativar Marketing' }));
    await waitFor(() => {
      expect(calls.patches).toHaveLength(1);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Ativar Internet' }));

    await waitFor(() => {
      expect(calls.patches).toHaveLength(2);
    });
    expect(calls.patches[0]).toEqual({
      id: EXPENSE_CATEGORY_IDS.marketing,
      body: { active: false },
    });
    expect(calls.patches[1]?.body).toEqual({ active: true });
  });

  it('adds a category with POST and validates the name first', async () => {
    const calls = await renderDrawer();

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar categoria' }));
    expect(await screen.findByText(/Informe o nome da categoria/)).toBeInTheDocument();
    expect(calls.posts).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Nova categoria'), 'Contabilidade');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar categoria' }));

    await waitFor(() => {
      expect(calls.posts).toEqual([{ name: 'Contabilidade' }]);
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Nova categoria')).toHaveValue('');
    });
  });
});
