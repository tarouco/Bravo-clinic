import {
  policySettingsUpdateSchema,
  policyValuesSchema,
  renderPolicyText,
  type PolicyValues,
} from '@bravo/core';
import { useEffect, useRef, useState } from 'react';
import { ForbiddenPage } from '../../../components/layout/ForbiddenPage';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Checkbox, Input } from '../../../components/ui/form';
import { FieldError } from '../../../components/ui/form/Field';
import { useToast } from '../../../components/ui/Toast';
import { useSession } from '../../../features/auth/useSession';
import { usePolicySettings, useUpdatePolicySettings } from '../../../features/settings/api';
import { fieldErrorsOf, messageOf } from '../../../lib/api-errors';

type Key = keyof PolicyValues;
type NumberKey = {
  [K in Key]: PolicyValues[K] extends number ? K : never;
}[Key];
type BooleanKey = { [K in Key]: PolicyValues[K] extends boolean ? K : never }[Key];

const field = (label: string, key: NumberKey) => ({ label, key });

const GROUPS: {
  title: string;
  numbers: { label: string; key: NumberKey }[];
  booleans: { label: string; key: BooleanKey }[];
  reminders?: boolean;
  clinicOptions?: boolean;
}[] = [
  {
    title: 'Sinal e saldo',
    numbers: [
      field('Sinal (%)', 'payment.deposit_percent'),
      field('Cobrar o saldo (horas antes do início)', 'payment.balance_charge_hours_before'),
      field('Prazo para pagar o saldo (horas antes)', 'payment.balance_deadline_hours_before'),
      field(
        'Pagamento integral com menos de (horas de antecedência)',
        'payment.full_upfront_threshold_hours',
      ),
    ],
    booleans: [{ label: 'Sinal reembolsável', key: 'payment.deposit_refundable' }],
    reminders: true,
  },
  {
    title: 'Checkout e pré-reserva',
    numbers: [
      field('Tempo para pagar no checkout (min)', 'payment.checkout_hold_minutes'),
      field('Validade padrão da pré-reserva (horas)', 'payment.pre_reservation_expiry_hours'),
    ],
    booleans: [],
  },
  {
    title: 'Reagendamento',
    numbers: [
      field('Reagendamentos cortesia por reserva', 'policy.reschedule_free_count'),
      field('Antecedência mínima para reagendar (horas)', 'policy.reschedule_min_hours_before'),
      field('Janela para o novo horário (dias)', 'policy.reschedule_window_days'),
    ],
    booleans: [],
  },
  {
    title: 'Cancelamento e no-show',
    numbers: [
      field('Antecedência mínima para reembolso (horas)', 'policy.cancel_refund_min_hours_before'),
      field(
        'Antecedência para devolver minutos do pacote (horas)',
        'policy.package_cancel_return_min_hours_before',
      ),
      field('No-show após (min do início)', 'policy.no_show_after_minutes'),
    ],
    booleans: [],
    clinicOptions: true,
  },
  {
    title: 'Assinaturas e horas extras',
    numbers: [
      field('Cobrar a renovação (dias antes)', 'payment.subscription_renewal_days_before'),
      field('Carência da renovação (dias)', 'payment.renewal_grace_days'),
      field('Horas extras: mínimo por compra', 'payment.extra_hours_min'),
      field('Horas extras: máximo por compra', 'payment.extra_hours_max'),
      field('Validade das horas extras (dias)', 'payment.extra_hours_validity_days'),
    ],
    booleans: [
      {
        label: 'Compensar assinantes em dias fechados',
        key: 'payment.closed_day_compensation_enabled',
      },
    ],
  },
  {
    title: 'Créditos',
    numbers: [field('Validade dos créditos (dias)', 'credits.validity_days')],
    booleans: [],
  },
];

const CLINIC_OPTIONS = [
  ['refund', 'Reembolso'],
  ['minutes', 'Devolução de minutos ao pacote'],
  ['credit', 'Crédito'],
] as const;

