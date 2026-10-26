import { holidayCreateSchema, holidayScopeLabel, type HolidayScopeCode } from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { useCreateHoliday } from '../calendar/api';

const SCOPES = Object.keys(holidayScopeLabel) as HolidayScopeCode[];

export interface HolidayFormProps {
  open: boolean;
  onClose: () => void;
}

function Form({ onClose }: Omit<HolidayFormProps, 'open'>) {
  const create = useCreateHoliday();
  const { toast } = useToast();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<HolidayScopeCode>('optional');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const parsed = holidayCreateSchema.safeParse({ date, name, scope });
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
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Feriado adicionado.' });
        onClose();
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível adicionar o feriado.'));
      },
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
      <Input
        label="Data do feriado"
        type="date"
        value={date}
        error={errors['date']}
        onChange={(event) => {
          setDate(event.target.value);
        }}
      />
      <Input
        label="Nome do feriado"
        maxLength={120}
        value={name}
        error={errors['name']}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Select
        label="Tipo"
        value={scope}
        error={errors['scope']}
        onChange={(event) => {
          setScope(event.target.value as HolidayScopeCode);
        }}
      >
        {SCOPES.map((code) => (
          <option key={code} value={code}>
            {holidayScopeLabel[code]}
          </option>
        ))}
      </Select>
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={create.isPending}>
          Adicionar feriado
        </Button>
      </div>
    </form>
  );
}

/** Adds a manual holiday (for example Carnaval as "Ponto facultativo"), NUC-52. */
export function HolidayForm({ open, onClose }: HolidayFormProps) {
  return (
    <Modal open={open} onClose={onClose} title="Novo feriado">
      <Form onClose={onClose} />
    </Modal>
  );
}
