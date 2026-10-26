import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOptions } from '../../features/booking/checkout-options';
import {
  COUPON_REJECTIONS,
  quoteWithRevenue,
  revenueOverridesCouponWins,
  revenueOverridesRejected,
  revenueOverridesSufficient,
  type RevenueQuoteOverrides,
} from '../../features/purchases/fixtures';
import { quote as plainQuote } from '../../test/fixtures/nucleo';
import { spaced } from '../../test/text';
import { CouponField } from './CouponField';
import { CreditsToggle } from './CreditsToggle';

function renderCoupon(overrides: RevenueQuoteOverrides = {}, options: CheckoutOptions = {}) {
  const onOptionsChange = vi.fn();
  render(
    <CouponField
      quote={quoteWithRevenue(overrides)}
      options={options}
      onOptionsChange={onOptionsChange}
    />,
  );
  return onOptionsChange;
}

function renderCredits(overrides: RevenueQuoteOverrides = {}, options: CheckoutOptions = {}) {
  const onOptionsChange = vi.fn();
  render(
    <CreditsToggle
      quote={quoteWithRevenue(overrides)}
      options={options}
      onOptionsChange={onOptionsChange}
    />,
  );
  return onOptionsChange;
}

describe('CouponField (REC-117, REC-121)', () => {
  it.each(COUPON_REJECTIONS)('shows the REC-117 message for rejection "%s"', (reason, message) => {
    renderCoupon(revenueOverridesRejected(reason, message), { couponCode: 'BRAVO10' });

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText('Cupom de desconto')).toBeInvalid();
  });

  it('shows the coupon-vs-slot note of REC-121 verbatim', () => {
    renderCoupon(revenueOverridesCouponWins, { couponCode: 'BRAVO10' });

    expect(
      screen.getByText(
        spaced('Aplicamos o maior desconto: cupom R$ 20,00 (o desconto do horário era R$ 16,00).'),
      ),
    ).toBeInTheDocument();
  });

  it('upper-cases the typed code and submits "BRAVO10" on Aplicar', async () => {
    const onOptionsChange = renderCoupon();

    await userEvent.type(screen.getByLabelText('Cupom de desconto'), 'bravo10');
    expect(screen.getByLabelText('Cupom de desconto')).toHaveValue('BRAVO10');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ couponCode: 'BRAVO10' });
  });

  it('submits with Enter and ignores surrounding spaces', async () => {
    const onOptionsChange = renderCoupon();

    await userEvent.type(screen.getByLabelText('Cupom de desconto'), '  bravo10 {Enter}');

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ couponCode: 'BRAVO10' });
  });

  it('keeps Aplicar disabled while the field is empty', async () => {
    const onOptionsChange = renderCoupon();

    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Cupom de desconto'), '   ');
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    expect(onOptionsChange).not.toHaveBeenCalled();
  });

  it('shows the applied coupon with its discount and clears the code on Remover', async () => {
    const onOptionsChange = renderCoupon(
      {
        discount: {
          source: 'coupon',
          discountCents: 2190,
          slotDiscountCents: 0,
          couponDiscountCents: 2190,
          slotDiscountIds: [],
        },
      },
      { couponCode: 'BRAVO10' },
    );

    expect(screen.getByText(spaced('Cupom BRAVO10 aplicado: − R$ 21,90'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ couponCode: undefined });
  });

  it('lets the customer remove a rejected code', async () => {
    const onOptionsChange = renderCoupon(revenueOverridesRejected('expired', 'Cupom expirado'), {
      couponCode: 'VELHO',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remover' }));

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ couponCode: undefined });
  });

  it('renders nothing when the quote has no receita extensions', () => {
    const { container } = render(
      <CouponField quote={plainQuote} options={{}} onOptionsChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('CreditsToggle (REC-107)', () => {
  it('offers "Usar créditos (R$ 50,00 disponíveis)" and emits useCredits', async () => {
    const onOptionsChange = renderCredits(revenueOverridesSufficient);

    const toggle = screen.getByRole('checkbox', {
      name: spaced('Usar créditos (R$ 50,00 disponíveis)'),
    });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ useCredits: true });
  });

  it('emits useCredits false when unchecked and shows the applied amount while checked', async () => {
    const onOptionsChange = renderCredits(
      { credit: { availableCents: 5000, appliedCents: 3000 } },
      { useCredits: true },
    );

    expect(screen.getByText(spaced('Créditos aplicados: − R$ 30,00'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ useCredits: false });
  });

  it('hides the applied amount while unchecked', () => {
    renderCredits({ credit: { availableCents: 5000, appliedCents: 0 } });

    expect(screen.queryByText(/Créditos aplicados/)).not.toBeInTheDocument();
  });

  it('renders nothing without credit or without receita extensions', () => {
    const none = renderCredits({ credit: { availableCents: 0, appliedCents: 0 } });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(none).not.toHaveBeenCalled();

    const { container } = render(
      <CreditsToggle quote={plainQuote} options={{}} onOptionsChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
