import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ID, sandboxCharge } from '../../test/fixtures/nucleo';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { SandboxCheckoutPage } from './SandboxCheckoutPage';

function renderSandbox() {
  return renderWithProviders(
    <Routes>
      <Route path="/pagamento/sandbox/:chargeId" element={<SandboxCheckoutPage />} />
    </Routes>,
    `/pagamento/sandbox/${ID.charge}`,
  );
}

describe('SandboxCheckoutPage (NUC-120)', () => {
  it('shows the demo banner and the two actions with their accessible names', async () => {
    renderSandbox();

    expect(await screen.findByRole('button', { name: 'Aprovar pagamento' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Recusar pagamento' })).toBeEnabled();
    expect(
      screen.getByText(/Ambiente de demonstração: nenhum pagamento real será feito/),
    ).toBeInTheDocument();
    expect(screen.getByText(/BRV-7K2Q9X/)).toBeInTheDocument();
  });

  it('approves through the endpoint and links back to the checkout of the booking', async () => {
    let approved = 0;
    server.use(
      http.post('*/api/public/sandbox/charges/:chargeId/approve', ({ params }) => {
        approved += 1;
        expect(params['chargeId']).toBe(ID.charge);
        return HttpResponse.json({ status: 'approved' });
      }),
    );
    renderSandbox();

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar pagamento' }));

    expect(await screen.findByText('Pagamento aprovado.')).toBeInTheDocument();
    expect(approved).toBe(1);
    expect(screen.getByRole('link', { name: 'Voltar para a reserva' })).toHaveAttribute(
      'href',
      `/checkout/${sandboxCharge.bookingId ?? ''}`,
    );
    expect(screen.queryByRole('button', { name: 'Aprovar pagamento' })).toBeNull();
  });

  it('rejects through the endpoint', async () => {
    renderSandbox();

    await userEvent.click(await screen.findByRole('button', { name: 'Recusar pagamento' }));

    expect(await screen.findByText('Pagamento recusado.')).toBeInTheDocument();
  });

  it('shows the API message when the action is forbidden', async () => {
    server.use(
      http.post('*/api/public/sandbox/charges/:chargeId/approve', () =>
        apiError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.'),
      ),
    );
    renderSandbox();

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar pagamento' }));

    await waitFor(() => {
      expect(screen.getByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
    });
  });

  it('hides the actions when the charge is no longer pending', async () => {
    server.use(
      http.get('*/api/public/sandbox/charges/:chargeId', () =>
        HttpResponse.json({ ...sandboxCharge, status: 'approved' }),
      ),
    );
    renderSandbox();

    expect(await screen.findByText('Situação: Aprovado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar pagamento' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Voltar para a reserva' })).toBeInTheDocument();
  });
});
