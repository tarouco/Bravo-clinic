import { adminCategorySchema, subscriptionQuoteSchema } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRevenueSlots } from '../../extensions/receita';
import { resetSlots } from '../../extensions/slots';
import { adminCategory, ID } from '../../test/fixtures/nucleo';
import { parseFixture } from '../../test/fixtures/parse';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { plain, stubStaffSession, type StaffRole } from '../../test/session';
import { Slot } from '../../extensions/slots';
import {
  occurrenceCheckFull,
  RID,
  subscriptionPurchaseResult,
  subscriptionQuote,
} from '../purchases/fixtures';
import { SellSubscriptionDialog } from './SellSubscriptionDialog';

// Tuesday 27/10/2026, the day the admin sells at the counter.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  resetSlots();
});

const packageBase = {
  ...adminCategory,
  weekdayRateCents: null,
  weekendRateCents: null,
  minDurationMinutes: null,
  isReference: false,
  editable: false,
};
const categories = parseFixture(
  adminCategorySchema.array(),
  [
    adminCategory,
    {
      ...packageBase,
      id: RID.pacote,
      name: 'Pacote 20h',
      type: 'hour_package',
      fixedPriceCents: 160000,
      includedMinutes: 1200,
      period: 'monthly',
      averageHourlyCents: 8000,
    },
    {
      ...packageBase,
      id: RID.meioTurno,
      name: 'Meio turno',
      type: 'fixed_schedule',
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 420,
      endMinute: 570,
      pricePerOccurrenceCents: 28000,
      period: 'monthly',
      averageHourlyCents: 11200,
    },
    {
      ...packageBase,
      id: RID.pacote30h,
      name: 'Turno mensal',
      type: 'fixed_schedule',
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 480,
      endMinute: 720,
      pricePerOccurrenceCents: 40000,
      period: 'monthly',
      visibility: 'admin_only',
      averageHourlyCents: 10000,
    },
  ],
  'sellCategories',
);

const conflictQuote = parseFixture(
  subscriptionQuoteSchema,
  {
    ...subscriptionQuote,
    priceCents: 616000,
    payNowCents: 616000,
    occurrenceCount: 22,
    conflicts: [{ date: '2026-11-04', reason: 'overlaps_booking', label: 'Já reservado' }],
  },
  'sellConflictQuote',
);

interface Calls {
  quotes: Record<string, unknown>[];
  sales: { body: Record<string, unknown>; key: string | null }[];
}

function stubApis(options: { quote?: unknown; sale?: { status: number; body: unknown } } = {}) {
  const calls: Calls = { quotes: [], sales: [] };
  server.use(
    http.get('*/api/admin/categories', () => HttpResponse.json({ items: categories })),
    http.post('*/api/admin/subscriptions/quote', async ({ request }) => {
      calls.quotes.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json((options.quote ?? subscriptionQuote) as Record<string, unknown>);
    }),
    http.post('*/api/admin/subscriptions', async ({ request }) => {
      calls.sales.push({
        body: (await request.json()) as Record<string, unknown>,
        key: request.headers.get('Idempotency-Key'),
      });
      const sale = options.sale ?? { status: 201, body: subscriptionPurchaseResult };
      return HttpResponse.json(sale.body as Record<string, unknown>, { status: sale.status });
    }),
    http.get('*/api/public/packages/:categoryId/occurrences', () =>
      HttpResponse.json(occurrenceCheckFull),
    ),
  );
  return calls;
}

function renderDialog(role: StaffRole = 'admin', onClose = vi.fn()) {
  stubStaffSession(role);
  renderWithProviders(<SellSubscriptionDialog open onClose={onClose} />);
  return onClose;
}

const dialog = () => screen.getByRole('dialog', { name: 'Vender assinatura' });

async function pickCustomer() {
  await userEvent.type(within(dialog()).getByLabelText('Buscar cliente'), 'camila');
  await userEvent.click(await within(dialog()).findByRole('button', { name: /Camila Souza/ }));
}

async function pickCategory(name: string) {
  const select = within(dialog()).getByLabelText('Categoria');
  await within(dialog()).findByRole('option', { name: new RegExp(name) });
  await userEvent.selectOptions(
    select,
    within(dialog()).getByRole('option', { name: new RegExp(name) }),
  );
}

const submit = () => within(dialog()).getByRole('button', { name: 'Vender assinatura' });

