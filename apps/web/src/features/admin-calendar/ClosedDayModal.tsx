import { bookingStatusLabel, formatBRL, type AffectedBooking } from '@bravo/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Checkbox, Input } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { bookingWhen } from '../../lib/booking-time';
import { affectedBookingsOf, messageOf } from '../../lib/api-errors';
import { useClosedDayPreview, useCreateClosedDay } from '../calendar/api';
import { useRooms } from '../catalog/api';

export interface ClosedDayModalProps {
  open: boolean;
  onClose: () => void;
  /** Date selected on the calendar, if any. */
  defaultDate?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function BookingList({ bookings }: { bookings: readonly AffectedBooking[] }) {
  return (
    <ul aria-label="Reservas afetadas" className="space-y-space-xs">
      {bookings.map((booking) => (
        <li
          key={booking.id}
          className="rounded-md bg-surface-deboss px-space-md py-space-sm shadow-deboss font-small text-small"
        >
          <Link
            to={`/admin/reservas/lista?q=${encodeURIComponent(booking.code)}`}
            className="font-medium text-accent underline underline-offset-4"
          >
            {booking.code}
          </Link>{' '}
          · {booking.customerName} · {booking.roomName} ·{' '}
          {bookingWhen(booking.startsAt, booking.endsAt)} ({bookingStatusLabel[booking.status]})
        </li>
      ))}
    </ul>
  );
}

function ClosedDayForm({ onClose, defaultDate }: Omit<ClosedDayModalProps, 'open'>) {
  const rooms = useRooms();
  const create = useCreateClosedDay();
  const { toast } = useToast();
  const [date, setDate] = useState(defaultDate ?? '');
  const [wholeClinic, setWholeClinic] = useState(true);
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState<AffectedBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetIds = wholeClinic ? null : roomIds;
  const ready = DATE_PATTERN.test(date) && (wholeClinic || roomIds.length > 0);
  const preview = useClosedDayPreview(ready ? date : null, targetIds);
  const data = preview.data;
  const affected = data?.affectedBookings ?? [];
  const compensation = data?.compensation;
  const hasCompensation =
    compensation !== undefined &&
    (compensation.subscribers > 0 ||
      compensation.minutes > 0 ||
      compensation.creditCents > 0 ||
      compensation.fixedOccurrencesCancelled > 0);

  const confirm = () => {
    setError(null);
    setConflict(null);
    create.mutate(
      { date, roomIds: targetIds, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          toast({ message: 'Data fechada.' });
          onClose();
        },
        onError: (caught) => {
          const bookings = affectedBookingsOf(caught);
          if (bookings) setConflict(bookings);
          setError(messageOf(caught, 'Não foi possível fechar a data.'));
        },
      },
    );
  };

  return (
    <div className="space-y-space-md">
      <Input
        label="Data a fechar"
        type="date"
        value={date}
        onChange={(event) => {
          setDate(event.target.value);
        }}
      />
      <fieldset className="space-y-space-xs">
        <legend className="font-small text-small text-ink">Salas</legend>
        <Checkbox
          label="Toda a clínica"
          checked={wholeClinic}
          onChange={(event) => {
            setWholeClinic(event.target.checked);
          }}
        />
        {wholeClinic ? null : (
          <div className="flex flex-wrap gap-x-space-md gap-y-space-xs pl-space-lg">
            {(rooms.data?.items ?? []).map((room) => (
              <Checkbox
                key={room.id}
                label={room.name}
                checked={roomIds.includes(room.id)}
                onChange={(event) => {
                  setRoomIds((current) =>
                    event.target.checked
                      ? [...current, room.id]
                      : current.filter((id) => id !== room.id),
                  );
                }}
              />
            ))}
          </div>
        )}
      </fieldset>
      <Input
        label="Motivo (opcional)"
        maxLength={200}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />

      {ready && preview.isPending ? <Spinner label="Verificando a data" /> : null}
      {ready && preview.isError ? (
        <Alert tone="error">{messageOf(preview.error, 'Não foi possível verificar a data.')}</Alert>
      ) : null}
      {data ? (
        <section aria-label="Prévia do fechamento" className="space-y-space-sm">
          {affected.length > 0 ? (
            <>
              <Alert tone="error">
                Existem reservas afetadas. Realoque ou cancele antes de continuar.
              </Alert>
              <BookingList bookings={affected} />
            </>
          ) : (
            <p className="font-small text-small text-ink">Nenhuma reserva será afetada.</p>
          )}
          {hasCompensation ? (
            <div className="font-small text-small text-ink">
              <p className="font-medium">Compensação a conceder</p>
              <p>
                {compensation.subscribers}{' '}
                {compensation.subscribers === 1 ? 'assinante' : 'assinantes'} ·{' '}
                {compensation.minutes} min · {formatBRL(compensation.creditCents)}
              </p>
              {compensation.fixedOccurrencesCancelled > 0 ? (
                <p>
                  {compensation.fixedOccurrencesCancelled} ocorrências de horário fixo canceladas
                </p>
              ) : null}
            </div>
          ) : (
            <p className="font-small text-small text-ink-muted">Nenhuma compensação a conceder.</p>
          )}
        </section>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {conflict && conflict.length > 0 ? <BookingList bookings={conflict} /> : null}

      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          loading={create.isPending}
          disabled={!ready || !data || affected.length > 0}
          onClick={confirm}
        >
          Fechar data
        </Button>
      </div>
    </div>
  );
}

/**
 * Closes a date for the whole clinic or chosen rooms: lists the bookings that would be affected
 * and the compensation preview before confirming (NUC-52).
 */
export function ClosedDayModal({ open, onClose, defaultDate }: ClosedDayModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Fechar data">
      <ClosedDayForm onClose={onClose} {...(defaultDate ? { defaultDate } : {})} />
    </Modal>
  );
}
