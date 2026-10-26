import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { blockCreated, ID, recurrenceCreated } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { stubStaffSession } from '../../test/session';
import { BlockModal } from './BlockModal';

const DEFAULTS = {
  roomIds: [ID.principal],
  date: '2026-10-27',
  startMinute: 600,
  endMinute: 660,
} as const;

function renderModal() {
  return renderWithProviders(<BlockModal open onClose={vi.fn()} defaults={DEFAULTS} />);
}

function captureBlocks() {
  const bodies: unknown[] = [];
  server.use(
    http.post('*/api/admin/blocks', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(blockCreated, { status: 201 });
    }),
  );
  return bodies;
}

const submit = () => screen.getByRole('button', { name: 'Bloquear horário' });

describe('BlockModal (NUC-60)', () => {
  it('posts the "Limpeza" preset for the prefilled room, date and times', async () => {
    stubStaffSession('reception');
    const bodies = captureBlocks();
    renderModal();
    expect(await screen.findByRole('checkbox', { name: 'Sala Principal' })).toBeChecked();
    expect(screen.getByLabelText('Data')).toHaveValue('2026-10-27');
    expect(screen.getByLabelText('Início')).toHaveValue('10:00');
    expect(screen.getByLabelText('Fim')).toHaveValue('11:00');

    await userEvent.click(submit());

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          roomIds: [ID.principal],
          tag: 'Limpeza',
          date: '2026-10-27',
          startMinute: 600,
          endMinute: 660,
        },
      ]),
    );
  });

  it('posts a free-text tag for one or more rooms', async () => {
    stubStaffSession('reception');
    const bodies = captureBlocks();
    renderModal();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sala Secundária' }));

    await userEvent.selectOptions(
      screen.getByLabelText('Motivo do bloqueio'),
      'Outro (texto livre)',
    );
    await userEvent.type(screen.getByLabelText('Texto do bloqueio'), 'Ensaio fotográfico');
    await userEvent.click(submit());

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          roomIds: [ID.principal, ID.secundaria],
          tag: 'Ensaio fotográfico',
          date: '2026-10-27',
          startMinute: 600,
          endMinute: 660,
        },
      ]),
    );
  });

  it('hides "Repetir semanalmente" for reception', async () => {
    stubStaffSession('reception');
    renderModal();
    await screen.findByRole('checkbox', { name: 'Sala Principal' });

    expect(screen.queryByRole('checkbox', { name: 'Repetir semanalmente' })).toBeNull();
  });

  it('lets an admin repeat the block weekly on the chosen weekdays', async () => {
    stubStaffSession('admin');
    const bodies: unknown[] = [];
    server.use(
      http.post('*/api/admin/block-recurrences', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(recurrenceCreated, { status: 201 });
      }),
    );
    renderModal();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Repetir semanalmente' }));
    expect(screen.getByRole('checkbox', { name: 'Ter' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Qui' }));
    await userEvent.click(submit());

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          roomIds: [ID.principal],
          tag: 'Limpeza',
          weekdays: [2, 4],
          startMinute: 600,
          endMinute: 660,
          validFrom: '2026-10-27',
        },
      ]),
    );
  });

  it('shows the conflicting booking code of a 409', async () => {
    stubStaffSession('reception');
    server.use(
      http.post('*/api/admin/blocks', () =>
        HttpResponse.json(
          {
            error: {
              code: 'SLOT_TAKEN',
              message: 'O horário já está ocupado pela reserva BRV-7K2Q9X.',
              requestId: 'req-test-0001',
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderModal();
    await screen.findByRole('checkbox', { name: 'Sala Principal' });

    await userEvent.click(submit());

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/BRV-7K2Q9X/)).toBeInTheDocument();
  });
});
