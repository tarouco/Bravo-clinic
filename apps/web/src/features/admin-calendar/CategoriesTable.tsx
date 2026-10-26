import {
  categoryAverageHourlyCents,
  formatBRL,
  parseBRLToCents,
  type AdminCategory,
  type CategoryUpdateInput,
} from '@bravo/core';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cx, focusRing } from '../../components/ui/cx';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { FieldError } from '../../components/ui/form/Field';
import { controlClasses } from '../../components/ui/form/controls';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { Slot } from '../../extensions/slots';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { formatWeekdays } from '../../lib/format';
import {
  useCategories,
  useReorderCategories,
  useSetReferenceCategory,
  useUpdateCategory,
} from '../categories/api';
import { centsToInput } from './category-utils';
import { CategoryForm } from './CategoryForm';
import { formatHHMM } from './time';

const TYPE_LABELS: Record<AdminCategory['type'], string> = {
  hourly: 'Hora avulsa',
  block: 'Bloco avulso',
  hour_package: 'Pacote de horas',
  fixed_schedule: 'Horário fixo',
};

const MONEY_ERROR = 'Informe um valor, por exemplo 97,00.';

/** Cents behind a typed price, or null while the text is not a positive BRL amount. */
function typedCents(text: string): number | null {
  const cents = parseBRLToCents(text);
  return cents !== null && cents > 0 ? cents : null;
}

/** The price a package category sells for, shown read-only. */
function managedPriceCents(c: AdminCategory): number | null {
  return c.fixedPriceCents ?? c.pricePerOccurrenceCents;
}

interface RowProps {
  category: AdminCategory;
  index: number;
  total: number;
  onMove: (index: number, delta: -1 | 1) => void;
  onReference: (category: AdminCategory) => void;
  busy: boolean;
}