describe('SellSubscriptionDialog link payment (REC-150)', () => {
  it('sends { payment: { mode: "link", holdHours: 24 } } with an Idempotency-Key and confirms with a toast', async () => {
    const calls = stubApis();
    const onClose = renderDialog();
    await pickCustomer();
    await pickCategory('Pacote 20h');

    expect(await within(dialog()).findByText('Total a pagar')).toBeInTheDocument();
    await userEvent.click(submit());

    await waitFor(() => {
      expect(calls.sales).toHaveLength(1);
    });
    expect(calls.sales[0]?.body).toEqual({
      userId: ID.user,
      categoryId: RID.pacote,
      baseOn: '2026-10-27',
      payment: { mode: 'link', holdHours: 24 },
    });
    expect(calls.sales[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Assinatura criada. Link enviado ao cliente.')).toBeVisible();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the quote summary: period, price, discount and what is due', async () => {
    stubApis({ quote: { ...subscriptionQuote, discountCents: 16000, payNowCents: 144000 } });
    renderDialog();
    await pickCustomer();
    await pickCategory('Pacote 20h');

    const summary = await within(dialog()).findByText('Total a pagar');
    const rows = plain((summary.closest('dl') as HTMLElement).textContent);
    expect(rows).toContain('02/11/2026 a 01/12/2026');
    expect(rows).toContain('R$ 1.600,00');
    expect(rows).toContain('− R$ 160,00');
    expect(rows).toContain('R$ 1.440,00');
  });

  it('lists admin-only categories with their label', async () => {
    stubApis();
    renderDialog();

    expect(
      await within(dialog()).findByRole('option', { name: 'Turno mensal (somente admin)' }),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByRole('option', { name: '1 hora' })).toBeNull();
  });
});

describe('SellSubscriptionDialog manual payment (REC-150)', () => {
  it('requires a justification of 5 or more characters', async () => {
    const calls = stubApis();
    renderDialog();
    await pickCustomer();
    await pickCategory('Pacote 20h');
    await userEvent.selectOptions(
      within(dialog()).getByLabelText('Forma de pagamento'),
      'Confirmar manualmente (já recebido)',
    );
    await within(dialog()).findByText('Total a pagar');

    await userEvent.type(within(dialog()).getByLabelText('Justificativa'), 'abc');
    await userEvent.click(submit());

    expect(
      await within(dialog()).findByText('A justificativa precisa ter pelo menos 5 caracteres'),
    ).toBeInTheDocument();
    expect(calls.sales).toHaveLength(0);

    await userEvent.type(within(dialog()).getByLabelText('Justificativa'), 'de balcão');
    await userEvent.click(submit());

    await waitFor(() => {
      expect(calls.sales).toHaveLength(1);
    });
    expect(calls.sales[0]?.body).toMatchObject({
      payment: { mode: 'manual', justification: 'abcde balcão' },
    });
    expect(await screen.findByText('Assinatura criada.')).toBeVisible();
  });

  it('refuses a link validity outside 1..720 hours', async () => {
    const calls = stubApis();
    renderDialog();
    await pickCustomer();
    await pickCategory('Pacote 20h');
    await within(dialog()).findByText('Total a pagar');

    await userEvent.clear(within(dialog()).getByLabelText('Validade do link (horas)'));
    await userEvent.type(within(dialog()).getByLabelText('Validade do link (horas)'), '721');
    await userEvent.click(submit());

    expect(
      await within(dialog()).findByText('O prazo do link vai de 1 a 720 horas'),
    ).toBeInTheDocument();
    expect(calls.sales).toHaveLength(0);
  });
});

describe('SellSubscriptionDialog fixed schedule (REC-150)', () => {
  async function pickRoomAndDate() {
    await userEvent.click(await within(dialog()).findByRole('radio', { name: 'Sala Principal' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Próximo mês' }));
    await userEvent.click(
      within(dialog()).getByRole('button', { name: '2 de novembro, disponível' }),
    );
  }

  it('shows the room and start-date picker, asks for a quote only when both are chosen, and sends the room', async () => {
    const calls = stubApis({
      quote: { ...subscriptionQuote, occurrenceCount: 22, priceCents: 616000, payNowCents: 616000 },
    });
    renderDialog();
    await pickCustomer();
    await pickCategory('Meio turno');

    expect(
      within(dialog()).getByText('Escolha a sala e a data de início para ver os seus horários.'),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByRole('button', { name: 'Continuar' })).toBeNull();
    expect(calls.quotes).toHaveLength(0);

    await pickRoomAndDate();
    await within(dialog()).findByText('Total a pagar');
    await userEvent.click(submit());

    await waitFor(() => {
      expect(calls.sales).toHaveLength(1);
    });
    expect(calls.sales[0]?.body).toEqual({
      userId: ID.user,
      categoryId: RID.meioTurno,
      baseOn: '2026-11-02',
      roomId: ID.principal,
      payment: { mode: 'link', holdHours: 24 },
    });
    expect(calls.quotes[0]).toMatchObject({ roomId: ID.principal, baseOn: '2026-11-02' });
  });

  it('lists the conflicting dates of the quote and disables the sale', async () => {
    const calls = stubApis({ quote: conflictQuote });
    renderDialog();
    await pickCustomer();
    await pickCategory('Meio turno');
    await pickRoomAndDate();

    expect(await within(dialog()).findByText('Qua 04/11/2026: Já reservado')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    expect(calls.sales).toHaveLength(0);
  });

  it('shows the dates that were taken meanwhile when the API answers 409 OCCURRENCE_CONFLICT', async () => {
    stubApis({
      sale: {
        status: 409,
        body: {
          error: {
            code: 'OCCURRENCE_CONFLICT',
            message: 'Alguns horários não estão mais disponíveis',
            details: [{ path: 'date', message: 'Já reservado', date: '2026-11-04' }],
          },
        },
      },
    });
    renderDialog();
    await pickCustomer();
    await pickCategory('Meio turno');
    await pickRoomAndDate();
    await within(dialog()).findByText('Total a pagar');

    await userEvent.click(submit());

    expect(await within(dialog()).findByText('Qua 04/11/2026: Já reservado')).toBeInTheDocument();
  });
});

describe('SellSubscriptionDialog coupon (REC-150)', () => {
  it('quotes with the coupon code of the customer and shows why it was refused', async () => {
    const calls = stubApis({
      quote: {
        ...subscriptionQuote,
        couponRejection: { reason: 'exhausted', message: 'Cupom esgotado' },
      },
    });
    renderDialog();
    await pickCustomer();
    await pickCategory('Pacote 20h');
    await within(dialog()).findByText('Total a pagar');

    await userEvent.type(within(dialog()).getByLabelText('Cupom de desconto'), 'bravo10');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Aplicar' }));

    await waitFor(() => {
      expect(calls.quotes.at(-1)).toMatchObject({ couponCode: 'BRAVO10', userId: ID.user });
    });
    expect(await within(dialog()).findByText('Cupom esgotado')).toBeInTheDocument();
  });

  it('shows a 422 COUPON_INVALID of the sale on the coupon field', async () => {
    stubApis({
      sale: {
        status: 422,
        body: {
          error: {
            code: 'COUPON_INVALID',
            message: 'Cupom inválido',
            details: [{ path: 'couponCode', message: 'Cupom vencido', reason: 'expired' }],
          },
        },
      },
    });
    renderDialog();
    await pickCustomer();
    await pickCategory('Pacote 20h');
    await within(dialog()).findByText('Total a pagar');

    await userEvent.click(submit());

    expect(await within(dialog()).findByText('Cupom vencido')).toBeInTheDocument();
  });
});

describe('SellSubscriptionDialog retries', () => {
  it('reuses the Idempotency-Key when the same sale is sent again after a failure', async () => {
    const calls = stubApis({
      sale: { status: 500, body: { error: { code: 'INTERNAL', message: 'Falha temporária' } } },
    });
    renderDialog();
    await pickCustomer();
    await pickCategory('Pacote 20h');
    await within(dialog()).findByText('Total a pagar');

    await userEvent.click(submit());
    expect(await within(dialog()).findByText('Falha temporária')).toBeInTheDocument();
    await userEvent.click(submit());

    await waitFor(() => {
      expect(calls.sales).toHaveLength(2);
    });
    expect(calls.sales[1]?.key).toBe(calls.sales[0]?.key);
  });

  it('keeps the sale disabled until a customer and a category are chosen', async () => {
    stubApis();
    renderDialog();

    expect(await within(dialog()).findByRole('option', { name: 'Pacote 20h' })).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });
});

describe('SellSubscriptionAction slot (REC-153)', () => {
  function renderHeader(role: StaffRole) {
    registerRevenueSlots();
    stubStaffSession(role);
    stubApis();
    return renderWithProviders(
      <div>
        <Slot name="admin.reservations.headerActions" />
      </div>,
    );
  }

  it('shows "Vender assinatura" to the admin and opens the dialog', async () => {
    renderHeader('admin');

    await userEvent.click(await screen.findByRole('button', { name: 'Vender assinatura' }));

    expect(await screen.findByRole('dialog', { name: 'Vender assinatura' })).toBeInTheDocument();
  });

  it('hides it from reception once the session is known', async () => {
    let sessionServed = 0;
    registerRevenueSlots();
    stubApis();
    server.use(
      http.get('*/api/app/me', () => {
        sessionServed += 1;
        return HttpResponse.json({
          id: ID.user,
          name: 'Rui Lima',
          email: 'staff@example.com',
          role: 'reception',
          emailVerified: true,
          docType: 'cpf',
          mfa: { enrolled: true, verified: true },
        });
      }),
    );
    renderWithProviders(
      <div>
        <Slot name="admin.reservations.headerActions" />
      </div>,
    );

    await waitFor(() => {
      expect(sessionServed).toBeGreaterThan(0);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Vender assinatura' })).toBeNull();
  });
});
