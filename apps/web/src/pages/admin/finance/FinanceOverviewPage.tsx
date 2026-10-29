import { formatBRL, REVENUE_CATEGORIES, type LocalDate } from '@bravo/core';
import { Download } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { cx } from '../../../components/ui/cx';
import { EvolutionChart } from '../../../components/ui/EvolutionChart';
import { Alert } from '../../../components/ui/Feedback';
import { Input, Select } from '../../../components/ui/form';
import { formatDeltaPercent, StatTile } from '../../../components/ui/StatTile';
import { Table, useCsvDownload, type TableColumn } from '../../../components/ui/Table';
import { dreExportUrl, dreFileName, useFinanceSummary } from '../../../features/admin-finance/api';
import type { FinanceSummary, FinanceTotals } from '../../../features/admin-finance/contracts';
import {
  GROUPING_LABELS,
  REGIME_LABELS,
  REVENUE_CATEGORY_LABELS,
} from '../../../features/admin-finance/labels';
import {
  formatRange,
  readFinanceParams,
  todayLocal,
  validateFinanceParams,
} from '../../../features/admin-finance/period';
import { messageOf } from '../../../lib/api-errors';

type ParamKey = 'from' | 'to' | 'grouping' | 'regime';

const REGIME_HELP: Record<keyof typeof REGIME_LABELS, string> = {
  cash: 'Cada valor conta no dia em que foi recebido.',
  accrual: 'Cada valor conta no dia em que a sala é usada.',
};

interface SummaryRow {
  key: string;
  label: string;
  current: number;
  previous: number;
  deltaPercent: number | null;
  strong: boolean;
}

function summaryRows(summary: FinanceSummary): SummaryRow[] {
  const line = (key: keyof FinanceTotals, label: string, strong = false): SummaryRow => ({
    key,
    label,
    current: summary.totals[key],
    previous: summary.previous[key],
    deltaPercent: summary.comparison[key].deltaPercent,
    strong,
  });
  return [
    line('grossCents', '1. Receita bruta'),
    line('discountsCents', '2. (−) Descontos, cupons e créditos concedidos'),
    line('refundsCents', '3. (−) Estornos e reembolsos'),
    line('feesCents', '4. (−) Taxas do gateway de pagamento'),
    line('netCents', '5. = Receita líquida', true),
    line('expensesCents', '6. (−) Despesas operacionais'),
    line('resultCents', '7. = Resultado do período', true),
  ];
}

const isEmpty = (summary: FinanceSummary): boolean =>
  [summary.totals, summary.previous].every((totals) =>
    (['grossCents', 'discountsCents', 'refundsCents', 'feesCents', 'expensesCents'] as const).every(
      (key) => totals[key] === 0,
    ),
  );

function LoadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando o resumo financeiro"
      aria-busy="true"
      className="space-y-space-md"
    >
      <div className="grid gap-space-md md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-lg bg-surface-deboss shadow-deboss"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-surface-deboss shadow-deboss" />
    </div>
  );
}

function SummaryTables({ summary }: { summary: FinanceSummary }) {
  const rows = summaryRows(summary);
  const columns: readonly TableColumn<SummaryRow>[] = [
    {
      id: 'line',
      header: 'Linha',
      cell: (row) => <span className={cx(row.strong && 'font-medium')}>{row.label}</span>,
    },
    {
      id: 'current',
      header: 'Período atual',
      align: 'right',
      cell: (row) => (
        <span className={cx(row.strong && 'font-medium')}>{formatBRL(row.current)}</span>
      ),
    },
    {
      id: 'previous',
      header: 'Período anterior',
      align: 'right',
      cell: (row) => formatBRL(row.previous),
    },
    {
      id: 'delta',
      header: 'Variação',
      align: 'right',
      cell: (row) => formatDeltaPercent(row.deltaPercent),
    },
  ];

  const revenue = REVENUE_CATEGORIES.map((category) => ({
    category,
    cents: summary.byRevenueCategory[category],
  })).filter((row) => row.cents !== 0);
  const expenses = [...summary.byExpenseCategory]
    .filter((row) => row.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));

  return (
    <div className="space-y-space-lg">
      <Table
        caption="Resumo do período e comparação com o período anterior"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
      />
      <div className="grid gap-space-lg lg:grid-cols-2">
        <Table
          caption="Receita bruta por categoria"
          columns={[
            {
              id: 'category',
              header: 'Receita bruta por categoria',
              cell: (r) => REVENUE_CATEGORY_LABELS[r.category],
            },
            { id: 'cents', header: 'Valor', align: 'right', cell: (r) => formatBRL(r.cents) },
          ]}
          rows={revenue}
          rowKey={(r) => r.category}
          emptyMessage="Sem receita no período."
        />
        <Table
          caption="Despesas por categoria"
          columns={[
            { id: 'category', header: 'Despesas por categoria', cell: (r) => r.name },
            // Expenses arrive as deductions (negative); the table lists the amount spent.
            {
              id: 'cents',
              header: 'Valor',
              align: 'right',
              cell: (r) => formatBRL(Math.abs(r.cents)),
            },
          ]}
          rows={expenses}
          rowKey={(r) => r.id}
          emptyMessage="Sem despesas no período."
        />
      </div>
    </div>
  );
}

export interface FinanceOverviewPageProps {
  /** Clinic-local date used for the default range; the real date unless a test injects one. */
  today?: LocalDate;
}

/**
 * `/admin/financeiro` Visão geral (GES-26..GES-28): regime, grouping and range live in the URL
 * search params (so the DRE export reuses them), with net revenue, expenses and result against the
 * previous range, the evolution chart and the breakdown tables.
 */
