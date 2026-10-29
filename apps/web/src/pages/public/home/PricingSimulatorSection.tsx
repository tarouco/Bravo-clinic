import { formatBRL } from '@bravo/core';
import { ArrowRight, Calculator, Check, CreditCard, SprayCan, Table2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eyebrow } from '../../../components/ui/Brand';
import { buttonClasses } from '../../../components/ui/Button';
import { ChipGroup } from '../../../components/ui/Chip';
import { cx } from '../../../components/ui/cx';
import { Alert } from '../../../components/ui/Feedback';
import { Icon } from '../../../components/ui/Icon';
import { Slider } from '../../../components/ui/Slider';
import { useCatalog } from '../../../features/catalog/api';
import { FACTORY_HOURLY_CATEGORIES } from '../../../features/home/factory-categories';
import { hoursLabel, simulateWith, type SimulatorPeriod } from '../../../features/home/simulator';

interface TariffRow {
  label: string;
  price: string;
  /** Highlighted row (the discounted tariff). */
  highlight?: boolean;
}

interface TariffGroup {
  title: string;
  rows: TariffRow[];
}

const TARIFF_GROUPS: TariffGroup[] = [
  {
    title: 'Dia Útil — Comercial (07:00 às 19:00)',
    rows: [
      { label: '1 hora avulsa (até 1h59)', price: 'R$ 97,00/h' },
      {
        label: '2 horas ou mais (desconto aplicado em todas as horas)',
        price: 'R$ 80,00/h',
        highlight: true,
      },
      { label: 'Meio Turno comercial (bloco fixo 2h30)', price: 'R$ 280,00' },
      { label: 'Turno completo comercial (5h)', price: 'R$ 500,00' },
    ],
  },
  {
    title: 'Período Noturno (19:00 às 00:00)',
    rows: [
      { label: '1 hora noturna', price: 'R$ 120,00/h' },
      { label: '2 horas ou mais noturnas', price: 'R$ 99,00/h' },
      { label: 'Meio Turno Noturno (19:00 às 00:00 - 5h)', price: 'R$ 400,00' },
    ],
  },
  {
    title: 'Sábados, Domingos & Feriados (09:00 às 19:00)',
    rows: [
      { label: '1 hora avulsa', price: 'R$ 120,00/h' },
      { label: '2 horas ou mais (em todas as horas)', price: 'R$ 99,00/h' },
      { label: 'Meio Turno (09:00–13:45 ou 13:45–18:30)', price: 'R$ 400,00' },
    ],
  },
];

const PERIOD_OPTIONS: { value: SimulatorPeriod; label: string }[] = [
  { value: 'util', label: 'Dia útil comercial' },
  { value: 'especial', label: 'Noite / fim de semana' },
];

const smallLabel = 'block font-eyebrow text-eyebrow uppercase text-ink-muted';

function TariffTable() {
  return (
    <div className="bv-card">
      <h3 className="mb-space-sm flex items-center gap-space-xs font-heading text-heading-mobile text-ink md:text-heading">
        <Icon as={Table2} size={24} className="shrink-0 text-accent" />
        Tabela de tarifas Bravô Clinic
      </h3>
      {TARIFF_GROUPS.map((group, index) => (
        <div key={group.title} className={index < TARIFF_GROUPS.length - 1 ? 'mb-space-md' : ''}>
          <div className="mb-space-xs font-small text-small font-medium text-accent">
            {group.title}
          </div>
          <div className="space-y-space-xs font-small text-small">
            {group.rows.map((row) => (
              <div
                key={row.label}
                className={cx(
                  'flex justify-between gap-space-md rounded-sm px-space-sm py-1',
                  // The discounted tariff is the gold price pill of the table.
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

function CleanupGuarantee() {
  return (
    <div className="bv-card space-y-space-xs">
      <div className="flex items-center gap-space-xs text-ink">
        <Icon as={SprayCan} size={22} className="shrink-0 text-accent" />
        <h4 className="bv-card-title m-0">
          Garantia de biossegurança: bloqueio de limpeza de 30 min
        </h4>
      </div>
      <p className="font-small text-small text-ink-muted">
        Ao concluir cada reserva, automaticamente bloqueamos&nbsp;
        <strong>30 minutos de higienização rigorosa&nbsp;</strong>antes da locação seguinte. Assim
        garantimos intervalos entre cada locação para assegurar a higiene total do ambiente para seu
        paciente.
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

function Simulator() {
  const [period, setPeriod] = useState<SimulatorPeriod>('util');
  const [hours, setHours] = useState(2);
  const { data: catalog } = useCatalog();
  // The factory catalog prices the simulator until the live one arrives or if the API fails.
  const categories = useMemo(
    () =>
      catalog?.hourly.map((c) => ({ ...c, status: 'active' as const })) ??
      FACTORY_HOURLY_CATEGORIES,
    [catalog],
  );
  const result = simulateWith(categories, period, hours);

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
            Tipo de dia / horário
          </span>
          <ChipGroup
            label="Tipo de dia / horário"
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
            min={1}
            max={6}
            step={0.5}
            value={hours}
            onValueChange={setHours}
            formatValue={hoursLabel}
            className="w-full"
            trackClassName="w-full flex-1"
          >
            {() => null}
          </Slider>
          <div className="mt-1 flex justify-between text-caption text-ink-muted">
            <span>1h (mínimo)</span>
            <span>2h (faixa desconto)</span>
            <span>4h</span>
            <span>6h</span>
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
            <div className="space-y-1 border-t border-on-gold/20 pt-space-xs">
              <SummaryRow
                label={
                  <span className="flex items-center gap-1 text-small font-medium">
                    <Icon as={CreditCard} size={14} className="shrink-0" />
                    Sinal 50% no checkout (Mercado Pago):
                  </span>
                }
              >
                <span className="text-small font-semibold">{formatBRL(result.sinalCents)}</span>
              </SummaryRow>
              <SummaryRow
                label={
                  <span className="text-caption">
                    Saldo 50% restante (cobrado 48h antes da data):
                  </span>
                }
              >
                <span className="text-caption">{formatBRL(result.saldoCents)}</span>
              </SummaryRow>
            </div>
            <div className="flex items-center gap-space-xs pt-space-xs font-caption text-caption">
              <Icon as={Check} size={12} className="shrink-0" />
              <span>Inclui +30 min gratuitos de limpeza pós-atendimento</span>
            </div>
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
  return (
    <section className="w-full scroll-mt-20 bg-surface py-space-3xl" id="simulador">
      <div className="mx-auto max-w-7xl px-gutter">
        <div className="mb-space-2xl max-w-3xl space-y-space-sm">
          <Eyebrow>Regras de reservas</Eyebrow>
          <h2 className="font-display text-display-l-mobile text-ink md:text-display-l">
            Você tem liberdade para escolher seus horários.
          </h2>
          <p className="font-body text-body text-ink-muted">
            Reserve 1 hora ou mais, seja em horário comercial, noturno ou finais de semana e
            feriados, estamos sempre abertos para você melhor atender os seus clientes. Reservando
            2h ou mais, as tarifas tem desconto.
          </p>
        </div>
        <div className="grid grid-cols-1 items-start gap-space-xl lg:grid-cols-12">
          <div className="space-y-space-md lg:col-span-6">
            <TariffTable />
            <CleanupGuarantee />
          </div>
          <Simulator />
        </div>
      </div>
    </section>
  );
}
