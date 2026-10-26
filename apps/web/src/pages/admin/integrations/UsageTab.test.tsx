import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  buildUsage,
  type UsageFixtureOptions,
} from '../../../features/admin-integrations/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { plain } from '../../../test/session';
import { UsageTab } from './UsageTab';

async function renderTab(options: UsageFixtureOptions = {}) {
  server.use(http.get('*/api/admin/usage', () => HttpResponse.json(buildUsage(options))));
  renderWithProviders(<UsageTab />);
  return screen.findByRole('region', { name: 'Banco de dados' });
}

describe('UsageTab figures (GES-137)', () => {
  it('shows each meter with its used amount, limit and percentage', async () => {
    const database = await renderTab();

    expect(plain(database.textContent)).toContain('320 MB de 512 MB');
    expect(database).toHaveTextContent('62,5%');
    expect(within(database).getByRole('progressbar', { name: 'Banco de dados' })).toHaveAttribute(
      'value',
      '62.5',
    );

    const storage = screen.getByRole('region', { name: 'Armazenamento de arquivos' });
    expect(plain(storage.textContent)).toContain('60 MB de 1 GB');
    expect(plain(storage.textContent)).toContain('Fotos das salas: 50 MB');
    expect(plain(storage.textContent)).toContain('Anexos de despesas: 10 MB');

    const emails = screen.getByRole('region', { name: 'E-mails enviados' });
    expect(plain(emails.textContent)).toContain('450 de 3.000 no mês');
    expect(plain(emails.textContent)).toContain('12 de 100 hoje');
  });

  it('lists the largest tables with size and estimated rows', async () => {
    await renderTab();

    const row = screen.getByText('audit_log').closest('tr') as HTMLElement;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => plain(c.textContent)),
    ).toEqual(['audit_log', '40 MB', '120.000']);
  });
});

describe('UsageTab warnings (GES-138)', () => {
  it('highlights a meter at or above 80 % with "Perto do limite" and leaves the others plain', async () => {
    const database = await renderTab({ dbPercent: 85 });

    expect(within(database).getByText('Perto do limite')).toBeInTheDocument();
    expect(database).toHaveAttribute('data-warning', 'true');
    expect(screen.getAllByText('Perto do limite')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Armazenamento de arquivos' })).toHaveAttribute(
      'data-warning',
      'false',
    );
  });

  it('shows no warning below 80 %', async () => {
    const database = await renderTab({ dbPercent: 79.9 });

    expect(database).toHaveAttribute('data-warning', 'false');
    expect(screen.queryByText('Perto do limite')).not.toBeInTheDocument();
  });
});

describe('UsageTab storage failure (GES-139)', () => {
  it('shows the storage error message and still shows the other figures', async () => {
    const database = await renderTab({ storageError: true });

    expect(plain(database.textContent)).toContain('320 MB de 512 MB');
    const storage = screen.getByRole('region', { name: 'Armazenamento de arquivos' });
    expect(within(storage).getByRole('alert')).toHaveTextContent(
      'Não foi possível consultar o armazenamento de arquivos.',
    );
    expect(within(storage).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'E-mails enviados' })).toBeInTheDocument();
  });
});

describe('UsageTab loading and errors', () => {
  it('shows a spinner then an error alert with retry', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/admin/usage', () => {
        attempts += 1;
        // The first attempt and its automatic retry fail; the manual retry succeeds.
        return attempts <= 2
          ? apiError(500, 'INTERNAL', 'Falha ao medir o consumo.')
          : HttpResponse.json(buildUsage());
      }),
    );
    renderWithProviders(<UsageTab />);

    expect(screen.getByRole('status', { name: 'Carregando o consumo' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao medir o consumo.');

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('region', { name: 'Banco de dados' })).toBeInTheDocument();
  });
});
