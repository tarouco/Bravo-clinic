import {
  averageHourlyCents,
  estimateFixedPeriod,
  fixedScheduleCategoryInput,
  formatBRL,
  hourPackageCategoryInput,
  parseBRLToCents,
  settingsCatalog,
  type AdminCategory,
} from '@bravo/core';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../components/ui/form';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { fieldErrorsOf, messageOf } from '../../lib/api-errors';
import { centsToInput } from '../admin-calendar/category-utils';
import { TimeField } from '../admin-calendar/TimeField';
import { formatHHMM } from '../admin-calendar/time';
import { useCalendarConfig } from '../calendar/api';
import { useCreateCategory } from '../categories/api';
import { formatWeekdayRange, periodLabel } from '../purchases/format';
import { useUpdatePackageCategory, type PackageCategoryPatch } from '../purchases/api';

type Period = NonNullable<PackageCategoryPatch['period']>;
type PackageKind = 'hour_package' | 'fixed_schedule';
type Status = 'active' | 'inactive';
type Visibility = 'public' | 'admin_only';

const PERIODS: readonly { value: Period; days: 30 | 60 | 90 }[] = [
  { value: 'monthly', days: 30 },
  { value: 'bimonthly', days: 60 },
  { value: 'quarterly', days: 90 },
];

const WEEKDAYS = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [7, 'Dom'],
] as const;

const MONEY_ERROR = 'Informe um valor, por exemplo 1.600,00.';

const periodDays = (period: Period): number => PERIODS.find((p) => p.value === period)?.days ?? 30;

const isPackage = (c: AdminCategory): c is AdminCategory & { type: PackageKind } =>
  c.type === 'hour_package' || c.type === 'fixed_schedule';

/** "20–22 ocorrências · R$ 5.600,00 – R$ 6.160,00" (REC-04); one number when the range is a point. */
export function fixedEstimateText(estimate: ReturnType<typeof estimateFixedPeriod>): string {
  const count =
    estimate.minCount === estimate.maxCount
      ? String(estimate.minCount)
      : `${String(estimate.minCount)}–${String(estimate.maxCount)}`;
  const price =
    estimate.minCents === estimate.maxCents
      ? formatBRL(estimate.minCents)
      : `${formatBRL(estimate.minCents)} – ${formatBRL(estimate.maxCents)}`;
  return `${count} ocorrências · ${price}`;
}

/** Cents behind a typed price; 0 while the text is not a positive BRL amount. */
function moneyToCents(text: string): number {
  const cents = parseBRLToCents(text);
  return cents !== null && cents > 0 ? cents : 0;
}

interface FormState {
  name: string;
  price: string;
  hours: string;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  period: Period;
  status: Status;
  visibility: Visibility;
}

function initialState(kind: PackageKind, category: AdminCategory | null): FormState {
  if (!category) {
    return {
      name: '',
      price: '',
      hours: '',
      weekdays: [],
      startMinute: 480,
      endMinute: 720,
      period: 'monthly',
      status: 'active',
      visibility: 'public',
    };
  }
  const priceCents =
    kind === 'hour_package' ? category.fixedPriceCents : category.pricePerOccurrenceCents;
  return {
    name: category.name,
    price: priceCents === null ? '' : centsToInput(priceCents),
    hours: category.includedMinutes === null ? '' : String(category.includedMinutes / 60),
    weekdays: category.weekdays,
    startMinute: category.startMinute,
    endMinute: category.endMinute,
    period: category.period === 'single' ? 'monthly' : category.period,
    status: category.status,
    visibility: category.visibility,
  };
}

const sameDays = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Only what differs from the saved category, so the API's lock rule (REC-05) sees real changes. */
function diffPatch(
  kind: PackageKind,
  category: AdminCategory,
  form: FormState,
  priceCents: number,
  hours: number,
): PackageCategoryPatch {
  const patch: PackageCategoryPatch = {};
  if (form.name.trim() !== category.name) patch.name = form.name.trim();
  if (form.period !== category.period) patch.period = form.period;
  if (form.status !== category.status) patch.status = form.status;
  if (form.visibility !== category.visibility) patch.visibility = form.visibility;
  if (kind === 'hour_package') {
    if (priceCents !== category.fixedPriceCents) patch.fixedPriceCents = priceCents;
    if (hours * 60 !== category.includedMinutes) patch.includedHours = hours;
  } else {
    if (priceCents !== category.pricePerOccurrenceCents) {
      patch.pricePerOccurrenceCents = priceCents;
    }
    if (!sameDays(form.weekdays, category.weekdays)) patch.weekdays = form.weekdays;
    if (form.startMinute !== category.startMinute) patch.startMinute = form.startMinute;
    if (form.endMinute !== category.endMinute) patch.endMinute = form.endMinute;
  }
  return patch;
}

interface FormModalProps {
  kind: PackageKind;
  /** `null` creates a package category; a category edits it. */
  category: AdminCategory | null;
  onClose: () => void;
}

