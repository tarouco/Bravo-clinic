import { calendarSettingsSchema, type CalendarConfig, type CalendarSettings } from '@bravo/core';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/form';
import { useToast } from '../../components/ui/Toast';
import { affectedBookingsOf, fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { ApiError } from '../../lib/api';
import { useUpdateCalendarSettings } from '../calendar/api';
import { AffectedBookingsModal } from './AffectedBookingsModal';

const SLOT_OPTIONS = [5, 10, 15, 20, 30, 60] as const;

type Form = Record<keyof CalendarSettings, string>;
type Warnings = CalendarConfig['warnings'];

const toForm = (settings: CalendarSettings): Form => ({
  slotMinutes: String(settings.slotMinutes),
  defaultBookingMinutes: String(settings.defaultBookingMinutes),
  cleanupMinutes: String(settings.cleanupMinutes),
  minAdvanceMinutes: String(settings.minAdvanceMinutes),
  maxAdvanceDays: String(settings.maxAdvanceDays),
});

/** "A limpeza de 45 min não é múltipla do slot de 30 min: 15 min vendáveis perdidos por reserva." */
export function cleanupWarningText(settings: CalendarSettings, lostMinutesPerBooking: number) {
  return `A limpeza de ${String(settings.cleanupMinutes)} min não é múltipla do slot de ${String(settings.slotMinutes)} min: ${String(lostMinutesPerBooking)} min vendáveis perdidos por reserva.`;
}

export interface CalendarSettingsPanelProps {
  settings: CalendarSettings;
  warnings: Warnings;
}

/** Slot size, default duration, cleanup and advance limits (NUC-41). */
export function CalendarSettingsPanel({ settings, warnings }: CalendarSettingsPanelProps) {
  const update = useUpdateCalendarSettings();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(toForm(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ settings: CalendarSettings; warnings: Warnings } | null>(
    null,
  );
  const [conflict, setConflict] = useState<{
    message: string;
    bookings: NonNullable<ReturnType<typeof affectedBookingsOf>>;
  } | null>(null);

  useEffect(() => {
    setForm(toForm(settings));
    setSaved(null);
  }, [settings]);

  const shown = saved ?? { settings, warnings };

  const submit = () => {
    setFormError(null);
    const parsed = calendarSettingsSchema.safeParse({
      slotMinutes: Number(form.slotMinutes),
      defaultBookingMinutes: Number(form.defaultBookingMinutes),
      cleanupMinutes: Number(form.cleanupMinutes),
      minAdvanceMinutes: Number(form.minAdvanceMinutes),
      maxAdvanceDays: Number(form.maxAdvanceDays),
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
    update.mutate(parsed.data, {
      onSuccess: (result) => {
        setSaved(result);
        toast({ message: 'Parâmetros do calendário salvos.' });
      },
      onError: (error) => {
        const bookings = affectedBookingsOf(error);
        if (bookings) {
          setConflict({ message: error instanceof ApiError ? error.message : '', bookings });
          return;
        }
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível salvar. Tente novamente.'));
      },
    });
  };

  const field = (key: keyof CalendarSettings) => ({
    value: form[key],
    error: errors[key],
    onChange: (event: { target: { value: string } }) => {
      setForm((current) => ({ ...current, [key]: event.target.value }));
    },
  });

  return (
    <section aria-labelledby="settings-title" className="space-y-space-md">
      <h2 id="settings-title" className="font-heading text-heading-mobile text-ink">
        Parâmetros do calendário
      </h2>
      <div className="grid gap-space-md sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Granularidade do slot" {...field('slotMinutes')}>
          {SLOT_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} min
            </option>
          ))}
        </Select>
        <Input
          label="Duração padrão da reserva (min)"
          type="number"
          inputMode="numeric"
          {...field('defaultBookingMinutes')}
        />
        <Input
          label="Limpeza entre reservas (min)"
          type="number"
          inputMode="numeric"
          {...field('cleanupMinutes')}
        />
        <Input
          label="Antecedência mínima (min)"
          type="number"
          inputMode="numeric"
          {...field('minAdvanceMinutes')}
        />
        <Input
          label="Antecedência máxima (dias)"
          type="number"
          inputMode="numeric"
          {...field('maxAdvanceDays')}
        />
      </div>

      {shown.warnings.map((warning) => (
        <Alert key={warning.code} tone="info">
          {cleanupWarningText(shown.settings, warning.lostMinutesPerBooking)}
        </Alert>
      ))}
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <Button loading={update.isPending} onClick={submit}>
        Salvar parâmetros
      </Button>

      <AffectedBookingsModal
        open={conflict !== null}
        onClose={() => {
          setConflict(null);
        }}
        title="Reservas em conflito"
        message={conflict?.message || 'Realoque ou cancele estas reservas antes de continuar.'}
        bookings={conflict?.bookings ?? []}
      />
    </section>
  );
}
