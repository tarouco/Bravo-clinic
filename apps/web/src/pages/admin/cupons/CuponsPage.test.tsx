import { couponListSchema, couponUseListSchema } from '@bravo/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { RID } from '../../../features/purchases/fixtures';
import { parseFixture } from '../../../test/fixtures/parse';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { CuponsPage } from './CuponsPage';

// Rows of the REC-128 examples: an unlimited percent coupon without validity, and a first-booking
// coupon of R$ 20,00 limited to 10 uses valid from 01/11/2026 to 30/11/2026 (inclusive).
const coupons = parseFixture(
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
        maxUses: null,
        usesCount: 3,
        perCustomerLimit: null,
        enabled: true,
      },
      {
        id: RID.couponFixed,
        code: 'PRIMEIRA20',
        type: 'first_booking',
        discountKind: 'fixed',
        discountValue: 2000,
        appliesTo: 'bookings',
        maxUses: 10,
        usesCount: 1,
        perCustomerLimit: 1,
        validFrom: '2026-11-01T03:00:00.000Z',
        validUntil: '2026-12-01T03:00:00.000Z',
        enabled: false,
      },
    ],
  },
  'cuponsPageList',
);

const uses = parseFixture(
  couponUseListSchema,
  {
    items: [
      {
        id: RID.couponUse,
        at: '2026-10-25T15:00:00.000Z',
        customerName: 'Ana Souza',
        bookingCode: 'BRV-7K2Q9X',
        discountCents: 2190,
        status: 'reserved',
      },
      {
        id: 'dddddddd-dddd-4ddd-8ddd-444444444444',
        at: '2026-10-26T15:00:00.000Z',
        customerName: 'Bruno Lima',
        subscriptionCategory: 'Pacote 20h',
        discountCents: 16000,
        status: 'consumed',
      },
      {
        id: 'dddddddd-dddd-4ddd-8ddd-555555555555',
        at: '2026-10-27T15:00:00.000Z',
        customerName: 'Carla Dias',
        bookingCode: 'BRV-2M4P8Z',
        discountCents: 2000,
        status: 'released',
      },
    ],
  },
  'cuponsPageUses',
);

function stubList() {
  server.use(http.get('*/api/admin/coupons', () => HttpResponse.json(coupons)));
}

async function renderPage() {
  stubList();
  renderWithProviders(<CuponsPage />);
  await screen.findByText('BRAVO10');
}

const rowOf = (code: string) => screen.getByText(code).closest('tr') as HTMLElement;

