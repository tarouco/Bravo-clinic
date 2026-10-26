import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  buildCalendar,
  buildGateway,
  buildNotifications,
  outboxPage,
} from '../../../features/admin-integrations/fixtures';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { IntegrationsPage } from './IntegrationsPage';

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function stubApi() {
  const hits: string[] = [];
  server.use(
    http.get('*/api/admin/integrations/gateway', () => {
      hits.push('gateway');
      return HttpResponse.json(buildGateway());
    }),
    http.get('*/api/admin/integrations/calendar', () => {
      hits.push('calendar');
      return HttpResponse.json(buildCalendar());
    }),
    http.get('*/api/admin/integrations/notifications', () => {
      hits.push('notifications');
      return HttpResponse.json(buildNotifications());
    }),
    http.get('*/api/admin/integrations/outbox', () => HttpResponse.json(outboxPage)),
  );
  return hits;
}

function renderPage(route = '/admin/integracoes') {
  renderWithProviders(
    <>
      <IntegrationsPage />
      <Probe />
    </>,
    route,
  );
}

describe('IntegrationsPage tabs', () => {
  it('opens on Pagamentos and loads only the gateway list', async () => {
    const hits = stubApi();
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Integrações' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pagamentos', selected: true })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Mercado Pago' })).toBeInTheDocument();
    expect(hits).toEqual(['gateway']);
  });

  it('switches to Calendário and E-mails, keeping the tab in the URL', async () => {
    const hits = stubApi();
    renderPage();
    await screen.findByRole('region', { name: 'Mercado Pago' });

    await userEvent.click(screen.getByRole('tab', { name: 'Calendário' }));
    expect(await screen.findByRole('region', { name: 'Agenda da clínica' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/integracoes?tab=calendario');

    await userEvent.click(screen.getByRole('tab', { name: 'E-mails' }));
    expect(await screen.findByRole('region', { name: 'Destinatários' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('tab=emails');
    expect(hits).toEqual(['gateway', 'calendar', 'notifications']);
  });

  it('opens straight on the tab named by the URL and returns to Pagamentos without the param', async () => {
    stubApi();
    renderPage('/admin/integracoes?tab=emails');

    expect(await screen.findByRole('region', { name: 'Destinatários' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'E-mails', selected: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Pagamentos' }));

    expect(screen.getByTestId('location')).not.toHaveTextContent('tab=');
    expect(await screen.findByRole('region', { name: 'Mercado Pago' })).toBeInTheDocument();
  });
});
