import { slotDiscountInput, type LocalDate } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Checkbox, Input } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { ApiError } from '../../lib/api';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { formatMinuteRange } from '../../lib/format';
import { TimeField } from '../admin-calendar/TimeField';
import { useRooms } from '../catalog/api';
import { useApplySlotDiscount } from '../purchases/api';
import type { SlotDiscountApplyResult } from '../purchases/types';
import type { SlotDiscountPrefill } from './slot-discount-request';

/** REC-135 text, used when the API answers the 409 without a message. */
const OVERLAP_MESSAGE = 'Já existe desconto neste horário';

export interface SlotDiscountDialogProps {
  prefill: SlotDiscountPrefill;
  onClose: () => void;
}

/**
 * "Aplicar desconto (%)" on free slots (REC-133..REC-135): rooms, date, range (from the hover or
 * the dragged selection) and percent; ends with what was created and what was skipped.
 */
export function SlotDiscountDialog({ prefill, onClose }: SlotDiscountDialogProps) {
  const rooms = useRooms();
  const apply = useApplySlotDiscount();
  const [roomIds, setRoomIds] = useState<string[]>(prefill.roomId ? [prefill.roomId] : []);
  const [date, setDate] = useState<string>(prefill.date);
  const [startMinute, setStartMinute] = useState(prefill.startMinute);
  const [endMinute, setEndMinute] = useState(prefill.endMinute);
  const [percent, setPercent] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{ percent: number; data: SlotDiscountApplyResult } | null>(
    null,
  );

  const roomName = (id: string) => rooms.data?.items.find((room) => room.id === id)?.name ?? 'Sala';

  const submit = () => {
    setFormError(null);
    const parsed = slotDiscountInput.safeParse({
      roomIds,
      date: date as LocalDate,
      startMinute,
      endMinute,
      percent: percent.trim() === '' ? Number.NaN : Number(percent.replace(',', '.')),
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
    apply.mutate(parsed.data, {
      onSuccess: (data) => {
        setResult({ percent: parsed.data.percent, data });
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else if (error instanceof ApiError && error.status === 409) {
          setFormError(error.message || OVERLAP_MESSAGE);
        } else setFormError(messageOf(error, 'Não foi possível aplicar o desconto.'));
      },
    });
  };

  if (result) {
    const { created, skipped } = result.data;
    return (
      <Modal open onClose={onClose} title="Desconto aplicado">
        <div className="space-y-space-md">
          {created.length > 0 ? (
            <Alert tone="success">
              {`${String(created.length)} ${created.length === 1 ? 'faixa de horário' : 'faixas de horário'} com desconto de ${String(result.percent)}%.`}
            </Alert>
          ) : (
            <Alert>Nenhum horário livre recebeu o desconto.</Alert>
          )}
          {skipped.length > 0 ? (
            <ul aria-label="Horários sem desconto" className="space-y-space-xs">
              {skipped.map((part) => (
                <li
                  key={`${part.roomId}-${String(part.startMinute)}`}
                  className="font-small text-small text-ink"
                >
                  {`${roomName(part.roomId)}: ${formatMinuteRange(part.startMinute, part.endMinute)} ocupado, sem desconto`}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Aplicar desconto (%)">
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="space-y-space-xs">
          <legend className="font-small text-small font-medium text-ink">Salas</legend>
          {(rooms.data?.items ?? []).map((room) => (
            <Checkbox
              key={room.id}
              label={room.name}
              checked={roomIds.includes(room.id)}
              onChange={(event) => {
                setRoomIds(
                  event.target.checked
                    ? [...roomIds, room.id]
                    : roomIds.filter((id) => id !== room.id),
                );
              }}
            />
          ))}
          {errors['roomIds'] ? (
            <p className="font-caption text-caption text-error">{errors['roomIds']}</p>
          ) : null}
        </fieldset>
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
          <TimeField
            label="Início"
            value={startMinute}
            error={errors['startMinute']}
            onCommit={setStartMinute}
          />
          <TimeField
            label="Fim"
            value={endMinute}
            error={errors['endMinute']}
            onCommit={setEndMinute}
          />
        </div>
        <Input
          label="Desconto (%)"
          type="number"
          min={1}
          max={100}
          inputMode="numeric"
          value={percent}
          error={errors['percent']}
          onChange={(event) => {
            setPercent(event.target.value);
          }}
        />
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={apply.isPending}>
            Aplicar desconto
          </Button>
        </div>
      </form>
    </Modal>
  );
}