function PoliciesForm({ version, initial }: { version: number; initial: PolicyValues }) {
  const update = useUpdatePolicySettings();
  const { toast } = useToast();
  const [values, setValues] = useState<PolicyValues>(initial);
  const [reminders, setReminders] = useState(
    initial['payment.balance_reminder_hours_before'].join(', '),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setValues(initial);
    setReminders(initial['payment.balance_reminder_hours_before'].join(', '));
  }, [initial]);

  const set = <K extends Key>(key: K, value: PolicyValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  // The preview follows the form while every value is individually valid.
  const lastGood = useRef<PolicyValues>(initial);
  const valid = policyValuesSchema.safeParse(values);
  if (valid.success) lastGood.current = valid.data;
  const preview = renderPolicyText({
    ...lastGood.current,
    'policy.version': version,
  });

  const submit = () => {
    setFormError(null);
    const parsed = policySettingsUpdateSchema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!(key in next)) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    update.mutate(parsed.data, {
      onSuccess: (result) => {
        toast({ message: `Políticas salvas. Versão ${String(result.version)}.` });
      },
      onError: (error) => {
        const fields = fieldErrorsOf(error);
        if (Object.keys(fields).length > 0) setErrors(fields);
        else setFormError(messageOf(error, 'Não foi possível salvar as políticas.'));
      },
    });
  };

  return (
    <div className="grid gap-space-lg lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form
        className="space-y-space-lg"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="font-small text-small text-ink-muted">
          Regras de pagamento, reagendamento e cancelamento. Versão {version}: cada reserva guarda
          as regras vigentes quando foi criada.
        </p>
        {GROUPS.map((group) => (
          <fieldset
            key={group.title}
            className="space-y-space-md rounded-md border border-hairline p-space-md"
          >
            <legend className="px-space-xs font-heading text-heading-mobile text-ink">
              {group.title}
            </legend>
            <div className="grid gap-space-md sm:grid-cols-2">
              {group.numbers.map(({ label, key }) => (
                <Input
                  key={key}
                  label={label}
                  type="number"
                  inputMode="numeric"
                  value={Number.isNaN(values[key]) ? '' : values[key]}
                  error={errors[key]}
                  onChange={(event) => {
                    set(key, event.target.value === '' ? Number.NaN : Number(event.target.value));
                  }}
                />
              ))}
              {group.reminders ? (
                <Input
                  label="Lembretes do saldo (horas antes, separadas por vírgula)"
                  value={reminders}
                  error={errors['payment.balance_reminder_hours_before']}
                  onChange={(event) => {
                    setReminders(event.target.value);
                    set(
                      'payment.balance_reminder_hours_before',
                      event.target.value
                        .split(',')
                        .map((part) => Number(part.trim()))
                        .filter((n) => !Number.isNaN(n)),
                    );
                  }}
                />
              ) : null}
            </div>
            {group.booleans.map(({ label, key }) => (
              <Checkbox
                key={key}
                label={label}
                checked={values[key]}
                onChange={(event) => {
                  set(key, event.target.checked);
                }}
              />
            ))}
            {group.clinicOptions ? (
              <fieldset className="space-y-space-xs">
                <legend className="font-small text-small text-ink">
                  Opções oferecidas quando a clínica cancela
                </legend>
                <div className="flex flex-wrap gap-x-space-md gap-y-space-xs">
                  {CLINIC_OPTIONS.map(([option, label]) => (
                    <Checkbox
                      key={option}
                      label={label}
                      checked={values['policy.clinic_cancel_options'].includes(option)}
                      onChange={(event) => {
                        const current = values['policy.clinic_cancel_options'];
                        set(
                          'policy.clinic_cancel_options',
                          event.target.checked
                            ? [...current, option]
                            : current.filter((o) => o !== option),
                        );
                      }}
                    />
                  ))}
                </div>
                {errors['policy.clinic_cancel_options'] ? (
                  <FieldError>{errors['policy.clinic_cancel_options']}</FieldError>
                ) : null}
              </fieldset>
            ) : null}
          </fieldset>
        ))}
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Button type="submit" loading={update.isPending}>
          Salvar políticas
        </Button>
      </form>

      <section
        aria-label="Prévia do texto da política"
        className="space-y-space-md self-start rounded-lg bg-surface-raised shadow-card p-space-lg lg:sticky lg:top-24"
      >
        <h3 className="font-heading text-heading-mobile text-ink">Prévia para o cliente</h3>
        {preview.map((section) => (
          <div key={section.title} className="space-y-space-xs">
            <h4 className="font-eyebrow text-eyebrow uppercase text-accent">{section.title}</h4>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="font-small text-small text-ink">
                {paragraph}
              </p>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

/** Políticas sub-tab: every payment, reschedule and cancellation parameter (NUC-176). */
export function PoliciesPanel() {
  const settings = usePolicySettings();
  if (settings.isPending) return <Spinner label="Carregando políticas" />;
  if (settings.isError) {
    return (
      <Alert tone="error">
        {messageOf(settings.error, 'Não foi possível carregar as políticas.')}
      </Alert>
    );
  }
  return <PoliciesForm version={settings.data.version} initial={settings.data.values} />;
}

/** Admin-only route wrapper: reception never calls the policies endpoints. */
export function PoliciesRoute() {
  const { session, isLoading } = useSession();
  if (isLoading) return <Spinner label="Carregando" />;
  if (session?.role !== 'admin') return <ForbiddenPage />;
  return <PoliciesPanel />;
}
