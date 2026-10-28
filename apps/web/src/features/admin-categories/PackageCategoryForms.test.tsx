import { adminCategorySchema, type AdminCategory } from '@bravo/core';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerRevenueSlots } from '../../extensions/receita';
import { preloadLazySlots, resetSlots } from '../../extensions/slots';
import { adminCategory, ID } from '../../test/fixtures/nucleo';
import { parseFixture } from '../../test/fixtures/parse';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { plain } from '../../test/session';
import { CategoriesTable } from '../admin-calendar/CategoriesTable';
import { PackageCategoryForms } from './PackageCategoryForms';

// Slot bodies load lazily (GES-143): load them once up front, so a busy machine spends the
// module loading time here rather than inside a test's wait.
beforeAll(async () => {
  await preloadLazySlots();
}, 120_000);

afterEach(() => {
  resetSlots();
});

const allDays = [1, 2, 3, 4, 5, 6, 7];

// Pacote 20h mensal: R$ 1.600,00 for 1.200 min = R$ 80,00/h. Meio turno: Seg–Sex 07:00–09:30 at
// R$ 280,00 per occurrence = R$ 112,00/h, 20–22 occurrences in 30 days.
const pacote = parseFixture(
  adminCategorySchema,
  {
    ...adminCategory,
    id: ID.catFullShift,
    name: 'Pacote 20h mensal',
    type: 'hour_package',
    weekdays: allDays,
    weekdayRateCents: null,
    weekendRateCents: null,
    minDurationMinutes: null,
    fixedPriceCents: 160000,
    includedMinutes: 1200,
    period: 'monthly',
    isReference: false,
    averageHourlyCents: 8000,
    editable: false,
    displayOrder: 5,
  },
  'packageFormsPacote',
);
const meioTurno = parseFixture(
  adminCategorySchema,
  {
    ...adminCategory,
    id: ID.catHalfShift,
    name: 'Meio turno mensal',
    type: 'fixed_schedule',
    weekdays: [1, 2, 3, 4, 5],
    appliesOnHolidays: false,
    startMinute: 420,
    endMinute: 570,
    weekdayRateCents: null,
    weekendRateCents: null,
    minDurationMinutes: null,
    pricePerOccurrenceCents: 28000,
    period: 'monthly',
    isReference: false,
    averageHourlyCents: 11200,
    editable: false,
    displayOrder: 6,
  },
  'packageFormsMeioTurno',
);

const LOCKED_MESSAGE =
  'Categoria com assinaturas ativas: crie uma nova categoria para mudar dias, horário ou período';

function renderForms(categories: AdminCategory[] = [pacote, meioTurno]) {
  server.use(
    http.get('*/api/admin/calendar/config', () =>
      HttpResponse.json({
        businessHours: [],
        settings: {
          slotMinutes: 30,
          defaultBookingMinutes: 60,
          cleanupMinutes: 30,
          minAdvanceMinutes: 0,
          maxAdvanceDays: 90,
        },
        warnings: [],
        onboarding: { pricesReviewed: true },
      }),
    ),
  );
  return renderWithProviders(<PackageCategoryForms categories={categories} />);
}

async function fill(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, text);
}

async function fillTime(label: string, text: string) {
  await fill(label, text);
  await userEvent.tab();
}

async function checkDays(...names: string[]) {
  for (const name of names) await userEvent.click(screen.getByLabelText(name));
}

