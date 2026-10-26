import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ID } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { spaced } from '../../test/text';
import {
  cancelPreviewFixed,
  cancelPreviewHour,
  extraHoursPackage20h,
  occurrenceCheckFull,
  packageOffersForSwitch,
  pacote30h,
  RID,
  subscriptionActive,
  subscriptionPurchaseResult,
  switchQuoteFixed,
  switchQuoteHour,
  subscriptionAwaiting,
} from './fixtures';
import { CancelSubscriptionDialog, SwitchPackageDialog } from './SubscriptionDialogs';

const fixedActive = { ...subscriptionAwaiting, status: 'active' as const };

function stubCommon() {
  server.use(
    http.get('*/api/public/packages', () => HttpResponse.json(packageOffersForSwitch)),
    http.get('*/api/app/extra-hours', () => HttpResponse.json(extraHoursPackage20h)),
    http.get('*/api/app/cards', () => HttpResponse.json({ items: [] })),
  );
}

describe('CancelSubscriptionDialog (REC-79)', () => {
  function stubCancel(preview: JsonBodyType) {
    stubCommon();
    const calls: unknown[] = [];
    server.use(
      http.get('*/api/app/subscriptions/:id/cancel-preview', () => HttpResponse.json(preview)),
      http.post('*/api/app/subscriptions/:id/cancel', async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ subscription: { ...subscriptionActive, status: 'cancelled' } });
      }),
    );
    return calls;
  }

  it('shows the minutes lost without refund and the extra hours kept until their expiry', async () => {
    stubCancel(cancelPreviewHour);
    renderWithProviders(
      <CancelSubscriptionDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );

    expect(
      await screen.findByText('Você perde 6h de saldo deste período, sem reembolso'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Suas horas extras continuam válidas até 08\/02\/2027/),
    ).toBeInTheDocument();
  });

  it('confirming sends { confirm: true } and closes the dialog', async () => {
    const calls = stubCancel(cancelPreviewHour);
    const onClose = vi.fn();
    renderWithProviders(
      <CancelSubscriptionDialog subscription={subscriptionActive} onClose={onClose} />,
    );
    await screen.findByText(/Você perde 6h/);

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(calls).toEqual([{ confirm: true }]);
  });

  it('does not cancel when the tenant keeps the subscription', async () => {
    const calls = stubCancel(cancelPreviewHour);
    const onClose = vi.fn();
    renderWithProviders(
      <CancelSubscriptionDialog subscription={subscriptionActive} onClose={onClose} />,
    );
    await screen.findByText(/Você perde 6h/);

    await userEvent.click(screen.getByRole('button', { name: 'Manter assinatura' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('lists the occurrences released for a fixed schedule', async () => {
    stubCancel(cancelPreviewFixed);
    renderWithProviders(<CancelSubscriptionDialog subscription={fixedActive} onClose={vi.fn()} />);

    expect(await screen.findByText('12 ocorrências futuras serão liberadas')).toBeInTheDocument();
    expect(screen.queryByText(/horas extras/)).not.toBeInTheDocument();
  });

  it('warns about a paid upcoming period that is lost', async () => {
    stubCancel({ minutesLost: 1200, paidUpcomingPeriodLostCents: 160000, extraMinutesKept: 0 });
    renderWithProviders(
      <CancelSubscriptionDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );

    expect(
      await screen.findByText(
        spaced('Você perde também o próximo período já pago (R$ 1.600,00), sem reembolso'),
      ),
    ).toBeInTheDocument();
  });

  it('shows the API message and keeps the dialog open when cancelling fails', async () => {
    stubCancel(cancelPreviewHour);
    server.use(
      http.post('*/api/app/subscriptions/:id/cancel', () =>
        HttpResponse.json(
          {
            error: { code: 'INVALID_TRANSITION', message: 'Esta assinatura não permite esta ação' },
          },
          { status: 409 },
        ),
      ),
    );
    const onClose = vi.fn();
    renderWithProviders(
      <CancelSubscriptionDialog subscription={subscriptionActive} onClose={onClose} />,
    );
    await screen.findByText(/Você perde 6h/);

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(await screen.findByText('Esta assinatura não permite esta ação')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SwitchPackageDialog (REC-72, REC-76, REC-77)', () => {
  function stubSwitch(quote: JsonBodyType = switchQuoteHour) {
    stubCommon();
    const quotes: unknown[] = [];
    const swaps: { body: unknown; key: string | null }[] = [];
    server.use(
      http.post('*/api/app/subscriptions/:id/switch/quote', async ({ request }) => {
        quotes.push(await request.json());
        return HttpResponse.json(quote);
      }),
      http.post('*/api/app/subscriptions/:id/switch', async ({ request }) => {
        swaps.push({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        return HttpResponse.json(
          {
            ...subscriptionPurchaseResult,
            charge: { ...subscriptionPurchaseResult.charge, amountCents: 225000 },
          },
          { status: 201 },
        );
      }),
      http.get('*/api/app/subscriptions/:id', () =>
        HttpResponse.json({ ...subscriptionActive, status: 'awaiting_payment' }),
      ),
    );
    return { quotes, swaps };
  }

  it('offers only the other packages of the same type', async () => {
    stubSwitch();
    renderWithProviders(
      <SwitchPackageDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );

    const select = await screen.findByRole('combobox', { name: 'Novo pacote' });
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Escolha o novo pacote', pacote30h.name]);
  });

  it('previews the converted balance and the new period total (REC-71 example)', async () => {
    const { quotes } = stubSwitch();
    renderWithProviders(
      <SwitchPackageDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Novo pacote' }),
      RID.pacote30h,
    );

    expect(
      await screen.findByText('Seu saldo de 6h vira 6h 24min no novo pacote'),
    ).toBeInTheDocument();
    expect(screen.getByText('Total no novo período: 36h 24min')).toBeInTheDocument();
    expect(screen.getAllByText(spaced('R$ 2.250,00'), { selector: 'dd' })).toHaveLength(2);
    expect(quotes).toEqual([{ categoryId: RID.pacote30h }]);
  });

  it('pays the new period: posts the target and method with an Idempotency-Key and shows the Pix code', async () => {
    const { swaps } = stubSwitch();
    renderWithProviders(
      <SwitchPackageDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Novo pacote' }),
      RID.pacote30h,
    );

    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByRole('img', { name: 'QR Code do Pix' })).toBeInTheDocument();
    expect(swaps[0]?.body).toEqual({ categoryId: RID.pacote30h, paymentMethod: 'pix' });
    expect(swaps[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('says the switch is complete once the new subscription is active', async () => {
    stubSwitch();
    server.use(
      http.get('*/api/app/subscriptions/:id', () =>
        HttpResponse.json({
          ...subscriptionActive,
          category: { id: RID.pacote30h, name: 'Pacote 30h' },
        }),
      ),
    );
    renderWithProviders(
      <SwitchPackageDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Novo pacote' }),
      RID.pacote30h,
    );

    await userEvent.click(await screen.findByRole('button', { name: /^Pagar R\$/ }));

    expect(await screen.findByText('Troca concluída')).toBeInTheDocument();
    expect(screen.getByText(/Pacote 30h já está ativo/)).toBeInTheDocument();
  });

  it('asks for room and start date of a fixed schedule before quoting, then lists the released occurrences', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T15:00:00Z'));
    try {
      const { quotes } = stubSwitch(switchQuoteFixed);
      const other = { ...packageOffersForSwitch.items[2], id: RID.pacote30h, name: 'Dia inteiro' };
      server.use(
        http.get('*/api/public/packages', () =>
          HttpResponse.json({ items: [...packageOffersForSwitch.items, other] }),
        ),
        http.get('*/api/public/packages/:categoryId/occurrences', () =>
          HttpResponse.json(occurrenceCheckFull),
        ),
      );
      renderWithProviders(<SwitchPackageDialog subscription={fixedActive} onClose={vi.fn()} />);

      await userEvent.selectOptions(
        await screen.findByRole('combobox', { name: 'Novo pacote' }),
        RID.pacote30h,
      );
      await userEvent.click(await screen.findByRole('radio', { name: 'Sala Principal' }));
      await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
      await userEvent.click(screen.getByRole('button', { name: '2 de novembro, disponível' }));
      expect(quotes).toHaveLength(0);
      await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }));

      expect(
        await screen.findByText('12 ocorrências futuras do horário atual serão liberadas'),
      ).toBeInTheDocument();
      expect(quotes).toEqual([
        { categoryId: RID.pacote30h, roomId: ID.principal, baseOn: '2026-11-02' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the API message when the quote fails', async () => {
    stubSwitch();
    server.use(
      http.post('*/api/app/subscriptions/:id/switch/quote', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_FAILED', message: 'Escolha um pacote diferente' } },
          { status: 422 },
        ),
      ),
    );
    renderWithProviders(
      <SwitchPackageDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Novo pacote' }),
      RID.pacote30h,
    );

    expect(await screen.findByText('Escolha um pacote diferente')).toBeInTheDocument();
  });

  it('says so when there is no other package to switch to', async () => {
    stubCommon();
    server.use(
      http.get('*/api/public/packages', () =>
        HttpResponse.json({ items: [packageOffersForSwitch.items[0]] }),
      ),
    );
    renderWithProviders(
      <SwitchPackageDialog subscription={subscriptionActive} onClose={vi.fn()} />,
    );

    expect(
      await screen.findByText('Não há outro pacote do mesmo tipo disponível para troca agora.'),
    ).toBeInTheDocument();
  });
});
