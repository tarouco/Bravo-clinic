import {
  adminCancelSchema,
  adminRescheduleSchema,
  confirmManualSchema,
  formatBRL,
  utcToLocal,
  type CalendarEvents,
  type LocalDate,
} from '@bravo/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { formatDuration } from '../../lib/format';
import { TimeField } from '../admin-calendar/TimeField';
import { availabilityKeys } from '../availability/api';
import { calendarKeys } from '../calendar/api';
import {
  reservationKeys,
  useAdminCancel,
  useAdminCancellationPreview,
  useAdminReschedule,
  useConfirmManual,
} from '../reservations/api';

export type CalendarBooking = CalendarEvents['bookings'][number];

/** Actions a booking popup offers; the first three open a dialog, the others run at once. */
export type BookingActionKind = 'confirm' | 'resend' | 'checkin' | 'reschedule' | 'cancel';

/**
 * Resend-link and check-in run from here, not from the popup: the popup unmounts when the
 * pointer leaves it, which would drop the success toast.
 */
export function useQuickActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
  };
  const resend = useMutation<unknown, Error, string>({
    mutationFn: (id) => api.post(`/api/admin/bookings/${id}/resend-link`, {}),
    onSuccess: () => {
      toast({ message: 'Link de pagamento reenviado ao cliente.' });
    },
    onError: (error) => {
      toast({ message: messageOf(error, 'Não foi possível reenviar o link.') });
    },
  });
  const checkIn = useMutation<unknown, Error, string>({
    mutationFn: (id) => api.post(`/api/admin/bookings/${id}/check-in`, {}),
    onSuccess: () => {
      toast({ message: 'Check-in registrado.' });
      refresh();
    },
    onError: (error) => {
      toast({ message: messageOf(error, 'Não foi possível registrar o check-in.') });
    },
  });
  return { resend, checkIn };
}

export interface BookingDialogProps {
  booking: CalendarBooking;
  onClose: () => void;
}

function ConfirmManualForm({ booking, onClose }: BookingDialogProps) {
  const confirm = useConfirmManual(booking.id);
  const { toast } = useToast();
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    const parsed = confirmManualSchema.safeParse({ justification });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe a justificativa.');
      return;
    }
    setError(undefined);
    confirm.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Reserva confirmada sem pagamento.' });
        onClose();
      },
      onError: (caught) => {
        setError(messageOf(caught, 'Não foi possível confirmar a reserva.'));
      },
    });
  };

  return (
    <div className="space-y-space-md">
      <p className="font-small text-small text-ink-muted">
        {booking.fullName} · {booking.roomName} · {booking.code}
      </p>
      <Textarea
        label="Justificativa"
        rows={3}
        value={justification}
        error={error}
        help="Fica registrada no log de auditoria."
        onChange={(event) => {
          setJustification(event.target.value);
        }}
      />
      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Voltar
        </Button>
        <Button loading={confirm.isPending} onClick={submit}>
          Confirmar sem pagamento
        </Button>
      </div>
    </div>
  );
}

/** Admin: confirms a pre-reservation or awaiting booking without payment (NUC-163). */
export function ConfirmManualDialog(props: BookingDialogProps) {
  return (
    <Modal open onClose={props.onClose} title="Confirmar reserva">
      <ConfirmManualForm {...props} />
    </Modal>
  );
}

const RESOLUTION_LABELS = {
  refund: 'Reembolsar o valor pago',
  credit: 'Converter em crédito',
  minutes: 'Devolver os minutos ao pacote',
} as const;

