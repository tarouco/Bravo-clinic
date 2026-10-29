import { formatBRL } from '@bravo/core';
import { Link } from 'react-router-dom';
import { PriceTag } from '../../components/booking/PriceTag';
import { Eyebrow } from '../../components/ui/Brand';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Table, type TableColumn } from '../../components/ui/Table';
import { useCatalog } from '../../features/catalog/api';
import { Slot } from '../../extensions/slots';
import { formatDuration, formatMinuteRange, formatWeekdays } from '../../lib/format';
import { usePageTitle } from '../../lib/usePageTitle';

type Hourly = NonNullable<ReturnType<typeof useCatalog>['data']>['hourly'][number];
type Block = NonNullable<ReturnType<typeof useCatalog>['data']>['blocks'][number];

const hourlyColumns: TableColumn<Hourly>[] = [
  { id: 'name', header: 'Categoria', cell: (c) => c.name },
  { id: 'window', header: 'Horário', cell: (c) => formatMinuteRange(c.startMinute, c.endMinute) },
  { id: 'min', header: 'Duração mínima', cell: (c) => formatDuration(c.minDurationMinutes) },
  {
    id: 'weekday',
    header: 'Dias úteis',
    cell: (c) => <PriceTag cents={c.weekdayRateCents} unit="/h" />,
    align: 'right',
  },
  {
    id: 'weekend',
    header: 'Fins de semana e feriados',
    cell: (c) => <PriceTag cents={c.weekendRateCents} unit="/h" />,
    align: 'right',
  },
];

const blockColumns: TableColumn<Block>[] = [
  { id: 'name', header: 'Bloco', cell: (b) => b.name },
  { id: 'days', header: 'Dias', cell: (b) => formatWeekdays(b.weekdays, b.appliesOnHolidays) },
  { id: 'window', header: 'Horário', cell: (b) => formatMinuteRange(b.startMinute, b.endMinute) },
  {
    id: 'price',
    header: 'Valor do bloco',
    cell: (b) => formatBRL(b.fixedPriceCents),
    align: 'right',
  },
  {
    id: 'average',
    header: 'Valor médio da hora',
    cell: (b) => <PriceTag cents={b.averageHourlyCents} unit="/h" />,
    align: 'right',
  },
];

/** `/precos`: hourly and block rates from the catalog, then the `pricing.packages` slot. */
export function PricingPage() {
  usePageTitle('Preços');
  const { data, isPending, isError } = useCatalog();

  return (
    <section className="mx-auto max-w-7xl space-y-space-2xl px-gutter py-space-3xl">
      <div className="max-w-2xl space-y-space-xs">
        <Eyebrow>Tarifas transparentes</Eyebrow>
        <h1 className="font-display text-display-l-mobile text-ink md:text-display-l">
          Preços e pacotes
        </h1>
        <p className="font-body text-body text-ink-muted">
          Reservando 2 horas ou mais, a tarifa com desconto vale para todas as horas. Cada reserva
          inclui o tempo de limpeza após o atendimento.
        </p>
      </div>

      {isPending ? (
        <div className="flex justify-center py-space-2xl">
          <Spinner label="Carregando tarifas" />
        </div>
      ) : isError ? (
        <Alert tone="error">Não foi possível carregar as tarifas agora.</Alert>
      ) : (
        <>
          <div className="space-y-space-sm">
            <h2 className="font-heading text-heading-mobile text-ink md:text-heading">
              Tarifas por hora
            </h2>
            <Table
              caption="Tarifas por hora"
              columns={hourlyColumns}
              rows={[...data.hourly].sort((a, b) => a.displayOrder - b.displayOrder)}
              rowKey={(c) => c.id}
            />
          </div>
          {data.blocks.length > 0 ? (
            <div className="space-y-space-sm">
              <h2 className="font-heading text-heading-mobile text-ink md:text-heading">
                Blocos fechados
              </h2>
              <Table
                caption="Blocos fechados"
                columns={blockColumns}
                rows={data.blocks}
                rowKey={(b) => b.id}
              />
            </div>
          ) : null}
        </>
      )}

      <Slot name="pricing.packages" />

      <Button asChild>
        <Link to="/salas">Ver salas e horários</Link>
      </Button>
    </section>
  );
}
