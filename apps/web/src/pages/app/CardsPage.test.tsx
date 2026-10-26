import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ID, me, savedCard } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { CardsPage, CONSENT_TEXT } from './CardsPage';

function renderCards() {
  server.use(
    http.get('*/api/app/me', () => HttpResponse.json(me)),
    http.get('*/api/app/cards', () =>
      HttpResponse.json({ items: [{ ...savedCard, expYear: 2029 }] }),
    ),
  );
  return renderWithProviders(
    <Routes>
      <Route path="/app/perfil/cartoes" element={<CardsPage />} />
    </Routes>,
    '/app/perfil/cartoes',
  );
}

describe('CardsPage (NUC-194)', () => {
  it('lists the saved cards with brand, last four digits and expiry', async () => {
    renderCards();

    expect(await screen.findByText('Visa final 4242 · 12/2029')).toBeInTheDocument();
  });

  it('keeps "Adicionar cartão" disabled until the consent is checked', async () => {
    renderCards();
    await screen.findByText('Visa final 4242 · 12/2029');
    await userEvent.type(screen.getByLabelText('Número do cartão'), '4242424242424242');

    const add = screen.getByRole('button', { name: 'Adicionar cartão' });
    expect(add).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_TEXT }));
    expect(add).toBeEnabled();
  });

  it('sends only the sandbox token and the consent to the API, never the card number', async () => {
    let raw = '';
    server.use(
      http.post('*/api/app/cards', async ({ request }) => {
        raw = await request.text();
        return HttpResponse.json(savedCard, { status: 201 });
      }),
    );
    renderCards();
    await screen.findByText('Visa final 4242 · 12/2029');

    await userEvent.type(screen.getByLabelText('Número do cartão'), '4242 4242 4242 4242');
    await userEvent.type(screen.getByLabelText('Nome impresso no cartão'), 'CAMILA SOUZA');
    await userEvent.type(screen.getByLabelText('Mês'), '12');
    await userEvent.type(screen.getByLabelText('Ano'), '2030');
    await userEvent.type(screen.getByLabelText('CVV'), '123');
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_TEXT }));
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar cartão' }));

    expect(await screen.findByText('Cartão salvo.')).toBeInTheDocument();
    expect(JSON.parse(raw)).toEqual({ cardToken: 'tok_sandbox_4242', recurringConsent: true });
    expect(raw).not.toContain('4242 4242');
    expect(raw).not.toContain('4242424242424242');
    expect(raw).not.toContain('123');
  });

  it('asks for confirmation before removing a card', async () => {
    let removed: string | undefined;
    server.use(
      http.delete('*/api/app/cards/:id', ({ params }) => {
        removed = params['id'] as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderCards();

    await userEvent.click(await screen.findByRole('button', { name: /^Remover Visa final 4242/ }));
    expect(removed).toBeUndefined();
    const dialog = screen.getByRole('dialog', { name: 'Remover cartão' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar remoção' }));

    await screen.findByText('Visa final 4242 · 12/2029');
    expect(removed).toBe(ID.card);
  });

  it('keeps the card when the removal is cancelled', async () => {
    renderCards();

    await userEvent.click(await screen.findByRole('button', { name: /^Remover Visa final 4242/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Manter cartão' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Visa final 4242 · 12/2029')).toBeInTheDocument();
  });
});