describe('CuponsPage list (REC-128)', () => {
  it('shows an unlimited percent coupon as "Desconto", "10%", "3/∞" and no validity', async () => {
    await renderPage();

    const cells = within(rowOf('BRAVO10')).getAllByRole('cell');
    expect(cells.map((c) => plain(c.textContent))).toEqual([
      'BRAVO10',
      'Desconto',
      '10%',
      '3/∞',
      '—',
      '',
      expect.stringContaining('Editar'),
    ]);
  });

  it('shows a first-booking fixed coupon as "Primeira reserva", "R$ 20,00", "1/10" and its validity range', async () => {
    await renderPage();

    const cells = within(rowOf('PRIMEIRA20')).getAllByRole('cell');
    expect(plain(cells[1]?.textContent)).toBe('Primeira reserva');
    expect(plain(cells[2]?.textContent)).toBe('R$ 20,00');
    expect(plain(cells[3]?.textContent)).toBe('1/10');
    expect(plain(cells[4]?.textContent)).toBe('01/11/2026–30/11/2026');
  });

  it('renders the enabled switch of each coupon from the API value', async () => {
    await renderPage();

    expect(screen.getByRole('switch', { name: 'Cupom BRAVO10 ativo' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Cupom PRIMEIRA20 ativo' })).not.toBeChecked();
  });

  it('offers "Novo cupom" and an empty message when there are no coupons', async () => {
    server.use(http.get('*/api/admin/coupons', () => HttpResponse.json({ items: [] })));
    renderWithProviders(<CuponsPage />);

    expect(await screen.findByText('Nenhum cupom cadastrado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo cupom' })).toBeInTheDocument();
  });

  it('opens the form from "Novo cupom" and from "Editar" of a row', async () => {
    await renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Novo cupom' }));
    expect(await screen.findByRole('dialog', { name: 'Novo cupom' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Editar PRIMEIRA20' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar cupom PRIMEIRA20' });
    expect(within(dialog).getByLabelText('Código')).toHaveValue('PRIMEIRA20');
  });

  it('shows the API message when the list cannot be loaded', async () => {
    server.use(
      http.get('*/api/admin/coupons', () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Sem permissão para ver cupons.' } },
          { status: 403 },
        ),
      ),
    );
    renderWithProviders(<CuponsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão para ver cupons.');
  });
});

describe('CuponsPage enabled switch (REC-130)', () => {
  it('calls PATCH …/enabled with the new value and keeps the switch flipped', async () => {
    await renderPage();
    const patches: { url: string; body: unknown }[] = [];
    server.use(
      http.patch('*/api/admin/coupons/:id/enabled', async ({ request }) => {
        patches.push({ url: new URL(request.url).pathname, body: await request.json() });
        return HttpResponse.json({ ...coupons.items[0], enabled: false });
      }),
    );

    await userEvent.click(screen.getByRole('switch', { name: 'Cupom BRAVO10 ativo' }));

    await waitFor(() => {
      expect(patches).toEqual([
        { url: `/api/admin/coupons/${RID.coupon}/enabled`, body: { enabled: false } },
      ]);
    });
    expect(screen.getByRole('switch', { name: 'Cupom BRAVO10 ativo' })).not.toBeChecked();
  });

  it('flips at once, before the API answers', async () => {
    await renderPage();
    server.use(
      http.patch('*/api/admin/coupons/:id/enabled', async () => {
        await delay(300);
        return HttpResponse.json({ ...coupons.items[1], enabled: true });
      }),
    );

    await userEvent.click(screen.getByRole('switch', { name: 'Cupom PRIMEIRA20 ativo' }));

    expect(screen.getByRole('switch', { name: 'Cupom PRIMEIRA20 ativo' })).toBeChecked();
  });

  it('reverts the switch and shows a toast when the API refuses', async () => {
    await renderPage();
    server.use(
      http.patch('*/api/admin/coupons/:id/enabled', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'Não foi possível salvar o cupom.' } },
          { status: 500 },
        ),
      ),
    );

    await userEvent.click(screen.getByRole('switch', { name: 'Cupom BRAVO10 ativo' }));

    expect(await screen.findByText('Não foi possível salvar o cupom.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Cupom BRAVO10 ativo' })).toBeChecked();
    });
  });
});

describe('CuponsPage uses drawer (REC-131)', () => {
  it('lists customer, booking or subscription, discount and the Reservado, Usado and Liberado statuses', async () => {
    await renderPage();
    server.use(http.get('*/api/admin/coupons/:id/uses', () => HttpResponse.json(uses)));

    await userEvent.click(screen.getByRole('button', { name: 'Ver usos de BRAVO10' }));

    const drawer = await screen.findByRole('dialog', { name: 'Usos de BRAVO10' });
    const items = await within(drawer).findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(plain(items[0]?.textContent)).toContain('Ana Souza');
    expect(plain(items[0]?.textContent)).toContain('BRV-7K2Q9X');
    expect(plain(items[0]?.textContent)).toContain('Reservado');
    expect(plain(items[0]?.textContent)).toContain('Desconto R$ 21,90');
    expect(plain(items[1]?.textContent)).toContain('Pacote 20h');
    expect(plain(items[1]?.textContent)).toContain('Usado');
    expect(plain(items[2]?.textContent)).toContain('Liberado');
  });

  it('says so when the coupon was never used', async () => {
    await renderPage();
    server.use(http.get('*/api/admin/coupons/:id/uses', () => HttpResponse.json({ items: [] })));

    await userEvent.click(screen.getByRole('button', { name: 'Ver usos de PRIMEIRA20' }));

    expect(await screen.findByText('Este cupom ainda não foi usado.')).toBeInTheDocument();
  });
});
