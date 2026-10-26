import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { policySettings } from '../../../test/fixtures/nucleo';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { stubStaffSession } from '../../../test/session';
import { PoliciesPanel, PoliciesRoute } from './PoliciesPanel';

const GROUPS = [
  'Sinal e saldo',
  'Checkout e pré-reserva',
  'Reagendamento',
  'Cancelamento e no-show',
  'Assinaturas e horas extras',
  'Créditos',
];

const setNumber = async (label: string, value: string) => {
  const input = await screen.findByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

describe('PoliciesPanel (NUC-176)', () => {
  it('shows the six groups and the current version', async () => {
    renderWithProviders(<PoliciesPanel />);

    await screen.findByLabelText('Sinal (%)');
    for (const title of GROUPS) {
      expect(screen.getByRole('group', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/Versão 1/)).toBeInTheDocument();
  });

  it('updates the rendered preview to "sinal de 30%" while the deposit is edited', async () => {
    renderWithProviders(<PoliciesPanel />);
    const preview = await screen.findByRole('region', { name: 'Prévia do texto da política' });
    expect(preview).toHaveTextContent('sinal de 50% do valor');

    await setNumber('Sinal (%)', '30');

    expect(preview).toHaveTextContent('sinal de 30% do valor');
    expect(within(preview).getByRole('heading', { name: 'Sinal e saldo' })).toBeInTheDocument();
  });

  it('saves every value and reports the new version', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put('*/api/admin/settings/policies', async ({ request }) => {
        const body = (await request.json()) as typeof policySettings.values;
        bodies.push(body);
        return HttpResponse.json({ version: 2, values: body });
      }),
    );
    renderWithProviders(<PoliciesPanel />);
    await setNumber('Sinal (%)', '30');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar políticas' }));

    await waitFor(() =>
      expect(bodies).toEqual([{ ...policySettings.values, 'payment.deposit_percent': 30 }]),
    );
    expect(await screen.findByText('Políticas salvas. Versão 2.')).toBeInTheDocument();
  });

  it('shows the errors of a 422 on both deadline fields', async () => {
    server.use(
      http.put('*/api/admin/settings/policies', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos',
              details: [
                {
                  path: 'payment.balance_charge_hours_before',
                  message: 'A cobrança precisa vir antes do prazo',
                },
                {
                  path: 'payment.balance_deadline_hours_before',
                  message: 'O prazo precisa ser menor que a cobrança',
                },
              ],
              requestId: 'req-test-0001',
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderWithProviders(<PoliciesPanel />);
    await screen.findByLabelText('Sinal (%)');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar políticas' }));

    expect(await screen.findByText('A cobrança precisa vir antes do prazo')).toBeInTheDocument();
    expect(screen.getByText('O prazo precisa ser menor que a cobrança')).toBeInTheDocument();
  });

  it('blocks a deadline that is not before the balance charge without calling the API', async () => {
    const put = vi.fn();
    server.use(
      http.put('*/api/admin/settings/policies', () => {
        put();
        return HttpResponse.json(policySettings);
      }),
    );
    renderWithProviders(<PoliciesPanel />);
    await setNumber('Prazo para pagar o saldo (horas antes)', '60');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar políticas' }));

    expect(
      await screen.findByText('O prazo do saldo precisa ser menor que o momento da cobrança'),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('PoliciesRoute', () => {
  it('shows the restricted page to reception without loading the policies', async () => {
    const get = vi.fn();
    server.use(
      http.get('*/api/admin/settings/policies', () => {
        get();
        return HttpResponse.json(policySettings);
      }),
    );
    stubStaffSession('reception');
    renderWithProviders(<PoliciesRoute />);

    expect(await screen.findByText('Acesso restrito')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