function PackageCategoryFormModal({ kind, category, onClose }: FormModalProps) {
  const create = useCreateCategory();
  const update = useUpdatePackageCategory(category?.id ?? '');
  const config = useCalendarConfig();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(kind, category));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const fixed = kind === 'fixed_schedule';

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const priceCents = moneyToCents(form.price);
  const hours = Number(form.hours);
  const wholeHours = form.hours.trim() !== '' && Number.isInteger(hours) && hours > 0;
  const windowMinutes = form.endMinute - form.startMinute;

  // Live average hour value and, for a fixed schedule, the period estimate (REC-03, REC-04).
  const averageText = (() => {
    if (priceCents === 0) return null;
    if (!fixed) {
      return wholeHours ? formatBRL(averageHourlyCents({ priceCents, minutes: hours * 60 })) : null;
    }
    return windowMinutes > 0
      ? formatBRL(averageHourlyCents({ priceCents, minutes: windowMinutes }))
      : null;
  })();
  const estimate =
    fixed && priceCents > 0 && form.weekdays.length > 0
      ? estimateFixedPeriod({
          weekdays: form.weekdays,
          periodDays: periodDays(form.period),
          pricePerOccurrenceCents: priceCents,
        })
      : null;

  const grid = config.data?.settings;
  const slotMinutes = grid?.slotMinutes ?? settingsCatalog['calendar.slot_minutes'].default;
  const minBookingMinutes =
    grid?.defaultBookingMinutes ?? settingsCatalog['calendar.default_booking_minutes'].default;

  const patch = category ? diffPatch(kind, category, form, priceCents, hours) : null;
  const nothingToSave = patch !== null && Object.keys(patch).length === 0;

  const submit = () => {
    setFormError(null);
    const next: Record<string, string> = {};
    if (priceCents === 0) next[fixed ? 'pricePerOccurrenceCents' : 'fixedPriceCents'] = MONEY_ERROR;

    const common = {
      name: form.name,
      period: form.period,
      status: form.status,
      visibility: form.visibility,
    };
    const raw = fixed
      ? {
          type: 'fixed_schedule' as const,
          ...common,
          weekdays: form.weekdays,
          startMinute: form.startMinute,
          endMinute: form.endMinute,
          pricePerOccurrenceCents: priceCents,
        }
      : {
          type: 'hour_package' as const,
          ...common,
          fixedPriceCents: priceCents,
          includedHours: wholeHours ? hours : 0,
        };
    const parsed = fixed
      ? fixedScheduleCategoryInput({ slotMinutes, minBookingMinutes }).safeParse(raw)
      : hourPackageCategoryInput.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!(key in next)) next[key] = issue.message;
      }
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});

    const options = {
      onSuccess: () => {
        toast({ message: category ? 'Categoria salva.' : 'Categoria criada.' });
        onClose();
      },
      onError: (error: Error) => {
        const fields = fieldErrorsOf(error);
        // The locked-field rule (REC-05) is a 409 whose message goes above the form.
        if (error instanceof ApiError && error.status === 409) setFormError(error.message);
        else if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível salvar a categoria.'));
      },
    };
    if (patch) update.mutate(patch, options);
    else create.mutate(raw, options);
  };

  const label = fixed ? 'horário fixo' : 'pacote de horas';
  return (
    <Modal open onClose={onClose} title={category ? `Editar ${category.name}` : `Novo ${label}`}>
      <form
        className="space-y-space-md"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Input
          label="Nome"
          value={form.name}
          error={errors['name']}
          onChange={(event) => {
            set('name', event.target.value);
          }}
        />
        <div className="grid gap-space-md sm:grid-cols-2">
          <Input
            label={fixed ? 'Preço por ocorrência' : 'Preço do pacote'}
            inputMode="decimal"
            value={form.price}
            error={errors[fixed ? 'pricePerOccurrenceCents' : 'fixedPriceCents']}
            help={fixed ? 'Ex.: 280,00' : 'Ex.: 1.600,00'}
            onChange={(event) => {
              set('price', event.target.value);
            }}
          />
          {fixed ? null : (
            <Input
              label="Horas incluídas"
              type="number"
              min={1}
              max={200}
              inputMode="numeric"
              value={form.hours}
              error={errors['includedHours']}
              onChange={(event) => {
                set('hours', event.target.value);
              }}
            />
          )}
        </div>
        {fixed ? (
          <>
            <fieldset className="space-y-space-xs">
              <legend className="font-small text-small font-medium text-ink">Dias da semana</legend>
              <div className="flex flex-wrap gap-x-space-lg gap-y-space-xs">
                {WEEKDAYS.map(([day, name]) => (
                  <Checkbox
                    key={day}
                    label={name}
                    checked={form.weekdays.includes(day)}
                    onChange={(event) => {
                      set(
                        'weekdays',
                        event.target.checked
                          ? [...form.weekdays, day].sort()
                          : form.weekdays.filter((d) => d !== day),
                      );
                    }}
                  />
                ))}
              </div>
              {errors['weekdays'] ? (
                <p className="font-caption text-caption text-error">{errors['weekdays']}</p>
              ) : null}
            </fieldset>
            <div className="grid gap-space-md sm:grid-cols-2">
              <TimeField
                label="Início"
                value={form.startMinute}
                error={errors['startMinute']}
                onCommit={(minute) => {
                  set('startMinute', minute);
                }}
              />
              <TimeField
                label="Fim"
                value={form.endMinute}
                error={errors['endMinute']}
                onCommit={(minute) => {
                  set('endMinute', minute);
                }}
              />
            </div>
          </>
        ) : null}
        <div className="grid gap-space-md sm:grid-cols-3">
          <Select
            label="Período"
            value={form.period}
            error={errors['period']}
            onChange={(event) => {
              set('period', event.target.value as Period);
            }}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {periodLabel(p.value).replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </Select>
          <Select
            label="Status"
            value={form.status}
            onChange={(event) => {
              set('status', event.target.value as Status);
            }}
          >
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </Select>
          <Select
            label="Visibilidade"
            value={form.visibility}
            onChange={(event) => {
              set('visibility', event.target.value as Visibility);
            }}
          >
            <option value="public">Pública</option>
            <option value="admin_only">Somente admin</option>
          </Select>
        </div>
        <div
          aria-live="polite"
          className="space-y-space-xs rounded-control border border-hairline bg-surface-stone p-space-sm font-small text-small text-ink"
        >
          <p>
            Valor médio da hora:{' '}
            <span className="font-semibold">{averageText ? `${averageText}/h` : '—'}</span>
          </p>
          {fixed && estimate ? <p>{fixedEstimateText(estimate)}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-space-sm">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={pending} disabled={nothingToSave}>
            Salvar categoria
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PackageRow({ category, onEdit }: { category: AdminCategory; onEdit: () => void }) {
  const fixed = category.type === 'fixed_schedule';
  const price = fixed ? category.pricePerOccurrenceCents : category.fixedPriceCents;
  const estimate =
    fixed && category.pricePerOccurrenceCents !== null && category.period !== 'single'
      ? estimateFixedPeriod({
          weekdays: category.weekdays,
          periodDays: periodDays(category.period),
          pricePerOccurrenceCents: category.pricePerOccurrenceCents,
        })
      : null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-space-sm py-space-sm">
      <div className="space-y-space-xs font-small text-small text-ink">
        <p className="font-medium">
          {category.name}
          {category.status === 'inactive' ? (
            <Badge tone="neutral" className="ml-space-sm">
              Inativa
            </Badge>
          ) : null}
          {category.visibility === 'admin_only' ? (
            <Badge tone="neutral" className="ml-space-sm">
              Somente admin
            </Badge>
          ) : null}
        </p>
        <p className="text-ink-muted">
          {fixed
            ? `${formatWeekdayRangeText(category)} · ${formatBRL(price ?? 0)} por ocorrência`
            : `${category.includedMinutes ? String(category.includedMinutes / 60) : '0'} h · ${formatBRL(price ?? 0)}`}
          {category.period === 'single' ? '' : ` · ${periodLabel(category.period)}`}
          {` → ${formatBRL(category.averageHourlyCents)}/h`}
        </p>
        {estimate ? <p className="text-ink-muted">{fixedEstimateText(estimate)}</p> : null}
      </div>
      <Button variant="ghost" size="sm" aria-label={`Editar ${category.name}`} onClick={onEdit}>
        Editar
      </Button>
    </li>
  );
}

function formatWeekdayRangeText(category: AdminCategory): string {
  return `${formatWeekdayRange(category.weekdays)} ${formatHHMM(category.startMinute)}–${formatHHMM(category.endMinute)}`;
}

/**
 * Slot `admin.categories.forms` of the Tabela de valores: the package categories with their
 * average hour value, "Novo pacote de horas" and "Novo horário fixo", and the edit forms
 * (REC-03, REC-04, REC-05).
 */
export function PackageCategoryForms({
  categories = [],
}: {
  categories?: readonly AdminCategory[];
}) {
  const [target, setTarget] = useState<{
    kind: PackageKind;
    category: AdminCategory | null;
  } | null>(null);
  const packages = categories.filter(isPackage);

  return (
    <section aria-labelledby="packages-title" className="space-y-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id="packages-title" className="font-heading text-heading-mobile text-ink">
          Pacotes
        </h2>
        <div className="flex flex-wrap gap-space-sm">
          <Button
            variant="secondary"
            onClick={() => {
              setTarget({ kind: 'hour_package', category: null });
            }}
          >
            Novo pacote de horas
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setTarget({ kind: 'fixed_schedule', category: null });
            }}
          >
            Novo horário fixo
          </Button>
        </div>
      </div>
      {packages.length === 0 ? (
        <p className="font-small text-small text-ink-muted">Nenhum pacote cadastrado.</p>
      ) : (
        <ul aria-label="Pacotes cadastrados" className="divide-y divide-hairline/60">
          {packages.map((category) => (
            <PackageRow
              key={`${category.id}-${String(category.version)}`}
              category={category}
              onEdit={() => {
                setTarget({ kind: category.type, category });
              }}
            />
          ))}
        </ul>
      )}
      {target ? (
        <PackageCategoryFormModal
          kind={target.kind}
          category={target.category}
          onClose={() => {
            setTarget(null);
          }}
        />
      ) : null}
    </section>
  );
}
