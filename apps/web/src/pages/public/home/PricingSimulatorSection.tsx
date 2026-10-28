import { formatBRL } from '@bravo/core';
import { ArrowRight, Calculator, Check, CreditCard, SprayCan, Table2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eyebrow } from '../../../components/ui/Brand';
import { Alert } from '../../../components/ui/Feedback';
import { focusRing } from '../../../components/ui/cx';
import { Icon } from '../../../components/ui/Icon';
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
  { value: 'util', label: 'Dia Útil Comercial' },
  { value: 'especial', label: 'Noite / Fim de Semana' },
];

const smallLabel = 'block font-eyebrow text-caption uppercase text-ink-muted tracking-[0.16em]';

function TariffTable() {
  return (
    <div className="bg-surface-raised rounded-xl p-space-lg shadow-sm">
      <h3 className="font-heading-mobile text-heading-mobile md:font-heading md:text-heading text-ink flex items-center gap-space-xs mb-space-sm">
        <Icon as={Table2} size={24} className="text-bronze shrink-0" />
        Tabela de Tarifas Bravô Clinic
      </h3>
      {TARIFF_GROUPS.map((group, index) => (
        <div key={group.title} className={index < TARIFF_GROUPS.length - 1 ? 'mb-space-md' : ''}>
          <div className="font-eyebrow text-caption uppercase tracking-wider text-bronze font-semibold mb-space-xs">
            {group.title}
          </div>
          <div className="space-y-space-xs font-small text-small">
            {group.rows.map((row) => (
              <div
                key={row.label}
                className={`flex justify-between gap-space-md py-1 px-space-sm rounded ${
                  row.highlight ? 'bg-champagne-soft/40' : 'bg-surface'
                }`}
              >
                <span className={row.highlight ? 'text-bronze font-medium' : 'text-ink'}>
                  {row.label}
                </span>
                <span
                  className={`shrink-0 ${
                    row.highlight ? 'font-semibold text-bronze' : 'font-medium text-ink'
                  }`}
                >
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
    <div className="p-space-lg bg-surface-raised rounded-xl shadow-sm space-y-space-xs">
      <div className="flex items-center gap-space-xs text-bronze">
        <Icon as={SprayCan} size={22} className="shrink-0" />
        <h4 className="font-eyebrow text-caption uppercase font-semibold tracking-wider">
          Garantia de Biossegurança: Bloqueio de Limpeza de 30 min
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
    <div className="flex justify-between items-center gap-space-md">
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
    <div className="lg:col-span-6 bg-surface-raised rounded-xl p-space-xl shadow-xl space-y-space-lg">
      <div className="flex items-center justify-between pb-space-sm border-b border-hairline/40">
        <div>
          <span className="font-eyebrow text-caption uppercase tracking-[0.2em] text-bronze font-semibold">
            CALCULADORA OFICIAL
          </span>
          <h3 className="font-heading-mobile text-heading-mobile md:font-heading md:text-heading text-ink">
            Simule sua Reserva
          </h3>
        </div>
        <Icon as={Calculator} size={30} className="text-bronze shrink-0" />
      </div>
      <div className="space-y-space-md">
        <div>
          <span className={`${smallLabel} mb-space-xs`} id="simulatorPeriodLabel">
            Tipo de Dia / Horário
          </span>
          <div
            className="grid grid-cols-2 gap-space-xs"
            role="group"
            aria-labelledby="simulatorPeriodLabel"
          >
            {PERIOD_OPTIONS.map((option) => {
              const active = period === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  className={`py-space-xs px-space-sm text-center rounded font-small text-small uppercase tracking-wider transition-colors ${focusRing} ${
                    active ? 'bg-bronze text-on-bronze' : 'bg-surface text-ink'
                  }`}
                  onClick={() => {
                    setPeriod(option.value);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="flex justify-between items-center mb-space-xs">
            <label
              className="font-eyebrow text-caption uppercase text-ink-muted tracking-[0.16em]"
              htmlFor="durationRange"
            >
              Duração da Sessão
            </label>
            <span className="font-small text-small font-semibold text-bronze">
              {hoursLabel(hours)}
            </span>
          </div>
          <input
            className="w-full accent-bronze cursor-pointer bg-surface h-2 rounded"
            id="durationRange"
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={hours}
            onChange={(event) => {
              setHours(Number(event.target.value));
            }}
          />
          <div className="flex justify-between text-caption text-ink-muted mt-1">
            <span>1h (Mínimo)</span>
            <span>2h (Faixa Desconto)</span>
            <span>4h</span>
            <span>6h</span>
          </div>
        </div>
        {result ? (
          <div className="p-space-md bg-surface rounded-xl space-y-space-sm">
            <SummaryRow
              label={
                <span className="font-small text-small text-ink-muted">Memória de cálculo:</span>
              }
            >
              <span className="font-mono text-small text-ink font-medium text-right">
                {result.formula}
              </span>
            </SummaryRow>
            <SummaryRow
              label={
                <span className="font-body text-body text-ink font-medium">
                  Valor Total da Reserva:
                </span>
              }
            >
              <span className="font-display-l text-heading text-ink font-semibold">
                {formatBRL(result.totalCents)}
              </span>
            </SummaryRow>
            <div className="pt-space-xs border-t border-hairline/30 space-y-1">
              <SummaryRow
                label={
                  <span className="flex items-center gap-1 text-small text-bronze font-medium">
                    <Icon as={CreditCard} size={14} className="shrink-0" />
                    Sinal 50% no checkout (Mercado Pago):
                  </span>
                }
              >
                <span className="text-small text-bronze font-semibold">
                  {formatBRL(result.sinalCents)}
                </span>
              </SummaryRow>
              <SummaryRow
                label={
                  <span className="text-caption text-ink-muted">
                    Saldo 50% restante (cobrado 48h antes da data):
                  </span>
                }
              >
                <span className="text-caption text-ink-muted">{formatBRL(result.saldoCents)}</span>
              </SummaryRow>
            </div>
            <div className="flex items-center gap-space-xs text-ink-muted font-caption text-caption pt-space-xs">
              <Icon as={Check} size={12} className="text-bronze shrink-0" />
              <span>Inclui +30 min gratuitos de limpeza pós-atendimento</span>
            </div>
          </div>
        ) : (
          <Alert tone="info">
            Não foi possível simular esta duração com as tarifas atuais. Fale com a recepção.
          </Alert>
        )}
        <Link
          to="/reservar"
          className={`w-full py-space-md bg-bronze hover:bg-walnut text-on-bronze font-small text-small uppercase tracking-[0.08em] rounded shadow-md transition-all flex items-center justify-center gap-space-xs ${focusRing}`}
        >
          <span>Continuar para Agendamento da Sala</span>
          <Icon as={ArrowRight} size={16} />
        </Link>
      </div>
    </div>
  );
}

export function PricingSimulatorSection() {
  return (
    <section className="w-full py-space-3xl bg-surface-container-low scroll-mt-20" id="simulador">
      <div className="max-w-7xl mx-auto px-gutter">
        <div className="max-w-3xl mb-space-2xl">
          <Eyebrow>REGRAS DE Reservas</Eyebrow>
          <h2 className="font-display-l-mobile text-display-l-mobile md:font-display-l md:text-display-l text-ink">
            Você tem liberdade para escolher seus horários.
          </h2>
          <p className="font-body text-body text-ink-muted">
            Reserve 1 hora ou mais, seja em horário comercial, noturno ou finais de semana e
            feriados, estamos sempre abertos para você melhor atender os seus clientes. Reservando
            2h ou mais, as tarifas tem desconto.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-xl items-start">
          <div className="lg:col-span-6 space-y-space-md">
            <TariffTable />
            <CleanupGuarantee />
          </div>
          <Simulator />
        </div>
      </div>
    </section>
  );
}
