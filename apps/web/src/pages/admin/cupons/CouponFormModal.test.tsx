import { couponListSchema } from '@bravo/core';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { RID } from '../../../features/purchases/fixtures';
import { parseFixture } from '../../../test/fixtures/parse';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { CouponFormModal } from './CouponFormModal';

const [bravo10] = parseFixture(
  couponListSchema,
  {
    items: [
      {
        id: RID.coupon,
        code: 'BRAVO10',
        type: 'discount',
        discountKind: 'percent',
        discountValue: 1000,
        appliesTo: 'both',
        maxUses: 10,
        usesCount: 4,
        perCustomerLimit: 1,
        validFrom: '2026-11-01T03:00:00.000Z',
        validUntil: '2026-12-01T03:00:00.000Z',
        enabled: true,
      },
    ],
  },
  'couponFormCoupon',
).items;
if (!bravo10) throw new Error('fixture coupon missing');

function stubCreate(status = 201, body: unknown = bravo10) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post('*/api/admin/coupons', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(body as Record<string, unknown>, { status });
    }),
  );
  return bodies;
}

async function typeInto(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, text);
}

async function submit() {
  await userEvent.click(screen.getByRole('button', { name: 'Salvar cupom' }));
}

describe('CouponFormModal create (REC-129)', () => {
  it('submits a percent of "10" as 1000 basis points with the code upper-cased', async () => {
    const bodies = stubCreate();
    const onClose = vi.fn();
    renderWithProviders(<CouponFormModal coupon={null} onClose={onClose} />);

    await typeInto('Código', 'bravo10');
    await typeInto('Valor do desconto', '10');
    await submit();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(bodies).toEqual([
      {
        code: 'BRAVO10',
        type: 'discount',
        discountKind: 'percent',
        discountValue: 1000,
        appliesTo: 'both',
        maxUses: null,
        perCustomerLimit: null,
        validFrom: null,
        validUntil: null,
        enabled: true,
      },
    ]);
  });

  it('submits "R$ 20,00" of a fixed discount as 2000 cents', async () => {
    const bodies = stubCreate();
    renderWithProviders(<CouponFormModal coupon={null} onClose={vi.fn()} />);

    await typeInto('Código', 'PRIMEIRA20');
    await userEvent.selectOptions(screen.getByLabelText('Forma do desconto'), 'fixed');
    await typeInto('Valor do desconto', 'R$ 20,00');
    await submit();

    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toMatchObject({ discountKind: 'fixed', discountValue: 2000 });
  });

  it('forces "Reservas" for a first-booking coupon and locks the field', async () => {
    const bodies = stubCreate();
    renderWithProviders(<CouponFormModal coupon={null} onClose={vi.fn()} />);

    await typeInto('Código', 'PRIMEIRA');
    await userEvent.selectOptions(screen.getByLabelText('Vale para'), 'packages');
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'first_booking');
    await typeInto('Valor do desconto', '15');

    const appliesTo = screen.getByLabelText('Vale para');
    expect(appliesTo).toBeDisabled();
    expect(appliesTo).toHaveValue('bookings');
    expect(screen.getByText('Cupom de primeira reserva vale só para reservas')).toBeInTheDocument();

    await submit();
    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toMatchObject({ type: 'first_booking', appliesTo: 'bookings' });
  });

  it('sends the limits and the validity as São Paulo midnights, the last day being inclusive', async () => {
    const bodies = stubCreate();
    renderWithProviders(<CouponFormModal coupon={null} onClose={vi.fn()} />);

    await typeInto('Código', 'NOVEMBRO');
    await typeInto('Valor do desconto', '5');
    await userEvent.click(screen.getByLabelText('Limitar o total de usos'));
    await typeInto('Máximo de usos', '10');
    await userEvent.click(screen.getByLabelText('Limitar usos por cliente'));
    await typeInto('Usos por cliente', '1');
    fireEvent.change(screen.getByLabelText('Válido a partir de'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(screen.getByLabelText('Válido até (inclusive)'), {
      target: { value: '2026-11-30' },
    });
    await submit();

    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toMatchObject({
      maxUses: 10,
      perCustomerLimit: 1,
      validFrom: '2026-11-01T03:00:00.000Z',
      validUntil: '2026-12-01T03:00:00.000Z',
    });
  });

  it('shows the code rule and sends nothing for an invalid code', async () => {
    const bodies = stubCreate();
    renderWithProviders(<CouponFormModal coupon={null} onClose={vi.fn()} />);

    await typeInto('Código', 'A!');
    await typeInto('Valor do desconto', '10');
    await submit();

    expect(
      await screen.findByText('Código inválido: use de 3 a 30 letras, números, _ ou -'),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it('refuses an end of validity that is not after the start', async () => {
    const bodies = stubCreate();
    renderWithProviders(<CouponFormModal coupon={null} onClose={vi.fn()} />);

    await typeInto('Código', 'INVERTIDO');
    await typeInto('Valor do desconto', '10');
    fireEvent.change(screen.getByLabelText('Válido a partir de'), {
      target: { value: '2026-11-30' },
    });
    fireEvent.change(screen.getByLabelText('Válido até (inclusive)'), {
      target: { value: '2026-11-01' },
    });
    await submit();

    expect(
      await screen.findByText('O fim da validade precisa ser depois do início'),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it('refuses a percent above 100 and an empty value', async () => {
    renderWithProviders(<CouponFormModal coupon={null} onClose={vi.fn()} />);

    await typeInto('Código', 'DEMAIS');
    await typeInto('Valor do desconto', '150');
    await submit();
    expect(await screen.findByText('O percentual precisa estar entre 1% e 100%')).toBeVisible();

    await userEvent.clear(screen.getByLabelText('Valor do desconto'));
    await submit();
    expect(await screen.findByText('Informe o valor do desconto')).toBeVisible();
  });

  it('shows a server 409 for a duplicate code on the Código field', async () => {
    stubCreate(409, {
      error: { code: 'CONFLICT', message: 'Já existe um cupom com o código BRAVO10' },
    });
    const onClose = vi.fn();
    renderWithProviders(<CouponFormModal coupon={null} onClose={onClose} />);

    await typeInto('Código', 'BRAVO10');
    await typeInto('Valor do desconto', '10');
    await submit();

    const error = await screen.findByText('Já existe um cupom com o código BRAVO10');
    expect(screen.getByLabelText('Código')).toHaveAccessibleDescription(
      expect.stringContaining('Já existe um cupom com o código BRAVO10'),
    );
    expect(error).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maps the details[] of a server 422 to their fields', async () => {
    stubCreate(422, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Dados inválidos',
        details: [{ path: 'discountValue', message: 'Desconto acima do permitido' }],
      },
    });
    renderWithProviders(<CouponFormModal coupon={null} onClose={vi.fn()} />);

    await typeInto('Código', 'ALTO');
    await typeInto('Valor do desconto', '90');
    await submit();

    expect(await screen.findByText('Desconto acima do permitido')).toBeInTheDocument();
    expect(screen.getByLabelText('Valor do desconto')).toBeInvalid();
  });
});

describe('CouponFormModal edit (REC-129)', () => {
  it('prefills the coupon and saves changes with PUT', async () => {
    const puts: { url: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.put('*/api/admin/coupons/:id', async ({ request }) => {
        puts.push({
          url: new URL(request.url).pathname,
          body: (await request.json()) as Record<string, unknown>,
        });
        return HttpResponse.json(bravo10);
      }),
    );
    const onClose = vi.fn();
    renderWithProviders(<CouponFormModal coupon={bravo10} onClose={onClose} />);

    expect(screen.getByLabelText('Código')).toHaveValue('BRAVO10');
    expect(screen.getByLabelText('Valor do desconto')).toHaveValue('10');
    expect(screen.getByLabelText('Máximo de usos')).toHaveValue(10);
    expect(screen.getByLabelText('Válido a partir de')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('Válido até (inclusive)')).toHaveValue('2026-11-30');

    await typeInto('Valor do desconto', '12,5');
    await submit();

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toBe(`/api/admin/coupons/${RID.coupon}`);
    expect(puts[0]?.body).toMatchObject({
      code: 'BRAVO10',
      discountValue: 1250,
      maxUses: 10,
      validFrom: '2026-11-01T03:00:00.000Z',
      validUntil: '2026-12-01T03:00:00.000Z',
    });
  });

  it('refuses a usage limit below the uses already registered', async () => {
    const puts = vi.fn();
    server.use(
      http.put('*/api/admin/coupons/:id', () => {
        puts();
        return HttpResponse.json(bravo10);
      }),
    );
    renderWithProviders(<CouponFormModal coupon={bravo10} onClose={vi.fn()} />);

    await typeInto('Máximo de usos', '3');
    await submit();

    expect(
      await screen.findByText('O limite precisa ser pelo menos 4, os usos já registrados'),
    ).toBeInTheDocument();
    expect(puts).not.toHaveBeenCalled();
  });
});
