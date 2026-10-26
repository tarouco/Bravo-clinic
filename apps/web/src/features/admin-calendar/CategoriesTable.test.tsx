import { adminCategoryListSchema } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSlot, resetSlots } from '../../extensions/slots';
import { adminCategory, ID } from '../../test/fixtures/nucleo';
import { parseFixture } from '../../test/fixtures/parse';
import { server } from '../../test/msw/server';
import { plain } from '../../test/session';
import { renderWithProviders } from '../../test/render-with-providers';
import { CategoriesTable } from './CategoriesTable';

const twoHours = {
  ...adminCategory,
  id: ID.catTwoHours,
  name: '2 horas ou mais',
  isReference: false,
  minDurationMinutes: 120,
  weekdayRateCents: 8000,
  weekendRateCents: 9900,
  averageHourlyCents: 8000,
  displayOrder: 2,
};
const block = {
  ...adminCategory,
  id: ID.catHalfShift,
  name: 'Bloco de 20 horas',
  type: 'block',
  isReference: false,
  weekdayRateCents: null,
  weekendRateCents: null,
  minDurationMinutes: null,
  fixedPriceCents: 100000,
  startMinute: 0,
  endMinute: 1200,
  averageHourlyCents: 5000,
  displayOrder: 3,
};
const pkg = {
  ...adminCategory,
  id: ID.catFullShift,
  name: 'Pacote 20h mensal',
  type: 'hour_package',
  isReference: false,
  weekdayRateCents: null,
  weekendRateCents: null,
  minDurationMinutes: null,
  fixedPriceCents: 160000,
  includedMinutes: 1200,
  period: 'monthly',
  averageHourlyCents: 8000,
  editable: false,
  displayOrder: 4,
};
const list = parseFixture(
  adminCategoryListSchema,
  { items: [adminCategory, twoHours, block, pkg] },
  'categoriesTableList',
);

function stubList() {
  server.use(http.get('*/api/admin/categories', () => HttpResponse.json(list)));
}

async function renderTable() {
  stubList();
  renderWithProviders(<CategoriesTable />);
  await screen.findByText('Pacote 20h mensal');
}

afterEach(() => {
  resetSlots();
});

describe('CategoriesTable (NUC-71)', () => {
  it('shows "R$ 1.600,00 → R$ 80,00/h" for a typed price before saving', async () => {
    const patch = vi.fn();
    server.use(
      http.patch('*/api/admin/categories/:id', () => {
        patch();
        return HttpResponse.json(adminCategory);
      }),
    );
    await renderTable();
    const price = screen.getByLabelText('Preço fixo de Bloco de 20 horas');

    await userEvent.clear(price);
    await userEvent.type(price, '1.600,00');

    const row = screen.getByRole('row', { name: /Bloco de 20 horas/ });
    expect(plain(within(row).getByText(/→/).textContent)).toBe('R$ 1.600,00 → R$ 80,00/h');
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends only the changed fields when a row is saved', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch('*/api/admin/categories/:id', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(adminCategory);
      }),
    );
    await renderTable();
    const weekday = screen.getByLabelText('Dia útil de 1 hora');

    await userEvent.clear(weekday);
    await userEvent.type(weekday, '100,00');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar 1 hora' }));

    await waitFor(() => expect(bodies).toEqual([{ weekdayRateCents: 10000 }]));
  });

  it('shows package rows read-only with "Gerenciado em Pacotes"', async () => {
    await renderTable();

    const row = screen.getByRole('row', { name: /Pacote 20h mensal/ });
    expect(within(row).getByText('Gerenciado em Pacotes')).toBeInTheDocument();
    expect(within(row).queryByRole('textbox')).toBeNull();
    expect(within(row).queryByRole('button', { name: /Salvar/ })).toBeNull();
    expect(plain(within(row).getByText(/\/h$/).textContent)).toBe('R$ 80,00/h');
  });

  it('calls the reference endpoint of the category whose V_ref radio is chosen', async () => {
    const called = vi.fn<(id: string) => void>();
    server.use(
      http.post('*/api/admin/categories/:id/reference', ({ params }) => {
        called(String(params['id']));
        return HttpResponse.json(twoHours);
      }),
    );
    await renderTable();

    expect(screen.getByRole('radio', { name: 'Categoria de referência: 1 hora' })).toBeChecked();
    await userEvent.click(
      screen.getByRole('radio', { name: 'Categoria de referência: 2 horas ou mais' }),
    );

    await waitFor(() => expect(called).toHaveBeenCalledWith(ID.catTwoHours));
  });

  it('shows the field errors of a 422 under the price inputs', async () => {
    server.use(
      http.patch('*/api/admin/categories/:id', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos',
              details: [
                { path: 'weekdayRateCents', message: 'O valor da hora precisa ser positivo' },
              ],
              requestId: 'req-test-0001',
            },
          },
          { status: 422 },
        ),
      ),
    );
    await renderTable();
    const weekday = screen.getByLabelText('Dia útil de 1 hora');
    await userEvent.clear(weekday);
    await userEvent.type(weekday, '50,00');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar 1 hora' }));

    expect(await screen.findByText('O valor da hora precisa ser positivo')).toBeInTheDocument();
  });

  it('deactivates a category and reorders by moving it down', async () => {
    const patched: unknown[] = [];
    const reordered: unknown[] = [];
    server.use(
      http.patch('*/api/admin/categories/:id', async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(twoHours);
      }),
      http.post('*/api/admin/categories/reorder', async ({ request }) => {
        reordered.push(await request.json());
        return HttpResponse.json(list);
      }),
    );
    await renderTable();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Ativa: 2 horas ou mais' }));
    await waitFor(() => expect(patched).toEqual([{ status: 'inactive' }]));

    await userEvent.click(screen.getByRole('button', { name: 'Descer 1 hora' }));
    await waitFor(() =>
      expect(reordered).toEqual([
        { ids: [ID.catTwoHours, ID.catHour, ID.catHalfShift, ID.catFullShift] },
      ]),
    );
  });

  it('creates a Hora avulsa from the "Nova categoria" form', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/categories', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(adminCategory, { status: 201 });
      }),
    );
    await renderTable();
    await userEvent.click(screen.getByRole('button', { name: 'Nova categoria' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova categoria' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar categoria' }));
    expect(await within(dialog).findAllByText('Informe um valor, por exemplo 97,00.')).toHaveLength(
      2,
    );
    expect(bodies).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Nome da categoria'), 'Hora premium');
    await userEvent.type(within(dialog).getByLabelText('Valor da hora (dia útil)'), '150,00');
    await userEvent.type(
      within(dialog).getByLabelText('Valor da hora (fim de semana e feriados)'),
      '180,00',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar categoria' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      type: 'hourly',
      name: 'Hora premium',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      appliesOnHolidays: true,
      startMinute: 0,
      endMinute: 1440,
      weekdayRateCents: 15000,
      weekendRateCents: 18000,
      minDurationMinutes: 60,
    });
  });

  it('renders the components registered in the admin.categories.forms slot', async () => {
    registerSlot('admin.categories.forms', () => <p>Formulários de pacotes</p>);
    await renderTable();

    expect(screen.getByText('Formulários de pacotes')).toBeInTheDocument();
  });
});
