import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bookingDetail, quote } from '../../test/fixtures/nucleo';
import { BookingSummary } from './BookingSummary';

/** Text with U+00A0 (from `formatBRL`) read as a plain space. */
const text = (node: HTMLElement | null) => (node?.textContent ?? '').replace(/\u00a0/g, ' ');

const items = () => screen.getAllByRole('listitem').map((li) => text(li));

describe('BookingSummary of a Quote (PR-3, NUC-100)', () => {
  it('renders one memory line per segment', () => {
    render(<BookingSummary quote={quote} />);

    expect(items()).toEqual([
      '17:30–19:00 · 2 horas ou mais · 1h30 × R$ 80,00 = R$ 120,00',
      '19:00–20:00 · 2 horas ou mais — noite · 1h × R$ 99,00 = R$ 99,00',
    ]);
  });

  it('shows the total, the sinal paid now and the saldo with its charge date', () => {
    render(<BookingSummary quote={quote} />);
    const rows = screen.getAllByText(/^(Total|Sinal|Saldo)/).map((dt) => dt.closest('div'));

    expect(text(rows[0] ?? null)).toBe('TotalR$ 219,00');
    expect(text(rows[1] ?? null)).toBe('Sinalpagamento agoraR$ 109,50');
    expect(text(rows[2] ?? null)).toBe('Saldocobrado em 25/10/2026 17:30R$ 109,50');
  });

  it('names the room and the date and time of the booking', () => {
    render(<BookingSummary quote={quote} />);

    expect(screen.getByText('Sala Principal')).toBeInTheDocument();
    expect(screen.getByText('27/10/2026 · 17:30–20:00')).toBeInTheDocument();
  });

  it('subtracts discount and credit and shows what is paid now', () => {
    const withCredit = {
      ...quote,
      discount: { source: 'coupon' as const, cents: 2000, label: 'Cupom BRAVO10' },
      netCents: 19900,
      payment: { ...quote.payment, depositCents: 9950, payNowCents: 5950, creditUsedCents: 4000 },
    };
    render(<BookingSummary quote={withCredit} />);
    const summary = screen.getByRole('region', { name: 'Resumo da reserva' });

    expect(text(within(summary).getByText('Cupom BRAVO10').closest('div'))).toBe(
      'Cupom BRAVO10− R$ 20,00',
    );
    expect(text(within(summary).getByText('Crédito aplicado').closest('div'))).toBe(
      'Crédito aplicado− R$ 40,00',
    );
    expect(text(within(summary).getByText('A pagar agora').closest('div'))).toBe(
      'A pagar agoraR$ 59,50',
    );
  });
});

describe('BookingSummary of a BookingDetail', () => {
  it('renders the same segment lines with the paid sinal date and the saldo due date', () => {
    render(<BookingSummary booking={bookingDetail} />);
    const rows = screen.getAllByText(/^(Total|Sinal|Saldo)/).map((dt) => dt.closest('div'));

    expect(items()[0]).toBe('17:30–19:00 · 2 horas ou mais · 1h30 × R$ 80,00 = R$ 120,00');
    expect(text(rows[0] ?? null)).toBe('TotalR$ 219,00');
    expect(text(rows[1] ?? null)).toBe('Sinalpago em 20/10/2026 09:03R$ 109,50');
    expect(text(rows[2] ?? null)).toBe('Saldovence em 26/10/2026 17:30R$ 109,50');
    expect(screen.getByText('27/10/2026 · 17:30–20:00')).toBeInTheDocument();
  });
});
