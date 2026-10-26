import { slotDiscountApplyResultSchema } from '@bravo/core';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ID } from '../../test/fixtures/nucleo';
import { parseFixture } from '../../test/fixtures/parse';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { RID } from '../purchases/fixtures';
import { SlotDiscountDialog } from './SlotDiscountDialog';
import type { SlotDiscountPrefill } from './slot-discount-request';

// A 19:00–22:00 drag on Sala Principal, Tuesday 27/10/2026.
const prefill: SlotDiscountPrefill = {
  roomId: ID.principal,
  date: '2026-10-27',
  startMinute: 1140,
  endMinute: 1320,
};

const created = {
  id: RID.slotDiscount,
  roomId: ID.principal,
  startsAt: '2026-10-27T22:00:00.000Z',
  endsAt: '2026-10-28T01:00:00.000Z',
  percent: 15,
  consumed: false,
};

// 20:00–21:30 is occupied in Sala Principal: the discount covers 19:00–20:00 and 21:30–22:00.
const resultWithSkipped = parseFixture(
  slotDiscountApplyResultSchema,
  {
    created: [
      created,
      {
        ...created,
        id: 'eeeeeeee-eeee-4eee-8eee-222222222222',
        startsAt: '2026-10-28T00:30:00.000Z',
      },
    ],
    skipped: [{ roomId: ID.principal, startMinute: 1200, endMinute: 1290, reason: 'occupied' }],
  },
  'slotDiscountResultSkipped',
);

function stubApply(status: number, body: unknown) {
  const bodies: unknown[] = [];
  server.use(
    http.post('*/api/admin/slot-discounts', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(body as Record<string, unknown>, { status });
    }),
  );
  return bodies;
}

async function renderDialog(onClose = vi.fn()) {
  renderWithProviders(<SlotDiscountDialog prefill={prefill} onClose={onClose} />);
  await screen.findByRole('checkbox', { name: 'Sala Principal' });
  return onClose;
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Aplicar desconto' }));

describe('SlotDiscountDialog (REC-133, REC-136)', () => {
  it('opens pre-filled with the dragged 19:00–22:00 range, its date and room', async () => {
    await renderDialog();

    expect(screen.getByLabelText('Data')).toHaveValue('2026-10-27');
    expect(screen.getByLabelText('Início')).toHaveValue('19:00');
    expect(screen.getByLabelText('Fim')).toHaveValue('22:00');
    expect(screen.getByRole('checkbox', { name: 'Sala Principal' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sala Secundária' })).not.toBeChecked();
  });

  it('submits { roomIds, date, startMinute: 1140, endMinute: 1320, percent }', async () => {
    const bodies = stubApply(201, resultWithSkipped);
    await renderDialog();

    await userEvent.type(screen.getByLabelText('Desconto (%)'), '15');
    await submit();

    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toEqual({
      roomIds: [ID.principal],
      date: '2026-10-27',
      startMinute: 1140,
      endMinute: 1320,
      percent: 15,
    });
  });

  it('applies to several rooms at once', async () => {
    const bodies = stubApply(201, resultWithSkipped);
    await renderDialog();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sala Secundária' }));
    await userEvent.type(screen.getByLabelText('Desconto (%)'), '10');
    await submit();

    await vi.waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toMatchObject({ roomIds: [ID.principal, ID.secundaria], percent: 10 });
  });

  it('lists the occupied part that got no discount and what was created', async () => {
    stubApply(201, resultWithSkipped);
    const onClose = await renderDialog();

    await userEvent.type(screen.getByLabelText('Desconto (%)'), '15');
    await submit();

    const dialog = await screen.findByRole('dialog', { name: 'Desconto aplicado' });
    expect(
      within(dialog).getByText('Sala Principal: 20:00–21:30 ocupado, sem desconto'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('2 faixas de horário com desconto de 15%.'),
    ).toBeInTheDocument();

    await userEvent.click(within(dialog).getByText('Fechar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "Já existe desconto neste horário" on a 409 and keeps the form open', async () => {
    stubApply(409, {
      error: { code: 'CONFLICT', message: 'Já existe desconto neste horário' },
    });
    await renderDialog();

    await userEvent.type(screen.getByLabelText('Desconto (%)'), '15');
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe desconto neste horário');
    expect(screen.getByRole('dialog', { name: 'Aplicar desconto (%)' })).toBeInTheDocument();
  });

  it('refuses a percent outside 1..100 and no room, without calling the API', async () => {
    const bodies = stubApply(201, resultWithSkipped);
    await renderDialog();

    await userEvent.type(screen.getByLabelText('Desconto (%)'), '101');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sala Principal' }));
    await submit();

    expect(await screen.findByText('O desconto precisa estar entre 1% e 100%')).toBeInTheDocument();
    expect(screen.getByText('Escolha pelo menos uma sala')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it('refuses an end that is not after the start', async () => {
    const bodies = stubApply(201, resultWithSkipped);
    await renderDialog();

    const end = screen.getByLabelText('Fim');
    await userEvent.clear(end);
    await userEvent.type(end, '18:00');
    await userEvent.tab();
    await userEvent.type(screen.getByLabelText('Desconto (%)'), '15');
    await submit();

    expect(await screen.findByText('O fim precisa ser depois do início')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });
});