function CategoryRow({ category: c, index, total, onMove, onReference, busy }: RowProps) {
  const update = useUpdateCategory(c.id);
  const { toast } = useToast();
  const [name, setName] = useState(c.name);
  const [weekday, setWeekday] = useState(centsToInput(c.weekdayRateCents ?? 0));
  const [weekend, setWeekend] = useState(centsToInput(c.weekendRateCents ?? 0));
  const [fixed, setFixed] = useState(centsToInput(c.fixedPriceCents ?? 0));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<string | null>(null);

  const isHourly = c.type === 'hourly';
  const isBlock = c.type === 'block';
  const editable = c.editable && (isHourly || isBlock);

  const weekdayCents = typedCents(weekday);
  const weekendCents = typedCents(weekend);
  const fixedCents = typedCents(fixed);

  const patch: CategoryUpdateInput = {};
  if (name.trim() !== c.name) patch.name = name.trim();
  if (isHourly) {
    if (weekdayCents !== null && weekdayCents !== c.weekdayRateCents)
      patch.weekdayRateCents = weekdayCents;
    if (weekendCents !== null && weekendCents !== c.weekendRateCents)
      patch.weekendRateCents = weekendCents;
  }
  if (isBlock && fixedCents !== null && fixedCents !== c.fixedPriceCents) {
    patch.fixedPriceCents = fixedCents;
  }
  const valid = isHourly
    ? weekdayCents !== null && weekendCents !== null
    : isBlock
      ? fixedCents !== null
      : true;
  const dirty = Object.keys(patch).length > 0;

  const average = isHourly
    ? weekdayCents === null
      ? null
      : weekdayCents
    : isBlock
      ? fixedCents === null
        ? null
        : categoryAverageHourlyCents({ ...c, type: 'block', fixedPriceCents: fixedCents })
      : c.averageHourlyCents;

  const save = () => {
    setErrors({});
    setRowError(null);
    update.mutate(patch, {
      onSuccess: () => {
        toast({ message: `Categoria "${c.name}" salva.` });
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        const known = ['name', 'weekdayRateCents', 'weekendRateCents', 'fixedPriceCents'];
        const mine = Object.fromEntries(
          Object.entries(fields).filter(([key]) => known.includes(key)),
        );
        if (Object.keys(mine).length > 0) setErrors(mine);
        else setRowError(messageOf(error, 'Não foi possível salvar a categoria.'));
      },
    });
  };

  const toggleStatus = (active: boolean) => {
    setRowError(null);
    update.mutate(
      { status: active ? 'active' : 'inactive' },
      {
        onError: (error) => setRowError(messageOf(error, 'Não foi possível alterar a categoria.')),
      },
    );
  };

  const priceInput = (
    label: string,
    value: string,
    set: (v: string) => void,
    errorKey: string,
    cents: number | null,
  ) => (
    <div>
      <label className="block font-caption text-caption text-ink-muted">
        {label}
        <input
          inputMode="decimal"
          value={value}
          aria-label={`${label} de ${c.name}`}
          onChange={(event) => {
            set(event.target.value);
          }}
          className={cx(
            controlClasses(cents === null || Boolean(errors[errorKey])),
            'mt-1 h-9 w-28 px-space-sm text-small',
          )}
        />
      </label>
      {cents === null ? <FieldError>{MONEY_ERROR}</FieldError> : null}
      {errors[errorKey] ? <FieldError>{errors[errorKey]}</FieldError> : null}
    </div>
  );

  return (
    <tr className="border-b border-hairline/60 align-top last:border-b-0">
      <td className="px-space-sm py-space-sm">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={`Subir ${c.name}`}
            disabled={busy || index === 0}
            onClick={() => {
              onMove(index, -1);
            }}
            className={cx('rounded p-1 text-bronze disabled:opacity-30', focusRing)}
          >
            <Icon as={ArrowUp} size={16} />
          </button>
          <button
            type="button"
            aria-label={`Descer ${c.name}`}
            disabled={busy || index === total - 1}
            onClick={() => {
              onMove(index, 1);
            }}
            className={cx('rounded p-1 text-bronze disabled:opacity-30', focusRing)}
          >
            <Icon as={ArrowDown} size={16} />
          </button>
        </div>
      </td>
      <td className="px-space-sm py-space-sm">
        {editable ? (
          <>
            <input
              value={name}
              aria-label={`Nome de ${c.name}`}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className={cx(
                controlClasses(Boolean(errors['name'])),
                'h-9 w-48 px-space-sm text-small',
              )}
            />
            {errors['name'] ? <FieldError>{errors['name']}</FieldError> : null}
          </>
        ) : (
          <span className="font-medium">{c.name}</span>
        )}
        <p className="mt-1 font-caption text-caption text-ink-muted">
          {TYPE_LABELS[c.type]} · {formatWeekdays(c.weekdays, c.appliesOnHolidays)} ·{' '}
          {formatHHMM(c.startMinute)}–{formatHHMM(c.endMinute)}
        </p>
        {c.status === 'inactive' ? <Badge tone="neutral">Inativa</Badge> : null}
      </td>
      <td className="px-space-sm py-space-sm">
        {editable && isHourly ? (
          <div className="flex gap-space-sm">
            {priceInput('Dia útil', weekday, setWeekday, 'weekdayRateCents', weekdayCents)}
            {priceInput(
              'Fim de semana e feriados',
              weekend,
              setWeekend,
              'weekendRateCents',
              weekendCents,
            )}
          </div>
        ) : editable ? (
          priceInput('Preço fixo', fixed, setFixed, 'fixedPriceCents', fixedCents)
        ) : (
          <div>
            {managedPriceCents(c) !== null ? <p>{formatBRL(managedPriceCents(c) ?? 0)}</p> : null}
            <p className="font-caption text-caption text-ink-muted">Gerenciado em Pacotes</p>
          </div>
        )}
      </td>
      <td className="px-space-sm py-space-sm">
        {average === null ? (
          '—'
        ) : isBlock && fixedCents !== null ? (
          <span>
            {formatBRL(fixedCents)} → {formatBRL(average)}/h
          </span>
        ) : (
          <span>{formatBRL(average)}/h</span>
        )}
      </td>
      <td className="px-space-sm py-space-sm text-center">
        <input
          type="radio"
          name="categoria-referencia"
          aria-label={`Categoria de referência: ${c.name}`}
          checked={c.isReference}
          disabled={busy || !isHourly || c.status === 'inactive'}
          onChange={() => {
            onReference(c);
          }}
          className={cx('h-5 w-5 accent-bronze', focusRing)}
        />
      </td>
      <td className="px-space-sm py-space-sm text-center">
        <input
          type="checkbox"
          aria-label={`Ativa: ${c.name}`}
          checked={c.status === 'active'}
          disabled={busy || update.isPending || !editable}
          onChange={(event) => {
            toggleStatus(event.target.checked);
          }}
          className={cx('h-5 w-5 accent-bronze', focusRing)}
        />
      </td>
      <td className="px-space-sm py-space-sm">
        {editable ? (
          <Button
            size="sm"
            aria-label={`Salvar ${c.name}`}
            loading={update.isPending}
            disabled={!dirty || !valid}
            onClick={save}
          >
            Salvar
          </Button>
        ) : null}
        {rowError ? (
          <p role="alert" className="mt-1 max-w-48 font-caption text-caption text-error">
            {rowError}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Tabela de valores (NUC-71): every category with its editable price, the live average hourly
 * value, the V_ref radio, activation and order controls, and the "Nova categoria" form.
 */
export function CategoriesTable() {
  const categories = useCategories();
  const reference = useSetReferenceCategory();
  const reorder = useReorderCategories();
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const items = categories.data?.items ?? [];
  const busy = reference.isPending || reorder.isPending;

  const move = (index: number, delta: -1 | 1) => {
    const ids = items.map((c) => c.id);
    const target = index + delta;
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    setActionError(null);
    reorder.mutate(ids, {
      onError: (error) => setActionError(messageOf(error, 'Não foi possível reordenar.')),
    });
  };

  const markReference = (category: AdminCategory) => {
    setActionError(null);
    reference.mutate(category.id, {
      onError: (error) =>
        setActionError(messageOf(error, 'Não foi possível definir a categoria de referência.')),
    });
  };

  return (
    <section aria-labelledby="values-title" className="space-y-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id="values-title" className="font-heading text-heading-mobile text-ink">
          Tabela de valores
        </h2>
        <Button
          variant="secondary"
          onClick={() => {
            setCreating(true);
          }}
        >
          Nova categoria
        </Button>
      </div>
      <p className="font-small text-small text-ink-muted">
        O valor médio da hora aparece ao lado de cada preço e acompanha o que você digita. A
        categoria de referência (V_ref) é a base dos descontos e pacotes.
      </p>
      {categories.isPending ? <Spinner label="Carregando categorias" /> : null}
      {categories.isError ? (
        <Alert tone="error">
          {messageOf(categories.error, 'Não foi possível carregar as categorias.')}
        </Alert>
      ) : null}
      {actionError ? <Alert tone="error">{actionError}</Alert> : null}
      {categories.data ? (
        <div className="overflow-x-auto rounded-card border border-hairline bg-surface-raised">
          <table className="w-full min-w-[56rem] border-collapse text-left font-small text-small text-ink">
            <caption className="sr-only">Categorias de reserva e seus valores</caption>
            <thead>
              <tr className="bg-surface-stone font-caption text-caption uppercase tracking-[0.08em] text-ink-muted">
                <th scope="col" className="px-space-sm py-space-sm">
                  <span className="sr-only">Ordem</span>
                </th>
                <th scope="col" className="px-space-sm py-space-sm">
                  Categoria
                </th>
                <th scope="col" className="px-space-sm py-space-sm">
                  Valores
                </th>
                <th scope="col" className="px-space-sm py-space-sm">
                  Valor médio da hora
                </th>
                <th scope="col" className="px-space-sm py-space-sm text-center">
                  V_ref
                </th>
                <th scope="col" className="px-space-sm py-space-sm text-center">
                  Ativa
                </th>
                <th scope="col" className="px-space-sm py-space-sm">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((category, index) => (
                <CategoryRow
                  key={`${category.id}-${String(category.version)}`}
                  category={category}
                  index={index}
                  total={items.length}
                  onMove={move}
                  onReference={markReference}
                  busy={busy}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Slot name="admin.categories.forms" props={{ categories: items }} />
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        title="Nova categoria"
      >
        <CategoryForm
          onCreated={() => {
            setCreating(false);
          }}
          onCancel={() => {
            setCreating(false);
          }}
        />
      </Modal>
    </section>
  );
}