describe('PackageCategoryForms list (REC-03, REC-04)', () => {
  it('shows each package with its average hour value', () => {
    renderForms();

    const rows = within(screen.getByRole('list', { name: 'Pacotes cadastrados' })).getAllByRole(
      'listitem',
    );
    expect(plain(rows[0]?.textContent)).toContain('Pacote 20h mensal');
    expect(plain(rows[0]?.textContent)).toContain('R$ 1.600,00');
    expect(plain(rows[0]?.textContent)).toContain('→ R$ 80,00/h');
    expect(plain(rows[1]?.textContent)).toContain('Seg–Sex 07:00–09:30');
    expect(plain(rows[1]?.textContent)).toContain('R$ 280,00 por ocorrência');
    expect(plain(rows[1]?.textContent)).toContain('→ R$ 112,00/h');
  });

  it('shows the fixed schedule period estimate "20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00"', () => {
    renderForms();

    expect(
      screen.getByText((content) =>
        plain(content).includes('20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00'),
      ),
    ).toBeInTheDocument();
  });

  it('ignores hourly and block categories', () => {
    renderForms([adminCategory]);

    expect(screen.getByText('Nenhum pacote cadastrado.')).toBeInTheDocument();
    expect(screen.queryByText('1 hora')).not.toBeInTheDocument();
  });

  it('is what the admin.categories.forms slot renders under the categories table', async () => {
    registerRevenueSlots();
    server.use(
      http.get('*/api/admin/categories', () =>
        HttpResponse.json({ items: [adminCategory, pacote] }),
      ),
    );
    renderWithProviders(<CategoriesTable />);

    expect(await screen.findByRole('button', { name: 'Novo pacote de horas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo horário fixo' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Pacotes cadastrados' });
    expect(within(list).getByText('Pacote 20h mensal')).toBeInTheDocument();
  });
});

describe('Hour package form (REC-01, REC-03)', () => {
  it('shows "R$ 80,00/h" while typing R$ 1.600,00 and 20 hours', async () => {
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Novo pacote de horas' }));

    await fill('Preço do pacote', '1.600,00');
    await fill('Horas incluídas', '20');

    expect(plain(screen.getByText(/Valor médio da hora/).textContent)).toContain('R$ 80,00/h');
  });

  it('creates the category with whole hours, the period, status and visibility', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/categories', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(pacote, { status: 201 });
      }),
    );
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Novo pacote de horas' }));

    await fill('Nome', 'Pacote 25h mensal');
    await fill('Preço do pacote', '1.875,00');
    await fill('Horas incluídas', '25');
    await userEvent.selectOptions(screen.getByLabelText('Visibilidade'), 'admin_only');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar categoria' }));

    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toEqual({
      type: 'hour_package',
      name: 'Pacote 25h mensal',
      fixedPriceCents: 187500,
      includedHours: 25,
      period: 'monthly',
      status: 'active',
      visibility: 'admin_only',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses hours outside 1..200, a missing name and a missing price without calling the API', async () => {
    const post = vi.fn();
    server.use(
      http.post('*/api/admin/categories', () => {
        post();
        return HttpResponse.json(pacote, { status: 201 });
      }),
    );
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Novo pacote de horas' }));

    await fill('Horas incluídas', '201');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar categoria' }));

    expect(await screen.findByText('Inclua de 1 a 200 horas')).toBeInTheDocument();
    expect(screen.getByText('Informe o nome da categoria')).toBeInTheDocument();
    expect(screen.getByText('Informe um valor, por exemplo 1.600,00.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('Fixed schedule form (REC-02, REC-04)', () => {
  async function openFixed() {
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Novo horário fixo' }));
    await checkDays('Seg', 'Ter', 'Qua', 'Qui', 'Sex');
    await fillTime('Início', '07:00');
    await fillTime('Fim', '09:30');
    await fill('Preço por ocorrência', '280,00');
  }

  it('shows "R$ 112,00/h" and the estimate for Mon–Fri 07:00–09:30 at R$ 280,00', async () => {
    await openFixed();

    const preview = screen.getByText(/Valor médio da hora/).parentElement as HTMLElement;
    expect(plain(preview.textContent)).toContain('R$ 112,00/h');
    expect(plain(preview.textContent)).toContain('20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00');
  });

  it('updates the estimate when the period changes', async () => {
    await openFixed();

    await userEvent.selectOptions(screen.getByLabelText('Período'), 'bimonthly');

    const preview = screen.getByText(/Valor médio da hora/).parentElement as HTMLElement;
    expect(plain(preview.textContent)).toContain('42–44 ocorrências');
  });

  it('creates the fixed schedule with weekdays, window and price per occurrence', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/categories', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(meioTurno, { status: 201 });
      }),
    );
    await openFixed();
    await fill('Nome', 'Meio turno mensal');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar categoria' }));

    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toEqual({
      type: 'fixed_schedule',
      name: 'Meio turno mensal',
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 420,
      endMinute: 570,
      pricePerOccurrenceCents: 28000,
      period: 'monthly',
      status: 'active',
      visibility: 'public',
    });
  });

  it('refuses no weekday, a window off the slot grid and one shorter than the default booking', async () => {
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Novo horário fixo' }));
    await fill('Nome', 'Curto');
    await fill('Preço por ocorrência', '100,00');
    await fillTime('Início', '07:10');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar categoria' }));

    expect(await screen.findByText('Escolha pelo menos um dia da semana')).toBeInTheDocument();
    expect(screen.getByText('Use horários da grade de 30 minutos')).toBeInTheDocument();

    await fillTime('Início', '08:00');
    await fillTime('Fim', '08:30');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar categoria' }));
    expect(
      await screen.findByText('O horário precisa ter pelo menos 60 minutos'),
    ).toBeInTheDocument();
  });
});

describe('Editing a package category (REC-05)', () => {
  it('sends only the changed fields', async () => {
    const patches: { url: string; body: unknown }[] = [];
    server.use(
      http.patch('*/api/admin/categories/:id', async ({ request }) => {
        patches.push({ url: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json(pacote);
      }),
    );
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Editar Pacote 20h mensal' }));

    expect(screen.getByLabelText('Preço do pacote')).toHaveValue('1.600,00');
    expect(screen.getByLabelText('Horas incluídas')).toHaveValue(20);
    await fill('Preço do pacote', '1.700,00');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar categoria' }));

    await vi.waitFor(() => {
      expect(patches).toHaveLength(1);
    });
    expect(patches[0]).toEqual({
      url: `/api/admin/categories/${ID.catFullShift}`,
      body: { fixedPriceCents: 170000 },
    });
  });

  it('keeps "Salvar categoria" disabled while nothing changed', async () => {
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Editar Meio turno mensal' }));

    expect(screen.getByRole('button', { name: 'Salvar categoria' })).toBeDisabled();
  });

  it('shows the locked-field message of a 409 above the form', async () => {
    server.use(
      http.patch('*/api/admin/categories/:id', () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: LOCKED_MESSAGE } },
          { status: 409 },
        ),
      ),
    );
    renderForms();
    await userEvent.click(screen.getByRole('button', { name: 'Editar Meio turno mensal' }));

    await userEvent.click(screen.getByLabelText('Sáb'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar categoria' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(LOCKED_MESSAGE);
    expect(screen.getByRole('dialog')).toContainElement(alert);
  });
});
