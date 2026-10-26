import { staffCreateBookingSchema, type LocalDate } from '@bravo/core';
import { useState } from 'react';
import { BookingSummary } from '../../components/booking/BookingSummary';
import { Button } from '../../components/ui/Button';
import { CopyField } from '../../components/ui/CopyField';
import { Drawer } from '../../components/ui/Drawer';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/form';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { TimeField } from '../admin-calendar/TimeField';
import { useSession } from '../auth/useSession';
import { useAdminDayAvailability } from '../calendar/api';
import { usePolicies, useRooms } from '../catalog/api';
import { useQuote } from '../booking/api';
import { useStaffCreateBooking } from '../reservations/api';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';
import type { CreateKind } from './FreeSlotMenu';

/** What the drawer opens with: a free slot of the calendar or nothing. */
export interface CreateRequest {
  kind: CreateKind;
  roomId?: string;
  date?: LocalDate;
  startMinute?: number;
  endMinute?: number;
}

const DEFAULT_EXPIRY_HOURS = 24;

function CreateForm({ request, onClose }: { request: CreateRequest; onClose: () => void }) {
  const { session } = useSession();
  const isAdmin = session?.role === 'admin';
  const rooms = useRooms();
  const policies = usePolicies();
  const create = useStaffCreateBooking();
  const isPre = request.kind === 'pre_reservation';

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [roomId, setRoomId] = useState(request.roomId ?? '');
  const [date, setDate] = useState<string>(request.date ?? '');
  const [startMinute, setStartMinute] = useState(request.startMinute ?? 540);
  const [endMinute, setEndMinute] = useState(request.endMinute ?? 600);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [justification, setJustification] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string | null } | null>(null);

  const room = rooms.data?.items.find((r) => r.id === roomId);
  const policyExpiry = policies.data?.values['payment.pre_reservation_expiry_hours'];
  const expiryHours = expiry ?? String(policyExpiry ?? DEFAULT_EXPIRY_HOURS);

  const dateReady = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const day = useAdminDayAvailability(roomId || undefined, dateReady ? date : undefined);
  let availabilityError: string | null = null;
  if (endMinute <= startMinute) {
    availabilityError = 'O fim precisa ser depois do início.';
  } else if (day.data) {
    const start = day.data.cells.find((cell) => cell.startMinute === startMinute);
    if (day.data.closed) availabilityError = 'A clínica está fechada nesta data.';
    else if (endMinute - startMinute < day.data.minBookingMinutes) {
      availabilityError = `A reserva precisa ter pelo menos ${String(day.data.minBookingMinutes)} min.`;
    } else if (!start?.available || start.maxEndMinute === null || endMinute > start.maxEndMinute) {
      availabilityError = 'Horário indisponível: ocupado, em limpeza ou bloqueado.';
    }
  }
  const intervalOk =
    room !== undefined && dateReady && day.data !== undefined && !availabilityError;
  const quote = useQuote(
    intervalOk ? { roomSlug: room.slug, date: date as LocalDate, startMinute, endMinute } : null,
  );

  const submit = () => {
    setFormError(null);
    const parsed = staffCreateBookingSchema.safeParse({
      userId: customer?.id,
      roomId,
      date,
      startMinute,
      endMinute,
      kind: request.kind,
      ...(isPre ? { expiresInHours: Number(expiryHours) } : {}),
      ...(manual ? { confirmManually: true, justification } : {}),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
      if (next['userId']) next['userId'] = 'Escolha o cliente.';
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (booking) => {
        setLink({ url: booking.paymentLink });
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível criar a reserva.'));
      },
    });
  };

  if (link) {
    return (
      <div className="space-y-space-md">
        <Alert tone="success">
          {isPre ? 'Pré-reserva criada.' : 'Reserva criada.'}
          {link.url ? ' O link de pagamento também foi enviado por e-mail.' : ''}
        </Alert>
        {link.url ? (
          <CopyField label="Link de pagamento" value={link.url} buttonLabel="Copiar link" />
        ) : null}
        <div className="flex justify-end">
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-space-md"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <CustomerPicker value={customer} onChange={setCustomer} />
        {errors['userId'] ? (
          <p className="mt-space-xs font-caption text-caption text-error">{errors['userId']}</p>
        ) : null}
      </div>
      <Select
        label="Sala"
        value={roomId}
        error={errors['roomId']}
        onChange={(event) => {
          setRoomId(event.target.value);
        }}
      >
        <option value="">Escolha a sala</option>
        {(rooms.data?.items ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <Input
        label="Data"
        type="date"
        value={date}
        error={errors['date']}
        onChange={(event) => {
          setDate(event.target.value);
        }}
      />
      <div className="grid gap-space-md sm:grid-cols-2">
        <TimeField label="Início" value={startMinute} onCommit={setStartMinute} />
        <TimeField
          label="Fim"
          value={endMinute}
          onCommit={setEndMinute}
          error={errors['endMinute']}
        />
      </div>
      {availabilityError ? <Alert tone="error">{availabilityError}</Alert> : null}
      {intervalOk && quote.isPending ? <Spinner label="Calculando o valor" /> : null}
      {quote.isError ? (
        <Alert tone="error">{messageOf(quote.error, 'Não foi possível calcular o valor.')}</Alert>
      ) : null}
      {intervalOk && quote.data ? <BookingSummary quote={quote.data} /> : null}

      {isPre ? (
        <Input
          label="Validade da pré-reserva (horas)"
          type="number"
          inputMode="numeric"
          min={1}
          max={720}
          value={expiryHours}
          error={errors['expiresInHours']}
          onChange={(event) => {
            setExpiry(event.target.value);
          }}
        />
      ) : null}

      {isAdmin && !isPre ? (
        <div className="space-y-space-sm">
          <Checkbox
            label="Confirmar sem pagamento"
            checked={manual}
            onChange={(event) => {
              setManual(event.target.checked);
            }}
          />
          {manual ? (
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
        </div>
      ) : null}

      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={create.isPending} disabled={Boolean(availabilityError)}>
          {isPre ? 'Criar pré-reserva' : 'Criar reserva'}
        </Button>
      </div>
    </form>
  );
}

export interface CreateBookingDrawerProps {
  request: CreateRequest | null;
  onClose: () => void;
}

/**
 * Staff drawer to create a booking or pre-reservation for a customer: customer search or
 * registration, room, date and times validated against the admin availability, the quote, the
 * pre-reservation expiry and (admin) manual confirmation; ends with the copyable payment link
 * (NUC-170).
 */
export function CreateBookingDrawer({ request, onClose }: CreateBookingDrawerProps) {
  return (
    <Drawer
      open={request !== null}
      onClose={onClose}
      title={request?.kind === 'pre_reservation' ? 'Criar pré-reserva' : 'Criar reserva'}
    >
      {request ? <CreateForm request={request} onClose={onClose} /> : null}
    </Drawer>
  );
}
