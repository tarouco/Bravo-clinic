import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { cx, focusRing } from './cx';
import { Icon } from './Icon';

export type SortDirection = 'asc' | 'desc';

export interface TableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Makes the column sortable by this value (numbers compare numerically, text in pt-BR). */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
}

export interface TableProps<T> {
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Accessible name of the table. */
  caption: string;
  defaultSort?: { columnId: string; direction: SortDirection };
  emptyMessage?: string;
  /** `compact` tightens the rows; allowed only in the Admin (DESIGN-v3.md, AD-042). */
  density?: 'comfortable' | 'compact';
  className?: string;
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR');
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/**
 * Sortable table with a sticky header inside a scroll container: pearl rows with hairline
 * separators in a 24px rounded card, eyebrow header. No neon on rows (DESIGN-v3.md).
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  defaultSort,
  emptyMessage = 'Nada para mostrar.',
  density = 'comfortable',
  className,
}: TableProps<T>) {
  const [sort, setSort] = useState(defaultSort ?? null);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.id === sort?.columnId);
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => factor * compare(value(a), value(b)));
  }, [columns, rows, sort]);

  const toggle = (column: TableColumn<T>) => {
    setSort((current) =>
      current?.columnId === column.id
        ? { columnId: column.id, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { columnId: column.id, direction: 'asc' },
    );
  };

  return (
    // Focusable so a keyboard user can scroll a wide or long table (WCAG 2.1.1).
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cx(
        'max-h-[70vh] overflow-auto rounded-md bg-surface-raised shadow-card',
        focusRing,
        className,
      )}
    >
      <table className="w-full border-collapse text-left font-small text-small text-ink">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.columnId === column.id ? sort.direction : null;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={column.sortValue ? (active ? ARIA_SORT[active] : 'none') : undefined}
                  className={cx(
                    'sticky top-0 z-10 border-b border-hairline bg-surface-raised px-space-md py-3 font-eyebrow text-eyebrow uppercase tracking-[0.32em] text-ink-muted',
                    column.align === 'right' && 'text-right',
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => {
                        toggle(column);
                      }}
                      className={cx(
                        'inline-flex items-center gap-space-xs rounded-pill uppercase tracking-[0.32em] hover:text-ink',
                        focusRing,
                      )}
                    >
                      {column.header}
                      <Icon
                        as={
                          active === 'asc'
                            ? ArrowUp
                            : active === 'desc'
                              ? ArrowDown
                              : ChevronsUpDown
                        }
                        size={14}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-space-md py-space-lg text-center text-ink-muted"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={rowKey(row)} className="border-b border-hairline last:border-b-0">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cx(
                      'px-space-md',
                      density === 'compact' ? 'py-2' : 'py-3',
                      column.align === 'right' && 'text-right',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Downloads a CSV from the API as a file ("Exportar CSV"). `download(url, filename)` fetches the
 * body and saves it through a temporary link; failures surface as `error` (an `ApiError`).
 */
export function useCsvDownload() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const download = useCallback(async (url: string, filename: string) => {
    setPending(true);
    setError(null);
    try {
      const blob = await api.blob(url);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('Falha ao exportar o arquivo.'));
    } finally {
      setPending(false);
    }
  }, []);

  return { download, pending, error };
}
