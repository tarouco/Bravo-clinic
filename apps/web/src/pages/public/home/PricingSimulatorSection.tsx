import { formatBRL, type Catalog, type Clinic, type PolicySnapshot } from '@bravo/core';
import { ArrowRight, Calculator, Check, CreditCard, SprayCan, Table2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eyebrow } from '../../../components/ui/Brand';
import { buttonClasses } from '../../../components/ui/Button';
import { ChipGroup } from '../../../components/ui/Chip';
import { cx } from '../../../components/ui/cx';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { Slider } from '../../../components/ui/Slider';
import { useCatalog, useClinic, usePolicies } from '../../../features/catalog/api';
import { hoursLabel, simulateWith, type SimulatorPeriod } from '../../../features/home/simulator';
import {
  buildTariffGroups,
  discountFromMinutes,
  hoursPhrase,
} from '../../../features/catalog/tariffs';

const PERIOD_OPTIONS: { value: SimulatorPeriod; label: string }[] = [
  { value: 'util', label: 'Dia útil' },
  { value: 'especial', label: 'Fim de semana / feriado' },
];

/** The longest session the simulator offers, in hours. */
const MAX_HOURS = 6;

const smallLabel = 'block font-eyebrow text-eyebrow uppercase text-ink-muted';

function TariffTable({ catalog, clinic }: { catalog: Catalog; clinic: Clinic | undefined }) {
  const groups = buildTariffGroups(catalog, clinic?.businessHours);
  return (
    <div className="bv-card">
      <h3 className="mb-space-sm flex items-center gap-space-xs font-heading text-heading-mobile text-ink md:text-heading">
        <Icon as={Table2} size={24} className="shrink-0 text-accent" />
        Tabela de tarifas Bravô Clinic
      </h3>
      {groups.length === 0 ? (
        <p className="font-small text-small text-ink-muted">
          Tarifas em atualização. Fale com a recepção.
        </p>
      ) : null}
      {groups.map((group, index) => (
        <div key={group.title} className={index < groups.length - 1 ? 'mb-space-md' : ''}>
          <div className="mb-space-xs font-small text-small font-medium text-accent">
            {group.title}
          </div>
          <div className="space-y-space-xs font-small text-small">
            {group.rows.map((row) => (
              <div
                key={row.label}
                className={cx(
                  'flex justify-between gap-space-md rounded-sm px-space-sm py-1',
                  // The lowest hourly rate is the gold price pill of the table.
                  row.highlight ? 'bg-gold text-on-gold' : 'bg-surface-deboss text-ink',
                )}
              >
                <span className={row.highlight ? 'font-medium' : undefined}>{row.label}</span>
                <span className={cx('shrink-0', row.highlight ? 'font-semibold' : 'font-medium')}>
                  {row.price}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CleanupGuarantee({ minutes }: { minutes: number }) {
  if (minutes <= 0) return null;
  return (
    <div className="bv-card space-y-space-xs">
      <div className="flex items-center gap-space-xs text-ink">
        <Icon as={SprayCan} size={22} className="shrink-0 text-accent" />
        <h4 className="bv-card-title m-0">
          Garantia de biossegurança: bloqueio de limpeza de {minutes} min
        </h4>
      </div>
      <p className="font-small text-small text-ink-muted">
        Ao concluir cada reserva, automaticamente bloqueamos&nbsp;
        <strong>{minutes} minutos de higienização rigorosa&nbsp;</strong>antes da locação seguinte.
        Assim garantimos intervalos entre cada locação para assegurar a higiene total do ambiente
        para seu paciente.
      </p>
    </div>
  );
}

function SummaryRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-space-md">
      {label}
      {children}
    </div>
  );
}

interface SimulatorProps {
  catalog: Catalog;
  clinic: Clinic | undefined;
  policy: PolicySnapshot;
}

/** Slider step: the booking grid (`calendar.slot_minutes`), at least half an hour. */
const stepHours = (slotMinutes: number) => Math.max(slotMinutes, 30) / 60;

/** 1.5 -> "1,5". */
const decimal = (hours: number) => String(hours).replace('.', ',');

function Simulator({ catalog, clinic, policy }: SimulatorProps) {
  const step = stepHours(catalog.rules.slotMinutes);
  const shortest = Math.min(MAX_HOURS * 60, ...catalog.hourly.map((c) => c.minDurationMinutes));
  const minHours = Math.max(step, Math.ceil(shortest / 60 / step) * step);
  const discountFrom = discountFromMinutes(catalog.hourly);
  const [period, setPeriod] = useState<SimulatorPeriod>('util');
  const [chosenHours, setHours] = useState<number | null>(null);
  const hours = Math.min(
    MAX_HOURS,
    Math.max(minHours, chosenHours ?? (discountFrom === null ? minHours : discountFrom / 60)),
  );
  const categories = useMemo(
    () => catalog.hourly.map((c) => ({ ...c, status: 'active' as const })),
    [catalog],
  );
  const depositPercent = policy['payment.deposit_percent'];
  const balanceHours = policy['payment.balance_charge_hours_before'];
  const dayType = period === 'util' ? 'tue' : 'sat';
  const openMinute = clinic?.businessHours.find((h) => h.dayType === dayType)?.openMinute;
  const result = simulateWith({
    categories,
    period,
    hours,
    depositPercent,
    ...(openMinute === undefined ? {} : { openMinute }),
  });
  const cleanup = catalog.rules.cleanupMinutes;
  const discountHours = discountFrom === null ? null : discountFrom / 60;
  const ticks = [
    `${decimal(minHours)}h (mínimo)`,
    ...(discountHours !== null && discountHours > minHours && discountHours < MAX_HOURS
      ? [`${decimal(discountHours)}h (faixa desconto)`]
      : []),
    `${MAX_HOURS}h`,
  ];

  return (
    <div className="bv-card space-y-space-lg sm:p-space-xl lg:col-span-6">
      <div className="flex items-center justify-between border-b border-hairline pb-space-sm">
        <div>
          <Eyebrow>Calculadora oficial</Eyebrow>
          <h3 className="font-heading text-heading-mobile text-ink md:text-heading">
            Simule sua reserva
          </h3>
        </div>
        <Icon as={Calculator} size={30} className="shrink-0 text-accent" />
      </div>
      <div className="space-y-space-md">
        <div>
          <span aria-hidden="true" className={cx(smallLabel, 'mb-space-xs')}>
            Tipo de dia
          </span>
          <ChipGroup
            label="Tipo de dia"
            options={PERIOD_OPTIONS}
            value={period}
            onChange={setPeriod}
          />
        </div>
        <div>
          <div className="mb-space-xs flex items-center justify-between">
            <span aria-hidden="true" className={smallLabel}>
              Duração da sessão
            </span>
            <span className="font-small text-small font-semibold text-accent">
              {hoursLabel(hours)}
            </span>
          </div>
          {/* The hours caption above stands in for the slider's own value text. */}
          <Slider
            label="Duração da sessão"
            min={minHours}
            max={MAX_HOURS}
            step={step}
            value={hours}
            onValueChange={setHours}
            formatValue={hoursLabel}
            className="w-full"
            trackClassName="w-full flex-1"
          >
            {() => null}
          </Slider>
          <div className="mt-1 flex justify-between text-caption text-ink-muted">
            {ticks.map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>
        {result ? (
          <div className="bv-card bv-card--gold space-y-space-sm p-space-md">
            <SummaryRow label={<span className="font-small text-small">Memória de cálculo:</span>}>
              <span className="text-right font-mono text-small font-medium">{result.formula}</span>
            </SummaryRow>
            <SummaryRow
              label={
                <span className="font-body text-body font-medium">Valor total da reserva:</span>
              }
            >
              <span className="font-display text-heading font-semibold">
                {formatBRL(result.totalCents)}
              </span>
            </SummaryRow>
            {depositPercent > 0 && depositPercent < 100 ? (
              <div className="space-y-1 border-t border-on-gold/20 pt-space-xs">
                <SummaryRow
                  label={
                    <span className="flex items-center gap-1 text-small font-medium">
                      <Icon as={CreditCard} size={14} className="shrink-0" />
                      Sinal {depositPercent}% no checkout:
                    </span>
                  }
                >
                  <span className="text-small font-semibold">{formatBRL(result.sinalCents)}</span>
                </SummaryRow>
                <SummaryRow
                  label={
                    <span className="text-caption">
                      Saldo {100 - depositPercent}% restante (cobrado {balanceHours}h antes da
                      data):
                    </span>
                  }
                >
                  <span className="text-caption">{formatBRL(result.saldoCents)}</span>
                </SummaryRow>
              </div>
            ) : (
              <div className="border-t border-on-gold/20 pt-space-xs text-small font-medium">
                {depositPercent >= 100
                  ? 'Pagamento integral no checkout.'
                  : `Pagamento cobrado ${balanceHours}h antes da data.`}
              </div>
            )}
            {cleanup > 0 ? (
              <div className="flex items-center gap-space-xs pt-space-xs font-caption text-caption">
                <Icon as={Check} size={12} className="shrink-0" />
                <span>Inclui +{cleanup} min gratuitos de limpeza pós-atendimento</span>
              </div>
            ) : null}
          </div>
        ) : (
          <Alert tone="info">
            Não foi possível simular esta duração com as tarifas atuais. Fale com a recepção.
          </Alert>
        )}
        <Link to="/reservar" className={buttonClasses({ variant: 'primary', block: true })}>
          <span>Continuar para agendamento da sala</span>
          <Icon as={ArrowRight} size={18} />
        </Link>
      </div>
    </div>
  );
}

export function PricingSimulatorSection() {
  const catalog = useCatalog();
  const policies = usePolicies();
  const { data: clinic } = useClinic();
  const discountFrom = catalog.data ? discountFromMinutes(catalog.data.hourly) : null;

  return (
    <section className="w-full scroll-mt-20 bg-surface py-space-3xl" id="simulador">
      <div className="mx-auto max-w-7xl px-gutter">
        <div className="mb-space-2xl max-w-3xl space-y-space-sm">
          <Eyebrow>Regras de reservas</Eyebrow>
          <h2 className="font-display text-display-l-mobile text-ink md:text-display-l">
            Você tem liberdade para escolher seus horários.
          </h2>
          <p className="font-body text-body text-ink-muted">
            Reserve em horário comercial, noturno ou finais de semana e feriados, estamos sempre
            abertos para você melhor atender os seus clientes.
            {discountFrom === null
              ? null
              : ` Reservando ${hoursPhrase(discountFrom)} ou mais, as tarifas têm desconto.`}
          </p>
        </div>
        {catalog.isError || policies.isError ? (
          <Alert tone="error">
            Não foi possível carregar as tarifas agora. Tente novamente em instantes.
          </Alert>
        ) : !catalog.data || !policies.data ? (
          <div className="flex justify-center py-space-2xl">
            <Spinner label="Carregando tarifas" />
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-space-xl lg:grid-cols-12">
            <div className="space-y-space-md lg:col-span-6">
              <TariffTable catalog={catalog.data} clinic={clinic} />
              <CleanupGuarantee minutes={catalog.data.rules.cleanupMinutes} />
            </div>
            <Simulator catalog={catalog.data} clinic={clinic} policy={policies.data.values} />
          </div>
        )}
      </div>
    </section>
  );
}
