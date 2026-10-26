import {
  blockCategoryCreateSchema,
  hourlyCategoryCreateSchema,
  parseBRLToCents,
} from '@bravo/core';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../components/ui/form';
import { FieldError } from '../../components/ui/form/Field';
import { useToast } from '../../components/ui/Toast';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { useCreateCategory } from '../categories/api';
import { TimeField } from './TimeField';

type Kind = 'hourly' | 'block';

const WEEKDAYS = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [7, 'Dom'],
] as const;

const MONEY_ERROR = 'Informe um valor, por exemplo 97,00.';

export interface CategoryFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

/** "Nova categoria" for Hora avulsa and Bloco avulso (NUC-71); package types are managed elsewhere. */
export function CategoryForm({ onCreated, onCancel }: CategoryFormProps) {
  const create = useCreateCategory();
  const { toast } = useToast();
  const [kind, setKind] = useState<Kind>('hourly');
  const [name, setName] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [appliesOnHolidays, setAppliesOnHolidays] = useState(true);
  const [startMinute, setStartMinute] = useState(0);
  const [endMinute, setEndMinute] = useState(1440);
  const [weekdayRate, setWeekdayRate] = useState('');
  const [weekendRate, setWeekendRate] = useState('');
  const [minDuration, setMinDuration] = useState('60');
  const [fixedPrice, setFixedPrice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setFormError(null);
    const next: Record<string, string> = {};
    const money = (text: string, key: string): number => {
      const cents = parseBRLToCents(text);
      if (cents === null || cents <= 0) {
        next[key] = MONEY_ERROR;
        return 0;
      }
      return cents;
    };
    const common = { name, weekdays, appliesOnHolidays, startMinute, endMinute };
    const draft =
      kind === 'hourly'
        ? {
            type: 'hourly' as const,
            ...common,
            weekdayRateCents: money(weekdayRate, 'weekdayRateCents'),
            weekendRateCents: money(weekendRate, 'weekendRateCents'),
            minDurationMinutes: Number(minDuration),
          }
        : {
            type: 'block' as const,
            ...common,
            fixedPriceCents: money(fixedPrice, 'fixedPriceCents'),
          };
    const parsed = (
      kind === 'hourly' ? hourlyCategoryCreateSchema : blockCategoryCreateSchema
    ).safeParse(draft);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
    }
    if (Object.keys(next).length > 0 || !parsed.success) {
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast({ message: 'Categoria criada.' });
        onCreated();
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível criar a categoria.'));
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
      <Select
        label="Tipo"
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as Kind);
          setErrors({});
        }}
      >
        <option value="hourly">Hora avulsa</option>
        <option value="block">Bloco avulso</option>
      </Select>
      <Input
        label="Nome da categoria"
        value={name}
        error={errors['name']}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
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
          <Checkbox
            label="Feriados"
            checked={appliesOnHolidays}
            onChange={(event) => {
              setAppliesOnHolidays(event.target.checked);
            }}
          />
        </div>
        {errors['weekdays'] ? <FieldError>{errors['weekdays']}</FieldError> : null}
      </fieldset>
      <div className="grid gap-space-md sm:grid-cols-2">
        <TimeField label="Início da janela" value={startMinute} onCommit={setStartMinute} />
        <TimeField
          label="Fim da janela"
          value={endMinute}
          error={errors['endMinute']}
          onCommit={setEndMinute}
        />
      </div>
      {kind === 'hourly' ? (
        <div className="grid gap-space-md sm:grid-cols-3">
          <Input
            label="Valor da hora (dia útil)"
            inputMode="decimal"
            placeholder="97,00"
            value={weekdayRate}
            error={errors['weekdayRateCents']}
            onChange={(event) => {
              setWeekdayRate(event.target.value);
            }}
          />
          <Input
            label="Valor da hora (fim de semana e feriados)"
            inputMode="decimal"
            placeholder="120,00"
            value={weekendRate}
            error={errors['weekendRateCents']}
            onChange={(event) => {
              setWeekendRate(event.target.value);
            }}
          />
          <Input
            label="Duração mínima (min)"
            type="number"
            inputMode="numeric"
            value={minDuration}
            error={errors['minDurationMinutes']}
            onChange={(event) => {
              setMinDuration(event.target.value);
            }}
          />
        </div>
      ) : (
        <Input
          label="Preço fixo do bloco"
          inputMode="decimal"
          placeholder="280,00"
          value={fixedPrice}
          error={errors['fixedPriceCents']}
          onChange={(event) => {
            setFixedPrice(event.target.value);
          }}
        />
      )}
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-space-sm">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={create.isPending}>
          Criar categoria
        </Button>
      </div>
    </form>
  );
}