function CancelForm({ booking, onClose }: BookingDialogProps) {
  const preview = useAdminCancellationPreview(booking.id);
  const cancel = useAdminCancel(booking.id);
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState<keyof typeof RESOLUTION_LABELS | ''>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const data = preview.data;
  const options = data?.clinicOptions ?? [];
  const chosen = resolution || options[0] || '';

  const submit = () => {
    setFormError(null);
    const parsed = adminCancelSchema.safeParse({ reason, resolution: chosen });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    cancel.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Reserva cancelada.' });
        onClose();
      },
      onError: (caught) => {
        const fields = fieldErrorsOf(caught);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(caught, 'Não foi possível cancelar a reserva.'));
      },
    });
  };

  return (
    <div className="space-y-space-md">
      <p className="font-small text-small text-ink-muted">
        {booking.fullName} · {booking.roomName} · {booking.code}
      </p>
      {preview.isPending ? <Spinner label="Calculando o cancelamento" /> : null}
      {preview.isError ? (
        <Alert tone="error">{messageOf(preview.error, 'Não foi possível calcular.')}</Alert>
      ) : null}
      {data ? (
        <section aria-label="Resultado do cancelamento" className="space-y-space-xs">
          <p className="font-small text-small text-ink">
            Fica retido: {formatBRL(data.retainedCents)}
          </p>
          <p className="font-small text-small text-ink">
            Será devolvido: {formatBRL(data.refundCents)}
          </p>
          {data.minutesReturned > 0 ? (
            <p className="font-small text-small text-ink">
              Minutos devolvidos ao pacote: {formatDuration(data.minutesReturned)}
            </p>
          ) : null}
          {data.creditCents > 0 ? (
            <p className="font-small text-small text-ink">
              Crédito gerado: {formatBRL(data.creditCents)}
            </p>
          ) : null}
        </section>
      ) : null}
      {options.length > 0 ? (
        <Select
          label="Destino do valor pago"
          value={chosen}
          onChange={(event) => {
            setResolution(event.target.value as keyof typeof RESOLUTION_LABELS);
          }}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {RESOLUTION_LABELS[option]}
            </option>
          ))}
        </Select>
      ) : null}
      <Textarea
        label="Motivo"
        rows={3}
        maxLength={500}
        value={reason}
        error={errors['reason']}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Manter reserva
        </Button>
        <Button
          className="text-danger"
          variant="secondary"
          loading={cancel.isPending}
          disabled={!data}
          onClick={submit}
        >
          Confirmar cancelamento
        </Button>
      </div>
    </div>
  );
}

/** Admin: cancels a booking on the clinic's behalf with the refund preview (NUC-159). */
export function CancelBookingDialog(props: BookingDialogProps) {
  return (
    <Modal open onClose={props.onClose} title="Cancelar reserva">
      <CancelForm {...props} />
    </Modal>
  );
}

function RescheduleForm({ booking, onClose }: BookingDialogProps) {
  const reschedule = useAdminReschedule(booking.id);
  const { toast } = useToast();
  const start = utcToLocal(new Date(booking.startsAt));
  const end = utcToLocal(new Date(booking.endsAt));
  const [date, setDate] = useState<LocalDate>(start.date);
  const [startMinute, setStartMinute] = useState(start.minuteOfDay);
  const [endMinute, setEndMinute] = useState(
    end.date !== start.date && end.minuteOfDay === 0 ? 1440 : end.minuteOfDay,
  );
  const [exception, setException] = useState(false);
  const [waive, setWaive] = useState(false);
  const [justification, setJustification] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const parsed = adminRescheduleSchema.safeParse({
      roomId: booking.roomId,
      date,
      startMinute,
      endMinute,
      ...(exception ? { exception: true } : {}),
      ...(waive ? { differenceHandling: 'waive' } : {}),
      ...(justification.trim() ? { justification } : {}),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    reschedule.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Reserva reagendada.' });
        onClose();
      },
      onError: (caught) => {
        const fields = fieldErrorsOf(caught);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(caught, 'Não foi possível reagendar a reserva.'));
      },
    });
  };

  return (
    <div className="space-y-space-md">
      <p className="font-small text-small text-ink-muted">
        {booking.fullName} · {booking.roomName} · {booking.code}
      </p>
      <Input
        label="Nova data"
        type="date"
        value={date}
        error={errors['date']}
        onChange={(event) => {
          setDate(event.target.value as LocalDate);
        }}
      />
      <div className="grid gap-space-md sm:grid-cols-2">
        <TimeField label="Novo início" value={startMinute} onCommit={setStartMinute} />
        <TimeField
          label="Novo fim"
          value={endMinute}
          error={errors['endMinute']}
          onCommit={setEndMinute}
        />
      </div>
      <Checkbox
        label="Exceção à política de reagendamento"
        checked={exception}
        onChange={(event) => {
          setException(event.target.checked);
        }}
      />
      <Checkbox
        label="Dispensar a diferença de valor"
        checked={waive}
        onChange={(event) => {
          setWaive(event.target.checked);
        }}
      />
      {exception || waive ? (
        <Textarea
          label="Justificativa"
          rows={2}
          value={justification}
          error={errors['justification']}
          onChange={(event) => {
            setJustification(event.target.value);
          }}
        />
      ) : null}
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Voltar
        </Button>
        <Button loading={reschedule.isPending} onClick={submit}>
          Reagendar
        </Button>
      </div>
    </div>
  );
}

/** Admin: moves a booking to another date or time (NUC-159). */
export function RescheduleBookingDialog(props: BookingDialogProps) {
  return (
    <Modal open onClose={props.onClose} title="Reagendar reserva">
      <RescheduleForm {...props} />
    </Modal>
  );
}
