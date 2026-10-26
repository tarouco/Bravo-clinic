import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { disableAnalytics, enableGa4, gtagEvents } from '../../test/analytics';
import { bookingList, me } from '../../test/fixtures/nucleo';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { publicExtraServices, PUBLIC_SERVICE_IDS } from './fixtures';
import { QuoteRequestForm } from './QuoteRequestForm';

type Post = Record<string, unknown>;

afterEach(() => {
  disableAnalytics();
});

/** Serves the catalog and records the bodies posted to the quote endpoint. */
function stubApi(options: { anonymous?: boolean; post?: () => Response } = {}): Post[] {
  const posts: Post[] = [];
  server.use(
    http.get('*/api/public/extra-services', () => HttpResponse.json(publicExtraServices)),
    http.post('*/api/public/quote-requests', async ({ request }) => {
      posts.push((await request.json()) as Post);
      return options.post ? options.post() : HttpResponse.json({ id: 'q1' }, { status: 201 });
    }),
  );
  server.use(
    options.anonymous
      ? http.get('*/api/app/me', () => apiError(401, 'UNAUTHENTICATED', 'Entre para continuar.'))
      : http.get('*/api/app/me', () => HttpResponse.json(me)),
  );
  return posts;
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText('Serviço'), PUBLIC_SERVICE_IDS.filming);
  await user.type(screen.getByLabelText('Seu nome completo'), 'Dra. Mariana Costa');
  await user.type(screen.getByLabelText('WhatsApp de contato'), '47987654321');
  await user.type(screen.getByLabelText('O que você precisa'), 'Quatro horas de gravação');
}

describe('QuoteRequestForm validation (GES-90)', () => {
  it('shows the schema messages and posts nothing for an empty form', async () => {
    const posts = stubApi({ anonymous: true });
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);

    await user.click(await screen.findByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText('Escolha o serviço', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Informe seu nome com pelo menos 2 caracteres')).toBeInTheDocument();
    expect(screen.getByText('Telefone inválido. Use DDD + número')).toBeInTheDocument();
    expect(
      screen.getByText('Informe o que você precisa com pelo menos 10 caracteres'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Seu nome completo')).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toHaveLength(0);
  });

  it('rejects a desired date outside today..today + 365', async () => {
    const posts = stubApi({ anonymous: true });
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);
    await fillValid(user);

    await user.type(screen.getByLabelText('Data desejada (opcional)'), '2020-01-01');
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText(/Escolha uma data entre/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });
});

describe('QuoteRequestForm submit (GES-98)', () => {
  it('posts the normalized body, shows the success message and clears the form', async () => {
    const posts = stubApi({ anonymous: true });
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);
    await fillValid(user);

    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText('Pedido enviado. Retornaremos em breve.')).toBeInTheDocument();
    expect(posts).toEqual([
      {
        serviceId: PUBLIC_SERVICE_IDS.filming,
        name: 'Dra. Mariana Costa',
        phone: '+5547987654321',
        description: 'Quatro horas de gravação',
        website: '',
      },
    ]);
    expect(screen.getByLabelText('Seu nome completo')).toHaveValue('');
  });

  it('shows the rate-limit message on a 429 and keeps what was typed', async () => {
    stubApi({
      anonymous: true,
      post: () => apiError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas.'),
    });
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);
    await fillValid(user);

    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(
      await screen.findByText(
        'Você enviou muitos pedidos em pouco tempo. Tente novamente mais tarde.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Pedido enviado. Retornaremos em breve.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Seu nome completo')).toHaveValue('Dra. Mariana Costa');
  });

  it('selects the service whose catalog row the caller matches', async () => {
    stubApi({ anonymous: true });
    renderWithProviders(<QuoteRequestForm preselect={(row) => /videomaker/i.test(row.name)} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Serviço')).toHaveValue(PUBLIC_SERVICE_IDS.videomaker),
    );
  });
});

describe('QuoteRequestForm analytics (GES-135)', () => {
  it('tracks quote_requested once after a successful submit and nothing before', async () => {
    enableGa4();
    stubApi({ anonymous: true });
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);
    await fillValid(user);
    expect(gtagEvents().filter((event) => event.name === 'quote_requested')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    await screen.findByText('Pedido enviado. Retornaremos em breve.');
    const events = gtagEvents().filter((event) => event.name === 'quote_requested');
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain('Mariana');
  });

  it('does not track a request the API refused', async () => {
    enableGa4();
    stubApi({
      anonymous: true,
      post: () => apiError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas.'),
    });
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);
    await fillValid(user);

    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    await screen.findByText(/muitos pedidos/);
    expect(gtagEvents().filter((event) => event.name === 'quote_requested')).toHaveLength(0);
  });
});

describe('QuoteRequestForm honeypot (GES-93)', () => {
  it('keeps the website field away from users, keyboard and assistive tech', async () => {
    stubApi({ anonymous: true });
    const { container } = renderWithProviders(<QuoteRequestForm />);
    await screen.findByLabelText('Serviço');

    const trap = container.querySelector<HTMLInputElement>('input[name="website"]');
    expect(trap).not.toBeNull();
    expect(trap?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap).toHaveAttribute('tabindex', '-1');
    expect(trap).toHaveAttribute('autocomplete', 'off');
    // Nothing in the accessibility tree names it, so no label could reveal it either.
    expect(screen.queryByRole('textbox', { name: /website/i })).not.toBeInTheDocument();
  });
});

describe('QuoteRequestForm linked booking (GES-91)', () => {
  it('offers the tenant their upcoming bookings and sends the chosen id', async () => {
    const posts = stubApi();
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);
    await fillValid(user);

    const booking = bookingList.items[0];
    if (!booking) throw new Error('fixture without bookings');
    const select = await screen.findByLabelText('Reserva vinculada (opcional)');
    expect(select).toHaveValue('');
    await user.selectOptions(
      select,
      await screen.findByRole('option', { name: new RegExp(booking.code) }),
    );
    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText('Pedido enviado. Retornaremos em breve.')).toBeInTheDocument();
    expect(posts[0]).toMatchObject({ bookingId: booking.id });
  });

  it('hides the booking select from a visitor without a session', async () => {
    stubApi({ anonymous: true });
    renderWithProviders(<QuoteRequestForm />);
    await screen.findByLabelText('Serviço');

    expect(screen.queryByLabelText('Reserva vinculada (opcional)')).not.toBeInTheDocument();
  });

  it('shows the API 422 on bookingId under the booking select', async () => {
    stubApi({
      post: () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Dados inválidos.',
              details: [{ path: 'bookingId', message: 'Reserva não encontrada' }],
            },
          },
          { status: 422 },
        ),
    });
    const user = userEvent.setup();
    renderWithProviders(<QuoteRequestForm />);
    await fillValid(user);
    const booking = bookingList.items[0];
    if (!booking) throw new Error('fixture without bookings');
    await user.selectOptions(
      await screen.findByLabelText('Reserva vinculada (opcional)'),
      await screen.findByRole('option', { name: new RegExp(booking.code) }),
    );

    await user.click(screen.getByRole('button', { name: 'Enviar pedido' }));

    expect(await screen.findByText('Reserva não encontrada')).toBeInTheDocument();
  });
});
