import { DOCUMENT_MESSAGE } from '@bravo/core';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { me } from '../../test/fixtures/nucleo';
import { apiError } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { ProfilePage } from './ProfilePage';

const NEXT = '/reservar?sala=principal&data=2026-10-27&inicio=1050&fim=1200&etapa=resumo';

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderProfile(route = '/app/perfil') {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/app/perfil" element={<ProfilePage />} />
        <Route path="/reservar" element={<p>fluxo de reserva</p>} />
      </Routes>
      <Where />
    </>,
    route,
  );
}

const withoutDocument = () => {
  server.use(
    http.get('*/api/app/me', () => HttpResponse.json({ ...me, document: null, docType: null })),
  );
};

describe('ProfilePage (NUC-193)', () => {
  it('focuses and highlights the document field with completar=1', async () => {
    withoutDocument();
    renderProfile('/app/perfil?completar=1');

    const field = await screen.findByLabelText('CPF ou CNPJ');
    expect(field).toHaveFocus();
    expect(field).toHaveClass('ring-2');
    expect(screen.getByText('Complete seu cadastro com CPF ou CNPJ para reservar.')).toBeVisible();
  });

  it('does not highlight the field without completar=1', async () => {
    withoutDocument();
    renderProfile();

    const field = await screen.findByLabelText('CPF ou CNPJ');
    expect(field).not.toHaveFocus();
    expect(field).not.toHaveClass('ring-2');
  });

  it('saves the document and then returns to the next URL', async () => {
    withoutDocument();
    let body: Record<string, unknown> | null = null;
    server.use(
      http.patch('*/api/app/me', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(me);
      }),
    );
    renderProfile(`/app/perfil?completar=1&next=${encodeURIComponent(NEXT)}`);

    await userEvent.type(await screen.findByLabelText('CPF ou CNPJ'), '52998224725');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('fluxo de reserva')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(NEXT);
    expect(body).toMatchObject({ name: 'Camila Souza', document: '529.982.247-25' });
  });

  it('shows the saved document read-only and never sends it again', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get('*/api/app/me', () => HttpResponse.json(me)),
      http.patch('*/api/app/me', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(me);
      }),
    );
    renderProfile();

    const field = await screen.findByLabelText('CPF ou CNPJ');
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveValue('529.982.247-25');

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Perfil atualizado.')).toBeInTheDocument();
    expect(body).not.toBeNull();
    expect(body).not.toHaveProperty('document');
  });

  it('shows the 409 DOCUMENT_TAKEN message under the document field', async () => {
    withoutDocument();
    server.use(
      http.patch('*/api/app/me', () => apiError(409, 'DOCUMENT_TAKEN', 'Documento já cadastrado.')),
    );
    renderProfile();

    await userEvent.type(await screen.findByLabelText('CPF ou CNPJ'), '52998224725');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const field = screen.getByLabelText('CPF ou CNPJ');
    expect(await screen.findByText('Este CPF/CNPJ já está cadastrado.')).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(/Este CPF\/CNPJ já está cadastrado\./);
  });

  it('flags an invalid document without calling the API', async () => {
    withoutDocument();
    renderProfile();

    await userEvent.type(await screen.findByLabelText('CPF ou CNPJ'), '11111111111');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText(DOCUMENT_MESSAGE)).toBeInTheDocument();
  });
});
