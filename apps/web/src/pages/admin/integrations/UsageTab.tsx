import { useId, type ReactNode } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';
import { Table, type TableColumn } from '../../../components/ui/Table';
import { cx } from '../../../components/ui/cx';
import { useUsage } from '../../../features/admin-integrations/api';
import type { UsageReport } from '../../../features/admin-integrations/contracts';
import { formatBytes } from '../../../features/admin-integrations/labels';
import { messageOf } from '../../../lib/api-errors';

const number = new Intl.NumberFormat('pt-BR');
const percentFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

interface BarProps {
  label: string;
  percent: number;
  warning: boolean;
}

/** A horizontal meter; the warning tone is the error color plus the text next to it. */
function Bar({ label, percent, warning }: BarProps) {
  return (
    <div className="flex items-center gap-space-sm">
      <progress
        value={percent}
        max={100}
        aria-label={label}
        className={cx('h-2 w-full max-w-sm', warning ? 'accent-error' : 'accent-bronze')}
      />
      <span className={cx('font-small text-small', warning ? 'text-error' : 'text-ink-muted')}>
        {percentFormat.format(percent)}%
      </span>
    </div>
  );
}

interface MeterProps {
  title: string;
  warning: boolean;
  children: ReactNode;
}

/** One usage item: a titled region that carries the warning state and its text (GES-138). */
function Meter({ title, warning, children }: MeterProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-warning={warning}
      className={cx(
        'space-y-space-sm rounded-card border p-space-lg',
        warning ? 'border-error bg-error-container/40' : 'border-hairline bg-surface-raised',
      )}
    >
      <header className="flex flex-wrap items-center gap-space-sm">
        <h2 id={headingId} className="font-heading text-heading-mobile text-ink">
          {title}
        </h2>
        {warning ? <Badge tone="error">Perto do limite</Badge> : null}
      </header>
      {children}
    </section>
  );
}

const BUCKET_LABELS = {
  'room-photos': 'Fotos das salas',
  'expense-attachments': 'Anexos de despesas',
} as const;

const tableColumns: readonly TableColumn<UsageReport['largestTables'][number]>[] = [
  { id: 'name', header: 'Tabela', cell: (t) => <code className="font-mono">{t.name}</code> },
  { id: 'size', header: 'Tamanho', align: 'right', cell: (t) => formatBytes(t.totalBytes) },
  {
    id: 'rows',
    header: 'Linhas (estimado)',
    align: 'right',
    cell: (t) => number.format(t.estimatedRows),
  },
];

const percentOf = (used: number, limit: number): number => (limit > 0 ? (used / limit) * 100 : 0);

/** Consumo tab: free-tier meters for the database, files and e-mails (GES-137..GES-139). */
export function UsageTab() {
  const usage = useUsage();

  if (usage.isPending) return <Spinner label="Carregando o consumo" />;
  if (usage.isError) {
    return (
      <Alert tone="error">
        <p>{messageOf(usage.error, 'Não foi possível carregar o consumo.')}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-space-sm"
          onClick={() => {
            void usage.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </Alert>
    );
  }

  const { db, storage, emails, largestTables } = usage.data;
  const monthPercent = percentOf(emails.month, emails.monthLimit);
  const dayPercent = percentOf(emails.today, emails.dayLimit);

  return (
    <div className="space-y-space-lg">
      <Meter title="Banco de dados" warning={db.warning}>
        <p className="font-small text-small text-ink">
          {formatBytes(db.bytes)} de {formatBytes(db.limitBytes)}
        </p>
        <Bar label="Banco de dados" percent={db.percent} warning={db.warning} />
      </Meter>

      <Meter title="Armazenamento de arquivos" warning={storage.warning}>
        {storage.storageError ? (
          <Alert tone="error">{storage.storageError}</Alert>
        ) : (
          <>
            <p className="font-small text-small text-ink">
              {formatBytes(storage.bytes ?? 0)} de {formatBytes(storage.limitBytes)}
            </p>
            {storage.percent !== null ? (
              <Bar
                label="Armazenamento de arquivos"
                percent={storage.percent}
                warning={storage.warning}
              />
            ) : null}
            {storage.buckets ? (
              <ul className="font-caption text-caption text-ink-muted">
                {(Object.keys(BUCKET_LABELS) as (keyof typeof BUCKET_LABELS)[]).map((bucket) => (
                  <li key={bucket}>
                    {BUCKET_LABELS[bucket]}: {formatBytes(storage.buckets?.[bucket] ?? 0)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Meter>

      <Meter title="E-mails enviados" warning={emails.warning}>
        <p className="font-small text-small text-ink">
          {number.format(emails.month)} de {number.format(emails.monthLimit)} no mês
        </p>
        <Bar label="E-mails no mês" percent={monthPercent} warning={monthPercent >= 80} />
        <p className="font-small text-small text-ink">
          {number.format(emails.today)} de {number.format(emails.dayLimit)} hoje
        </p>
        <Bar label="E-mails hoje" percent={dayPercent} warning={dayPercent >= 80} />
      </Meter>

      <section className="space-y-space-sm">
        <h2 className="font-heading text-heading-mobile text-ink">Maiores tabelas</h2>
        <Table
          caption="Maiores tabelas do banco"
          columns={tableColumns}
          rows={largestTables}
          rowKey={(t) => t.name}
          emptyMessage="Nenhuma tabela encontrada."
        />
      </section>
    </div>
  );
}