export function FinanceOverviewPage({ today }: FinanceOverviewPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = readFinanceParams(searchParams, today ?? todayLocal());
  const validation = validateFinanceParams(raw);
  const query = validation.ok ? validation.query : null;
  const summary = useFinanceSummary(query);
  const { download, pending: exporting, error: exportError } = useCsvDownload();

  const setParam = (key: ParamKey, value: string) => {
    if (value === '') return;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(key, value);
        return next;
      },
      { replace: false },
    );
  };

  const data = summary.data;
  const showSkeleton = query !== null && data === undefined && !summary.isError;

  return (
    <div className="space-y-space-lg">
      <div className="flex flex-wrap items-end gap-space-md">
        <fieldset className="min-w-[14rem]">
          <legend className="mb-space-sm font-small text-small text-ink">Regime</legend>
          {/* Radios styled as v3 chips: the checked one is emerald with the neon lit. */}
          <div className="bv-chips">
            {(['cash', 'accrual'] as const).map((regime) => (
              <label
                key={regime}
                className={cx(
                  'bv-chip has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface',
                  raw.regime === regime && 'is-selected',
                )}
              >
                <input
                  type="radio"
                  name="finance-regime"
                  value={regime}
                  checked={raw.regime === regime}
                  onChange={() => {
                    setParam('regime', regime);
                  }}
                  className="sr-only"
                />
                {REGIME_LABELS[regime]}
              </label>
            ))}
          </div>
        </fieldset>
        <Select
          label="Agrupar por"
          value={raw.grouping}
          onChange={(event) => {
            setParam('grouping', event.target.value);
          }}
          className="w-40"
        >
          {(Object.keys(GROUPING_LABELS) as (keyof typeof GROUPING_LABELS)[]).map((grouping) => (
            <option key={grouping} value={grouping}>
              {GROUPING_LABELS[grouping]}
            </option>
          ))}
        </Select>
        <Input
          label="De"
          type="date"
          value={raw.from}
          onChange={(event) => {
            setParam('from', event.target.value);
          }}
        />
        <Input
          label="Até"
          type="date"
          value={raw.to}
          error={validation.ok ? undefined : validation.message}
          onChange={(event) => {
            setParam('to', event.target.value);
          }}
        />
        <div className="ml-auto">
          {query ? (
            <Button asChild variant="secondary" leadingIcon={Download} loading={exporting}>
              <a
                href={dreExportUrl(query)}
                download={dreFileName(query)}
                onClick={(event) => {
                  event.preventDefault();
                  void download(dreExportUrl(query), dreFileName(query));
                }}
              >
                Exportar DRE (.xlsx)
              </a>
            </Button>
          ) : (
            <Button variant="secondary" leadingIcon={Download} disabled>
              Exportar DRE (.xlsx)
            </Button>
          )}
        </div>
      </div>
      <p className="font-caption text-caption text-ink-muted">
        {REGIME_LABELS[raw.regime]}: {REGIME_HELP[raw.regime]}
      </p>
      {exportError ? (
        <Alert tone="error">
          {messageOf(exportError, 'Não foi possível exportar a DRE agora.')}
        </Alert>
      ) : null}

      {showSkeleton ? <LoadingSkeleton /> : null}
      {summary.isError ? (
        <Alert tone="error">
          <p>{messageOf(summary.error, 'Não foi possível carregar o resumo financeiro.')}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-space-sm"
            onClick={() => {
              void summary.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {data && isEmpty(data) ? (
        <Alert tone="info">
          Nenhum movimento financeiro no período de {formatRange(data.from, data.to)}. Escolha outro
          período ou regime.
        </Alert>
      ) : null}
      {data && !isEmpty(data) ? (
        <div className="space-y-space-lg" aria-busy={summary.isPlaceholderData}>
          <div className="grid gap-space-md md:grid-cols-3">
            <StatTile
              label="Receita líquida"
              valueCents={data.totals.netCents}
              delta={{
                cents: data.comparison.netCents.deltaCents,
                percent: data.comparison.netCents.deltaPercent,
              }}
              deltaLabel={`vs. ${formatRange(data.previous.from, data.previous.to)}`}
            />
            <StatTile
              label="Despesas"
              valueCents={Math.abs(data.totals.expensesCents)}
              // Expenses are deductions; the tile shows the amount spent, so a rise reads as +.
              delta={{
                cents: -data.comparison.expensesCents.deltaCents,
                percent:
                  data.comparison.expensesCents.deltaPercent === null
                    ? null
                    : -data.comparison.expensesCents.deltaPercent,
              }}
              deltaLabel={`vs. ${formatRange(data.previous.from, data.previous.to)}`}
              higherIsBetter={false}
            />
            {/* The one gold tile of the screen: every line of it reads in on-gold (Dia and Noite). */}
            <StatTile
              className="bg-grad-gold [&_*]:!text-on-gold"
              label="Resultado"
              valueCents={data.totals.resultCents}
              delta={{
                cents: data.comparison.resultCents.deltaCents,
                percent: data.comparison.resultCents.deltaPercent,
              }}
              deltaLabel={`vs. ${formatRange(data.previous.from, data.previous.to)}`}
            />
          </div>
          <section
            aria-labelledby="finance-evolution"
            className="space-y-space-sm rounded-lg bg-surface-raised p-space-lg shadow-card"
          >
            <h2 id="finance-evolution" className="font-heading text-heading-mobile text-ink">
              Evolução
            </h2>
            <EvolutionChart
              buckets={data.buckets}
              caption={`Evolução de ${formatRange(data.from, data.to)} por ${GROUPING_LABELS[data.grouping].toLowerCase()}`}
            />
          </section>
          <SummaryTables summary={data} />
        </div>
      ) : null}
    </div>
  );
}
