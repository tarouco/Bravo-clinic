import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  buildCustomerList,
  buildManyCustomers,
  CUSTOMER_IDS,
} from '../../../features/admin-customers/fixtures';
import { apiError } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderWithProviders } from '../../../test/render-with-providers';
import { CustomersPage } from './CustomersPage';

function stubList(respond: (url: URL) => Response | ReturnType<typeof HttpResponse.json>) {
  const requests: URL[] = [];
  server.use(
    http.get('*/api/admin/customers', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return respond(url);
    }),
  );
  return requests;
}

describe('CustomersPage list (GES-99)', () => {
  it('lists customers with name link, e-mail, phone and masked document', async () => {
    const requests = stubList(() => HttpResponse.json(buildCustomerList()));
    renderWithProviders(<CustomersPage />);

    const link = await screen.findByRole('link', { name: 'Ana Souza' });
    expect(link).toHaveAttribute('href', `/admin/clientes/${CUSTOMER_IDS.ana}`);
    const row = link.closest('tr') as HTMLElement;
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Ana Souza', 'ana@example.com', '(47) 99999-0001', '***.982.247-**']);
    expect(
      within(screen.getByRole('link', { name: 'Bruno Lima' }).closest('tr') as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Bruno Lima', 'bruno@example.com', '—', '—']);
    expect(requests[0]?.searchParams.get('q')).toBeNull();
  });

  it('sends one debounced request with the typed term', async () => {
    const requests = stubList((url) =>
      HttpResponse.json(
        url.searchParams.get('q') === 'ana'
          ? buildCustomerList(buildCustomerList().items.slice(0, 1))
          : buildCustomerList(),
      ),
    );
    renderWithProviders(<CustomersPage />);
    await screen.findByRole('link', { name: 'Bruno Lima' });

    await userEvent.type(screen.getByLabelText('Buscar cliente'), 'ana');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Bruno Lima' })).not.toBeInTheDocument();
    });
    const terms = requests.map((url) => url.searchParams.get('q'));
    expect(terms).toEqual([null, 'ana']);
  });

  it('shows an empty state naming the term when nothing matches', async () => {
    stubList((url) =>
      HttpResponse.json(
        buildCustomerList(url.searchParams.get('q') ? [] : buildCustomerList().items),
      ),
    );
    renderWithProviders(<CustomersPage />);
    await screen.findByRole('link', { name: 'Ana Souza' });

    await userEvent.type(screen.getByLabelText('Buscar cliente'), 'zzz');

    expect(await screen.findByText('Nenhum cliente encontrado para "zzz".')).toBeInTheDocument();
  });

  it('shows the empty state of an empty base without a term', async () => {
    stubList(() => HttpResponse.json(buildCustomerList([])));
    renderWithProviders(<CustomersPage />);

    expect(await screen.findByText('Nenhum cliente cadastrado.')).toBeInTheDocument();
  });

  it('loads the next page with the cursor when "Carregar mais" is clicked', async () => {
    const requests = stubList((url) =>
      HttpResponse.json(
        url.searchParams.get('cursor') === 'page-2'
          ? buildManyCustomers(51, 2, null)
          : buildManyCustomers(1, 50, 'page-2'),
      ),
    );
    renderWithProviders(<CustomersPage />);
    await screen.findByRole('link', { name: 'Cliente 50' });
    expect(screen.queryByRole('link', { name: 'Cliente 51' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByRole('link', { name: 'Cliente 51' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cliente 01' })).toBeInTheDocument();
    expect(requests.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'page-2']);
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('shows an error alert with retry when the API fails', async () => {
    let attempts = 0;
    stubList(() => {
      attempts += 1;
      // The first attempt and its automatic retry fail; the manual retry succeeds.
      return attempts <= 2
        ? apiError(500, 'INTERNAL', 'Falha ao buscar os clientes.')
        : HttpResponse.json(buildCustomerList());
    });
    renderWithProviders(<CustomersPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao buscar os clientes.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('link', { name: 'Ana Souza' })).toBeInTheDocument();
  });
});
