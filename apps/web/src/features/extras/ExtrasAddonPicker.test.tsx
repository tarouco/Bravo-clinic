import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGestaoSlots } from '../../extensions/gestao';
import { resetSlots, slotComponents } from '../../extensions/slots';
import { BookingFlowPage } from '../booking/BookingFlowPage';
import { bookingAwaitingPayment, me, quote } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { spaced } from '../../test/text';
import { ExtrasAddonPicker } from './ExtrasAddonPicker';
import { PUBLIC_SERVICE_IDS, publicExtraServices, publicExtraServicesWithOnline } from './fixtures';

// `quote` is a 150-minute booking: hourly extras go up to ceil(150 / 60) = 3.

function stubServices(list: typeof publicExtraServices) {
  server.use(http.get('*/api/public/extra-services', () => HttpResponse.json(list)));
}

function renderPicker() {
  const onChange = vi.fn();
  renderWithProviders(<ExtrasAddonPicker draft={quote} onChange={onChange} />);
  return onChange;
}

describe('ExtrasAddonPicker visibility (GES-88)', () => {
  it('renders nothing when the catalog has no online service', async () => {
    let served = false;
    server.use(
      http.get('*/api/public/extra-services', () => {
        served = true;
        return HttpResponse.json(publicExtraServices);
      }),
    );
    renderWithProviders(
      <div data-testid="host">
        <ExtrasAddonPicker draft={quote} onChange={vi.fn()} />
      </div>,
    );

    await waitFor(() => expect(served).toBe(true));
    // Let the query settle before asserting that nothing was rendered.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByTestId('host')).toBeEmptyDOMElement();
  });

  it('lists only the online services, with their reference price', async () => {
    stubServices(publicExtraServicesWithOnline);
    renderPicker();

    expect(await screen.findByText('Operador de câmera')).toBeInTheDocument();
    expect(screen.getByText('Edição de vídeo')).toBeInTheDocument();
    expect(screen.queryByText('Pacote de filmagem')).not.toBeInTheDocument();
    expect(screen.getByText(spaced('R$ 80,00/h'))).toBeInTheDocument();
  });
});

describe('ExtrasAddonPicker quantities (GES-88, GES-89)', () => {
  it('bounds an hourly service at ceil(minutes / 60) and shows the line total', async () => {
    stubServices(publicExtraServicesWithOnline);
    const user = userEvent.setup();
    const onChange = renderPicker();
    const plus = await screen.findByRole('button', {
      name: 'Aumentar horas de Operador de câmera',
    });

    await user.click(plus);
    await user.click(plus);
    await user.click(plus);

    expect(screen.getByRole('status', { name: 'Horas de Operador de câmera' })).toHaveTextContent(
      '3',
    );
    expect(plus).toBeDisabled();
    expect(screen.getByText(spaced('Operador de câmera: R$ 240,00'))).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({
      extras: [{ serviceId: PUBLIC_SERVICE_IDS.onlineHour, quantity: 3 }],
    });
  });

  it('fixes a per-project service at one unit with a checkbox instead of a stepper', async () => {
    stubServices(publicExtraServicesWithOnline);
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(await screen.findByRole('checkbox', { name: 'Adicionar Edição de vídeo' }));

    expect(
      screen.queryByRole('button', { name: 'Aumentar horas de Edição de vídeo' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(spaced('Edição de vídeo: R$ 250,00'))).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({
      extras: [{ serviceId: PUBLIC_SERVICE_IDS.onlineProject, quantity: 1 }],
    });
  });

  it('sends every picked service in one payload and an empty object once all are cleared', async () => {
    stubServices(publicExtraServicesWithOnline);
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(
      await screen.findByRole('button', { name: 'Aumentar horas de Operador de câmera' }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Adicionar Edição de vídeo' }));
    expect(onChange).toHaveBeenLastCalledWith({
      extras: [
        { serviceId: PUBLIC_SERVICE_IDS.onlineHour, quantity: 1 },
        { serviceId: PUBLIC_SERVICE_IDS.onlineProject, quantity: 1 },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Diminuir horas de Operador de câmera' }));
    await user.click(screen.getByRole('checkbox', { name: 'Adicionar Edição de vídeo' }));

    expect(onChange).toHaveBeenLastCalledWith({});
  });
});

describe('slot checkout.summary.extras registration (AD-033)', () => {
  afterEach(() => {
    resetSlots();
  });

  it('registers the picker once, however many times it runs', () => {
    registerGestaoSlots();
    registerGestaoSlots();

    expect(slotComponents('checkout.summary.extras')).toEqual([ExtrasAddonPicker]);
  });
});

describe('picker inside the Resumo step', () => {
  const RESUMO = '/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200&etapa=resumo';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSlots();
  });

  it('re-quotes and books with addons.extras of the picked service', async () => {
    stubServices(publicExtraServicesWithOnline);
    const quoteBodies: Record<string, unknown>[] = [];
    const bookingBodies: Record<string, unknown>[] = [];
    server.use(
      http.get('*/api/app/me', () => HttpResponse.json(me)),
      http.post('*/api/public/bookings/quote', async ({ request }) => {
        quoteBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(quote);
      }),
      http.post('*/api/app/bookings', async ({ request }) => {
        bookingBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(bookingAwaitingPayment, { status: 201 });
      }),
    );
    registerGestaoSlots();
    renderWithProviders(
      <Routes>
        <Route path="/reservar" element={<BookingFlowPage />} />
        <Route path="/checkout/:bookingId" element={<p>página de checkout</p>} />
      </Routes>,
      RESUMO,
    );
    await screen.findByRole('region', { name: 'Resumo da reserva' });
    expect(quoteBodies[0]).not.toHaveProperty('addons');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Aumentar horas de Operador de câmera' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Aumentar horas de Operador de câmera' }),
    );

    const expected = { extras: [{ serviceId: PUBLIC_SERVICE_IDS.onlineHour, quantity: 2 }] };
    await waitFor(() => expect(quoteBodies.at(-1)).toMatchObject({ addons: expected }));
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Li e aceito a política de reserva' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continuar para pagamento' }));

    await screen.findByText('página de checkout');
    expect(bookingBodies[0]).toMatchObject({ addons: expected });
  });
});
