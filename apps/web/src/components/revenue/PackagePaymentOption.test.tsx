import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOptions } from '../../features/booking/checkout-options';
import {
  buildRevenueExtensions,
  quoteWithRevenue,
  revenueOverridesInsufficient,
  revenueOverridesSufficient,
  type RevenueQuoteOverrides,
} from '../../features/purchases/fixtures';
import { quote as plainQuote } from '../../test/fixtures/nucleo';
import { PackagePaymentOption } from './PackagePaymentOption';

function renderOption(overrides: RevenueQuoteOverrides, options: CheckoutOptions = {}) {
  const onOptionsChange = vi.fn();
  render(
    <MemoryRouter>
      <PackagePaymentOption
        quote={quoteWithRevenue(overrides)}
        options={options}
        onOptionsChange={onOptionsChange}
      />
    </MemoryRouter>,
  );
  return onOptionsChange;
}

const packageRadio = () => screen.getByRole('radio', { name: 'Pagar com meu pacote' });

// REC-24: debit preview; REC-28: insufficient path.
describe('PackagePaymentOption (REC-24, REC-28)', () => {
  it('previews the 78 min debit and emits payWith "package" when selected', async () => {
    const onOptionsChange = renderOption(revenueOverridesSufficient);

    expect(screen.getByText('Esta reserva vai debitar 78 min do seu pacote')).toBeInTheDocument();
    expect(packageRadio()).toBeEnabled();
    await userEvent.click(packageRadio());

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ payWith: 'package' });
  });

  it('reflects the selected option and lets the customer go back to paying for the booking', async () => {
    const onOptionsChange = renderOption(revenueOverridesSufficient, { payWith: 'package' });

    expect(packageRadio()).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Pagar esta reserva' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Pagar esta reserva' }));

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ payWith: 'money' });
  });

  it('discloses the calculation: formula text and each priced stretch', () => {
    renderOption(revenueOverridesSufficient);

    expect(screen.getByText('Ver como calculamos')).toBeInTheDocument();
    expect(screen.getByText('60 min + 18 min de excedente = 78 min')).toBeInTheDocument();
    expect(screen.getByText('19:00–20:00 · 60 min')).toBeInTheDocument();
  });

  it('disables the option when the balance is insufficient and explains it', () => {
    renderOption(revenueOverridesInsufficient);

    expect(packageRadio()).toBeDisabled();
    expect(
      screen.getByText('Saldo insuficiente: esta reserva debita 78 min e você tem 40 min'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Esta reserva vai debitar 78 min do seu pacote'),
    ).not.toBeInTheDocument();
  });

  it('links to the extra-hours purchase and emits payWith "money" from "Pagar esta reserva"', async () => {
    const onOptionsChange = renderOption(revenueOverridesInsufficient);

    expect(screen.getByRole('link', { name: 'Comprar horas extras' })).toHaveAttribute(
      'href',
      '/app/compras/horas-extras',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pagar esta reserva' }));

    expect(onOptionsChange).toHaveBeenCalledExactlyOnceWith({ payWith: 'money' });
  });

  it('counts package and extra minutes together as what the customer has', () => {
    renderOption({
      package: {
        ...buildRevenueExtensions(revenueOverridesInsufficient).package,
        packageAvailableMinutes: 30,
        extraAvailableMinutes: 20,
      },
    });

    expect(
      screen.getByText('Saldo insuficiente: esta reserva debita 78 min e você tem 50 min'),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'outside_period',
      'Esta data está fora do período do seu pacote e suas horas extras não cobrem esta reserva.',
    ],
    ['block_category', 'Reservas de turno não podem ser pagas com pacote de horas.'],
    ['suspended', 'Sua assinatura está suspensa: regularize o pagamento para usar o pacote.'],
  ])('shows the "%s" message and disables the option', (reason, message) => {
    renderOption({
      package: {
        ...buildRevenueExtensions(revenueOverridesInsufficient).package,
        reason,
      },
    });

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(packageRadio()).toBeDisabled();
  });

  it('offers no extra-hours link when the subscription is suspended', () => {
    renderOption({
      package: {
        ...buildRevenueExtensions(revenueOverridesInsufficient).package,
        reason: 'suspended',
      },
    });

    expect(screen.queryByRole('link', { name: 'Comprar horas extras' })).not.toBeInTheDocument();
  });

  it('renders nothing when packageOption is null or the quote has no receita extensions', () => {
    const none = render(
      <MemoryRouter>
        <PackagePaymentOption
          quote={quoteWithRevenue({ package: null })}
          options={{}}
          onOptionsChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(none.container).toBeEmptyDOMElement();

    const plain = render(
      <PackagePaymentOption quote={plainQuote} options={{}} onOptionsChange={vi.fn()} />,
    );
    expect(plain.container).toBeEmptyDOMElement();
  });
});
