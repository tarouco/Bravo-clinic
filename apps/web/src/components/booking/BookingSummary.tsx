import {
  formatBRL,
  formatDateTimeBR,
  utcToLocal,
  type BookingDetail,
  type Quote,
  type QuoteSegment,
} from '@bravo/core';
import { formatDuration, formatLocalDateBR, formatMinuteRange } from '../../lib/format';
import { cx } from '../ui/cx';

export type BookingSummaryProps = { className?: string } & (
  { quote: Quote; booking?: never } | { booking: BookingDetail; quote?: never }
);

/** "17:30–19:00 · 2 horas ou mais · 1h30 × R$ 80,00 = R$ 120,00" (NUC-100). */
export function segmentLine(segment: QuoteSegment): string {
  const rate = segment.rateCentsPerHour === null ? '' : ` × ${formatBRL(segment.rateCentsPerHour)}`;
  return `${formatMinuteRange(segment.startMinute, segment.endMinute)} · ${segment.categoryName} · ${formatDuration(segment.minutes)}${rate} = ${formatBRL(segment.amountCents)}`;
}

interface Normalized {
  roomName: string;
  when: string;
  segments: QuoteSegment[];
  discount: { label: string; cents: number } | null;
  extras: { label: string; cents: number }[];
  packageLabel: string | null;
  creditCents: number;
  totalCents: number;
  mode: 'deposit_balance' | 'other';
  depositCents: number;
  depositNote: string;
  balanceCents: number;
  balanceNote: string;
  payNowCents: number | null;
}

function fromQuote(quote: Quote): Normalized {
  const label = (kind: 'extra' | 'package') => quote.lines.filter((line) => line.kind === kind);
  return {
    roomName: quote.roomName,
    when: `${formatLocalDateBR(quote.date)} · ${formatMinuteRange(quote.startMinute, quote.endMinute)}`,
    segments: quote.segments,
    discount:
      quote.discount.cents > 0
        ? { label: quote.discount.label ?? 'Desconto', cents: quote.discount.cents }
        : null,
    extras: label('extra').map((line) => ({ label: line.label, cents: line.amountCents ?? 0 })),
    packageLabel: label('package')[0]?.label ?? null,
    creditCents: quote.payment.creditUsedCents,
    totalCents: quote.netCents,
    mode: quote.payment.mode === 'deposit_balance' ? 'deposit_balance' : 'other',
    depositCents: quote.payment.depositCents,
    depositNote: 'pagamento agora',
    balanceCents: quote.payment.balanceCents,
    balanceNote: quote.payment.balanceChargeAt
      ? `cobrado em ${formatDateTimeBR(new Date(quote.payment.balanceChargeAt))}`
      : '',
    payNowCents: quote.payment.payNowCents,
  };
}

function fromBooking(booking: BookingDetail): Normalized {
  const start = utcToLocal(new Date(booking.startsAt));
  const end = utcToLocal(new Date(booking.endsAt));
  const deposit = booking.charges.find((c) => c.purpose === 'booking_deposit' && c.approvedAt);
  return {
    roomName: booking.roomName,
    when: `${formatLocalDateBR(start.date)} · ${formatMinuteRange(start.minuteOfDay, end.minuteOfDay === 0 ? 1440 : end.minuteOfDay)}`,
    segments: booking.segments,
    discount:
      booking.discountCents > 0
        ? {
            label: booking.discountSource === 'coupon' ? 'Cupom' : 'Desconto',
            cents: booking.discountCents,
          }
        : null,
    extras: [],
    packageLabel: booking.paymentMode === 'package' ? 'Pago com pacote de horas' : null,
    creditCents: booking.creditAppliedCents,
    totalCents: booking.totalCents,
    mode: booking.paymentMode === 'deposit_balance' ? 'deposit_balance' : 'other',
    depositCents: booking.depositCents,
    depositNote: deposit?.approvedAt
      ? `pago em ${formatDateTimeBR(new Date(deposit.approvedAt))}`
      : 'pendente',
    balanceCents: booking.balanceCents,
    balanceNote: booking.balanceDueAt
      ? `vence em ${formatDateTimeBR(new Date(booking.balanceDueAt))}`
      : '',
    payNowCents: null,
  };
}

function Row({
  label,
  note,
  cents,
  strong,
  negative,
  highlight,
}: {
  label: string;
  note?: string;
  cents: number;
  strong?: boolean;
  negative?: boolean;
  /** The total: the gold price pill of the summary (DESIGN-v3.md). */
  highlight?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex items-baseline justify-between gap-space-md',
        strong && 'font-medium',
        highlight &&
          'items-center rounded-pill bg-grad-gold px-space-md py-space-sm text-on-gold shadow-relief-gold',
      )}
    >
      <dt className={highlight ? 'text-on-gold' : 'text-ink-muted'}>
        {label}
        {note ? <span className="block text-caption">{note}</span> : null}
      </dt>
      <dd
        className={cx(
          'shrink-0',
          highlight ? 'font-display text-heading-mobile text-on-gold' : 'text-ink',
        )}
      >
        {negative ? '− ' : ''}
        {formatBRL(cents)}
      </dd>
    </div>
  );
}

/**
 * The calculation memory of a price quote or a booking: one line per segment, discounts, extras,
 * credit, total, sinal and saldo with their dates (NUC-100).
 */
export function BookingSummary({ quote, booking, className }: BookingSummaryProps) {
  const s = quote ? fromQuote(quote) : fromBooking(booking);
  return (
    <section
      aria-label="Resumo da reserva"
      className={cx('bv-card space-y-space-md font-small text-small', className)}
    >
      <div>
        <p className="font-heading-mobile text-heading-mobile text-ink">{s.roomName}</p>
        <p className="text-ink-muted">{s.when}</p>
      </div>
      <ul className="space-y-space-xs text-ink">
        {s.segments.map((segment) => (
          <li key={`${String(segment.startMinute)}-${segment.categoryName}`}>
            {segmentLine(segment)}
          </li>
        ))}
      </ul>
      <dl className="space-y-space-xs border-t border-hairline pt-space-md">
        {s.discount ? <Row label={s.discount.label} cents={s.discount.cents} negative /> : null}
        {s.extras.map((extra) => (
          <Row key={extra.label} label={extra.label} cents={extra.cents} />
        ))}
        {s.creditCents > 0 ? <Row label="Crédito aplicado" cents={s.creditCents} negative /> : null}
        <Row label="Total" cents={s.totalCents} strong highlight />
        {s.packageLabel ? (
          <div className="text-ink-muted">{s.packageLabel}</div>
        ) : s.mode === 'deposit_balance' ? (
          <>
            <Row label="Sinal" note={s.depositNote} cents={s.depositCents} />
            <Row label="Saldo" note={s.balanceNote} cents={s.balanceCents} />
          </>
        ) : null}
        {s.payNowCents !== null && s.payNowCents !== s.depositCents && !s.packageLabel ? (
          <Row label="A pagar agora" cents={s.payNowCents} strong />
        ) : null}
      </dl>
    </section>
  );
}
