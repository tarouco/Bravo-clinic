import {
  formatBRL,
  utcToLocal,
  type BookingDetail,
  type ChargeIntent,
  type LocalDate,
  type RescheduleQuoteRequest,
} from '@bravo/core';
import { useState } from 'react';
import { DayStrip } from '../../components/booking/DayStrip';
import { SlotChips } from '../../components/booking/SlotChips';
import type { SlotSelection } from '../../components/calendar/SlotGrid';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../lib/api';
import { monthOf } from '../../lib/calendar-dates';
import { formatLocalDateBR } from '../../lib/format';
import { useMonthAvailability } from '../availability/api';
import { PaymentMethodPanel, type PayChoice } from '../payments/PaymentMethodPanel';
import { useReschedule, useRescheduleDayAvailability, useRescheduleQuote } from './api';

export interface RescheduleModalProps {
  booking: BookingDetail;
  open: boolean;
  onClose: () => void;
  /** The booking moved at once (200); `creditCents` is the credit granted by a cheaper slot. */
  onRescheduled: (result: { creditCents: number }) => void;
}

const EMPTY: SlotSelection = { startMinute: null, endMinute: null };

/**
 * Reschedule dialog (NUC-155): new day and time, the price of the new slot and either the credit
 * or the difference to pay now; a difference opens the payment panel (202 with a charge intent).
 */
export function RescheduleModal({ booking, open, onClose, onRescheduled }: RescheduleModalProps) {
  const today = utcToLocal(new Date()).date;
  const [month, setMonth] = useState(monthOf(today));
  const [date, setDate] = useState<LocalDate | null>(null);
  const [selection, setSelection] = useState<SlotSelection>(EMPTY);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthQuery = useMonthAvailability(booking.roomSlug, month);
  const dayQuery = useRescheduleDayAvailability(booking.id, date ?? undefined);
  const reschedule = useReschedule(booking.id);

  const request: RescheduleQuoteRequest | null =
    date && selection.startMinute !== null && selection.endMinute !== null
      ? {
          roomSlug: booking.roomSlug,
          date,
          startMinute: selection.startMinute,
          endMinute: selection.endMinute,
        }
      : null;
  const quote = useRescheduleQuote(booking.id, request);
  const settlement = quote.data?.settlement ?? null;
  const allowed = quote.data?.allowed === true && settlement !== null && request !== null;
  const payNow = settlement?.payNowCents ?? 0;
  const day = dayQuery.data;

  const submit = async (method?: PayChoice) => {
    if (!request) throw new Error('Escolha o novo horário.');
    return reschedule.mutateAsync({ body: { ...request, ...(method ?? {}) } });
  };

  const confirm = async () => {
    setError(null);
    if (payNow > 0) {
      setPaying(true);
      return;
    }
    try {
      const result = await submit();
      onRescheduled({ creditCents: 'creditCents' in result ? result.creditCents : 0 });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível reagendar. Tente novamente.',
      );
    }
  };

  const payDifference = async (choice: PayChoice): Promise<ChargeIntent> => {
    const result = await submit(choice);
    if ('charge' in result) return result.charge;
    // A difference that vanished before the confirmation moved the booking at once (200); the
    // panel has no charge to show, so the dialog closes and the rejection below is never seen.
    onRescheduled({ creditCents: result.creditCents });
    onClose();
    throw new Error('Reserva reagendada.');
  };

  return (
    <Modal open={open} onClose={onClose} title="Reagendar reserva">
      <div className="space-y-space-lg">
        <p className="font-small text-small text-ink-muted">
          {booking.roomName} · escolha o novo dia e horário.
        </p>
        <DayStrip
          month={month}
          days={monthQuery.data?.days ?? []}
          value={date}
          minMonth={monthOf(today)}
          hideBefore={today}
          onSelect={(next) => {
            setDate(next as LocalDate);
            setSelection(EMPTY);
            setPaying(false);
          }}
          onMonthChange={setMonth}
        />

        {date ? (
          <div className="space-y-space-sm">
            <h3 className="font-heading-mobile text-heading-mobile text-ink">
              Horários de {formatLocalDateBR(date)}
            </h3>
            {dayQuery.isPending ? (
              <Spinner label="Carregando horários" />
            ) : !day || day.closed || day.outOfRange ? (
              <Alert>Não há horários neste dia.</Alert>
            ) : (
              <SlotChips
                cells={day.cells}
                slotMinutes={day.slotMinutes}
                minBookingMinutes={day.minBookingMinutes}
                value={selection}
                onChange={(next) => {
                  setSelection(next);
                  setPaying(false);
                }}
              />
            )}
          </div>
        ) : null}

        {request && quote.isPending ? <Spinner label="Calculando o novo valor" /> : null}
        {request && quote.isError ? (
          <Alert tone="error">Não foi possível calcular o novo valor agora.</Alert>
        ) : null}
        {quote.data && !quote.data.allowed ? (
          <Alert tone="error">{quote.data.message ?? 'Este horário não pode ser usado.'}</Alert>
        ) : null}

        {allowed && quote.data?.newQuote && settlement ? (
          <section
            aria-label="Novo valor"
            className="space-y-space-xs rounded-md bg-surface-deboss p-space-md font-small text-small shadow-deboss"
          >
            <p className="text-ink">
              Novo valor da reserva: <strong>{formatBRL(settlement.newTotalCents)}</strong>
            </p>
            {settlement.creditCents > 0 ? (
              <p className="text-ink">
                Você recebe {formatBRL(settlement.creditCents)} em créditos
              </p>
            ) : null}
            {payNow > 0 ? (
              <p className="text-ink">Diferença a pagar agora: {formatBRL(payNow)}</p>
            ) : null}
            {payNow === 0 && settlement.creditCents === 0 ? (
              <p className="text-ink-muted">O valor da reserva não muda.</p>
            ) : null}
          </section>
        ) : null}

        {error ? <Alert tone="error">{error}</Alert> : null}

        {paying && payNow > 0 ? (
          <PaymentMethodPanel amountCents={payNow} onPay={payDifference} />
        ) : (
          <div className="bv-modal-actions flex-wrap">
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <Button
              disabled={!allowed}
              loading={reschedule.isPending}
              onClick={() => void confirm()}
            >
              Confirmar reagendamento
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
