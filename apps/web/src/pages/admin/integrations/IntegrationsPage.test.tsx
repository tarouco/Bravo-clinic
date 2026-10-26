import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { buildGateway } from '../../../features/admin-integrations/fixtures';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { IntegrationsPage } from './IntegrationsPage';

describe('IntegrationsPage tabs', () => {
  it('opens on Pagamentos and loads only the gateway list', async () => {
    const hits: string[] = [];
    server.use(
      http.get('*/api/admin/integrations/gateway', () => {
        hits.push('gateway');
        return HttpResponse.json(buildGateway());
      }),
    );
    renderWithProviders(<IntegrationsPage />, '/admin/integracoes');

    expect(screen.getByRole('heading', { level: 1, name: 'Integrações' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pagamentos', selected: true })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Mercado Pago' })).toBeInTheDocument();
    expect(hits).toEqual(['gateway']);
  });
});
