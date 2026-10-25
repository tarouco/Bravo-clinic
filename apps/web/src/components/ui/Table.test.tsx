import { render, renderHook, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { Table, useCsvDownload, type TableColumn } from './Table';

interface Row {
  code: string;
  total: number;
}

const ROWS: Row[] = [
  { code: 'BRV-BBBBBB', total: 9700 },
  { code: 'BRV-CCCCCC', total: 21900 },
  { code: 'BRV-AAAAAA', total: 12000 },
];

const COLUMNS: TableColumn<Row>[] = [
  { id: 'code', header: 'Código', cell: (r) => r.code, sortValue: (r) => r.code },
  { id: 'total', header: 'Total', cell: (r) => r.total, sortValue: (r) => r.total, align: 'right' },
  { id: 'note', header: 'Observação', cell: () => '—' },
];

const codes = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

function renderTable(defaultSort?: { columnId: string; direction: 'asc' | 'desc' }) {
  render(
    <Table
      caption="Reservas"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => r.code}
      {...(defaultSort ? { defaultSort } : {})}
    />,
  );
}

describe('Table', () => {
  it('sorts by a column ascending, then descending, and flags aria-sort', async () => {
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Código' }));
    expect(codes()).toEqual(['BRV-AAAAAA', 'BRV-BBBBBB', 'BRV-CCCCCC']);
    expect(screen.getByRole('columnheader', { name: 'Código' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Código' }));
    expect(codes()).toEqual(['BRV-CCCCCC', 'BRV-BBBBBB', 'BRV-AAAAAA']);
    expect(screen.getByRole('columnheader', { name: 'Código' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('compares numeric columns by value, not as text', async () => {
    renderTable();

    await userEvent.click(screen.getByRole('button', { name: 'Total' }));

    expect(codes()).toEqual(['BRV-BBBBBB', 'BRV-AAAAAA', 'BRV-CCCCCC']);
  });

  it('applies the default sort and leaves non-sortable columns without a button', () => {
    renderTable({ columnId: 'total', direction: 'desc' });

    expect(codes()).toEqual(['BRV-CCCCCC', 'BRV-AAAAAA', 'BRV-BBBBBB']);
    expect(screen.queryByRole('button', { name: 'Observação' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Observação' })).not.toHaveAttribute(
      'aria-sort',
    );
  });

  it('keeps the header sticky and names the table by its caption', () => {
    renderTable();

    expect(screen.getByRole('table', { name: 'Reservas' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Código' })).toHaveClass('sticky', 'top-0');
  });

  it('shows the empty message when there are no rows', () => {
    render(
      <Table
        caption="Reservas"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r: Row) => r.code}
        emptyMessage="Nenhuma reserva encontrada."
      />,
    );

    expect(screen.getByText('Nenhuma reserva encontrada.')).toBeInTheDocument();
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.readAsText(blob);
  });
}

describe('useCsvDownload', () => {
  let downloaded: { filename: string; href: string } | null;
  let blobs: Blob[];
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    downloaded = null;
    blobs = [];
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return 'blob:csv-1';
    });
    revokeObjectURL = vi.fn();
    URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = { filename: this.download, href: this.href };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves the response body under the given filename', async () => {
    server.use(
      http.get(
        '*/api/admin/bookings/export.csv',
        () =>
          new HttpResponse('Código;Cliente\r\nBRV-AAAAAA;Camila', {
            headers: { 'Content-Type': 'text/csv; charset=utf-8' },
          }),
      ),
    );
    const { result } = renderHook(() => useCsvDownload());

    await act(() => result.current.download('/api/admin/bookings/export.csv', 'reservas.csv'));

    expect(downloaded).toEqual({ filename: 'reservas.csv', href: 'blob:csv-1' });
    expect(await readBlob(blobs[0] as Blob)).toBe('Código;Cliente\r\nBRV-AAAAAA;Camila');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv-1');
    expect(result.current.error).toBeNull();
  });

  it('exposes the API error and downloads nothing when the export is refused', async () => {
    server.use(
      http.get('*/api/admin/bookings/export.csv', () =>
        apiError(422, 'VALIDATION_FAILED', 'Refine os filtros (máximo de 5.000 linhas).'),
      ),
    );
    const { result } = renderHook(() => useCsvDownload());

    await act(() => result.current.download('/api/admin/bookings/export.csv', 'reservas.csv'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('Refine os filtros (máximo de 5.000 linhas).');
    expect(downloaded).toBeNull();
  });
});
