import {
  blockCreateSchema,
  blockRecurrenceCreateSchema,
  weekdayOf,
  type LocalDate,
} from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../components/ui/form';
import { FieldError } from '../../components/ui/form/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { TimeField } from '../admin-calendar/TimeField';
import { useSession } from '../auth/useSession';
import { useCreateBlocks, useCreateRecurrence } from '../calendar/api';
import { useRooms } from '../catalog/api';

const PRESETS = ['Limpeza', 'Indisponível'] as const;
const CUSTOM = 'custom';

const WEEKDAYS = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [7, 'Dom'],
] as const;

export interface BlockDefaults {
  roomIds?: readonly string[];
  date?: LocalDate;
  startMinute?: number;
  endMinute?: number;
}

export interface BlockModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled values (a free slot of the calendar). */
  defaults?: BlockDefaults;
}

/** Dates the API names in `details.dates` of a recurrence 409. */
function conflictDatesOf(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'SLOT_TAKEN') return [];
  const dates = (error.details as { dates?: unknown } | undefined)?.dates;
  return Array.isArray(dates) ? dates.filter((d): d is string => typeof d === 'string') : [];
}

function BlockForm({ onClose, defaults = {} }: Omit<BlockModalProps, 'open'>) {
  const rooms = useRooms();
  const { session } = useSession();
  const canRepeat = session?.role === 'admin';
  const createOne = useCreateBlocks();
  const createWeekly = useCreateRecurrence();
  const { toast } = useToast();

  const [preset, setPreset] = useState<string>(PRESETS[0]);
  const [custom, setCustom] = useState('');
  const [roomIds, setRoomIds] = useState<string[]>([...(defaults.roomIds ?? [])]);
  const [date, setDate] = useState<string>(defaults.date ?? '');
  const [startMinute, setStartMinute] = useState(defaults.startMinute ?? 540);
  const [endMinute, setEndMinute] = useState(defaults.endMinute ?? 600);
  const [weekly, setWeekly] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>(
    defaults.date ? [weekdayOf(defaults.date)] : [],
  );
  const [validUntil, setValidUntil] = useState('');
  const [skipConflicts, setSkipConflicts] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflictDates, setConflictDates] = useState<string[]>([]);

  const tag = preset === CUSTOM ? custom : preset;
  const pending = createOne.isPending || createWeekly.isPending;

  const fail = (error: unknown) => {
    const fields = fieldErrorsOf(error);
    if (Object.keys(fields).length > 0) setErrors(fields);
    else setFormError(messageOf(error, 'Não foi possível criar o bloqueio.'));
    setConflictDates(conflictDatesOf(error));
  };

  const submit = () => {
    setFormError(null);
    setConflictDates([]);
    const issues: Record<string, string> = {};
    const collect = (error: { issues: { path: PropertyKey[]; message: string }[] }) => {
      for (const issue of error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in issues)) issues[key] = issue.message;
      }
    };
    if (weekly) {
      const parsed = blockRecurrenceCreateSchema.safeParse({
        roomIds,
        tag,
        weekdays,
        startMinute,
        endMinute,
        validFrom: date,
        ...(validUntil ? { validUntil } : {}),
        ...(skipConflicts ? { skipConflicts: true } : {}),
      });
      if (!parsed.success) {
        collect(parsed.error);
        setErrors(issues);
        return;
      }
      setErrors({});
      createWeekly.mutate(parsed.data, {
        onSuccess: (result) => {
          toast({
            message: `Bloqueio semanal criado: ${String(result.created)} datas bloqueadas.`,
          });
          onClose();
        },
        onError: fail,
      });
      return;
    }
    const parsed = blockCreateSchema.safeParse({ roomIds, tag, date, startMinute, endMinute });
    if (!parsed.success) {
      collect(parsed.error);
      setErrors(issues);
      return;
    }
    setErrors({});
    createOne.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Bloqueio criado.' });
        onClose();
      },
      onError: fail,
    });
  };

  return (
    <form
      className="space-y-space-md"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Select
        label="Motivo do bloqueio"
        value={preset}
        onChange={(event) => {
          setPreset(event.target.value);
        }}
      >
        {PRESETS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={CUSTOM}>Outro (texto livre)</option>
      </Select>
      {preset === CUSTOM ? (
        <Input
          label="Texto do bloqueio"
          maxLength={60}
          value={custom}
          error={errors['tag']}
          onChange={(event) => {
            setCustom(event.target.value);
          }}
        />
      ) : null}

      <fieldset className="space-y-space-xs">
        <legend className="font-small text-small text-ink">Salas</legend>
        <div className="flex flex-wrap gap-x-space-md gap-y-space-xs">
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
        {errors['roomIds'] ? <FieldError>{errors['roomIds']}</FieldError> : null}
      </fieldset>

      <Input
        label={weekly ? 'A partir de' : 'Data'}
        type="date"
        value={date}
        error={errors['date'] ?? errors['validFrom']}
        onChange={(event) => {
          setDate(event.target.value);
        }}
      />
      <div className="grid gap-space-md sm:grid-cols-2">
        <TimeField label="Início" value={startMinute} onCommit={setStartMinute} />
        <TimeField
          label="Fim"
          value={endMinute}
          error={errors['endMinute']}
          onCommit={setEndMinute}
        />
      </div>

      {canRepeat ? (
        <div className="space-y-space-sm">
          <Checkbox
            label="Repetir semanalmente"
            checked={weekly}
            onChange={(event) => {
              setWeekly(event.target.checked);
            }}
          />
          {weekly ? (
            <div className="space-y-space-sm rounded-md bg-surface-deboss p-space-md shadow-deboss">
              <fieldset className="space-y-space-xs">
                <legend className="font-small text-small text-ink">Dias da semana</legend>
                <div className="flex flex-wrap gap-x-space-md gap-y-space-xs">
                  {WEEKDAYS.map(([day, label]) => (
                    <Checkbox
                      key={day}
                      label={label}
                      checked={weekdays.includes(day)}
                      onChange={(event) => {
                        setWeekdays((current) =>
                          event.target.checked
                            ? [...current, day].sort((a, b) => a - b)
                            : current.filter((d) => d !== day),
                        );
                      }}
                    />
                  ))}
                </div>
                {errors['weekdays'] ? <FieldError>{errors['weekdays']}</FieldError> : null}
              </fieldset>
              <Input
                label="Repetir até (opcional)"
                type="date"
                value={validUntil}
                error={errors['validUntil']}
                onChange={(event) => {
                  setValidUntil(event.target.value);
                }}
              />
              <Checkbox
                label="Pular datas com reserva ou bloqueio"
                checked={skipConflicts}
                onChange={(event) => {
                  setSkipConflicts(event.target.checked);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {formError ? <Alert tone="error">{formError}</Alert> : null}
      {conflictDates.length > 0 ? (
        <Alert tone="info">Datas com conflito: {conflictDates.join(', ')}.</Alert>
      ) : null}

      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Bloquear horário
        </Button>
      </div>
    </form>
  );
}

/** "Bloquear": preset or free-text tag, rooms, date and times; admins may repeat weekly (NUC-60). */
export function BlockModal({ open, onClose, defaults }: BlockModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Bloquear horário">
      <BlockForm onClose={onClose} {...(defaults ? { defaults } : {})} />
    </Modal>
  );
}
