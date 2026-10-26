import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ID } from '../../test/fixtures/nucleo';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/render-with-providers';
import { spaced } from '../../test/text';
import { FixedSchedulePicker } from './FixedSchedulePicker';
import { occurrenceCheckFull, occurrenceCheckWithConflict, RID } from './fixtures';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function Probe() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

/** Serves the occurrence check and records the query string of every request. */
function stubCheck(body: JsonBodyType) {
  const queries: string[] = [];
  server.use(
    http.get('*/api/public/packages/:categoryId/occurrences', ({ request }) => {
      queries.push(new URL(request.url).search);
      return HttpResponse.json(body);
    }),
  );
  return queries;
}

function renderPicker(route: string, onContinue = vi.fn()) {
  renderWithProviders(
    <>
      <Routes>
        <Route
          path="/assinar/:categoryId"
          element={
            <FixedSchedulePicker
              categoryId={RID.meioTurno}
              pricePerOccurrenceCents={28000}
              onContinue={onContinue}
            />
          }
        />
      </Routes>
      <Probe />
    </>,
    route,
  );
  return onContinue;
}

const CHECKED = `/assinar/${RID.meioTurno}?roomId=${ID.principal}&baseOn=2026-11-02`;

// REC-84: conflicts with labels and suggestions; REC-91: period price line before payment.
describe('FixedSchedulePicker (REC-84, REC-91)', () => {
  it('lists each conflicting date with its label and disables "Continuar"', async () => {
    stubCheck(occurrenceCheckWithConflict);
    renderPicker(CHECKED);

    expect(await screen.findByText('Qua 04/11/2026: Já reservado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('offers the suggested room and start date as buttons', async () => {
    stubCheck(occurrenceCheckWithConflict);
    renderPicker(CHECKED);

    expect(await screen.findByRole('button', { name: 'Sala Secundária' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar em 09/11/2026' })).toBeInTheDocument();
  });

  it('clicking the room suggestion updates roomId in the URL and asks the API again', async () => {
    const queries = stubCheck(occurrenceCheckWithConflict);
    renderPicker(CHECKED);

    await userEvent.click(await screen.findByRole('button', { name: 'Sala Secundária' }));

    expect(screen.getByTestId('search')).toHaveTextContent(`roomId=${ID.secundaria}`);
    expect(screen.getByTestId('search')).toHaveTextContent('baseOn=2026-11-02');
    await vi.waitFor(() => {
      expect(queries).toContain(`?roomId=${ID.secundaria}&baseOn=2026-11-02`);
    });
  });

  it('clicking the date suggestion updates baseOn in the URL and asks the API again', async () => {
    const queries = stubCheck(occurrenceCheckWithConflict);
    renderPicker(CHECKED);

    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar em 09/11/2026' }));

    expect(screen.getByTestId('search')).toHaveTextContent('baseOn=2026-11-09');
    await vi.waitFor(() => {
      expect(queries).toContain(`?roomId=${ID.principal}&baseOn=2026-11-09`);
    });
  });

  it('shows the REC-91 line and enables "Continuar" when nothing conflicts', async () => {
    stubCheck(occurrenceCheckFull);
    const onContinue = renderPicker(CHECKED);

    expect(
      await screen.findByText(spaced('22 ocorrências × R$ 280,00 = R$ 6.160,00')),
    ).toBeInTheDocument();
    expect(screen.getByText('Período de 02/11/2026 a 01/12/2026')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Continuar' });
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('lists the occurrence dates with the time window inside "Ver as 22 datas"', async () => {
    stubCheck(occurrenceCheckFull);
    renderPicker(CHECKED);

    const summary = await screen.findByText('Ver as 22 datas');
    await userEvent.click(summary);

    const list = within(summary.closest('details') as HTMLElement).getAllByRole('listitem');
    expect(list).toHaveLength(22);
    expect(list[0]).toHaveTextContent('Seg 02/11/2026 · 07:00–09:30');
  });

  it('keeps the choices in the URL: picking a room and a start date asks for both', async () => {
    const queries = stubCheck(occurrenceCheckFull);
    renderPicker(`/assinar/${RID.meioTurno}`);
    expect(
      screen.getByText('Escolha a sala e a data de início para ver os seus horários.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    await userEvent.click(await screen.findByRole('radio', { name: 'Sala Principal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
    await userEvent.click(screen.getByRole('button', { name: '2 de novembro, disponível' }));

    expect(screen.getByTestId('search')).toHaveTextContent(
      `roomId=${ID.principal}&baseOn=2026-11-02`,
    );
    await vi.waitFor(() => {
      expect(queries).toEqual([`?roomId=${ID.principal}&baseOn=2026-11-02`]);
    });
  });

  it('shows the API message when the start date is out of range', async () => {
    server.use(
      http.get('*/api/public/packages/:categoryId/occurrences', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Escolha uma data base entre 26/10/2026 e 24/01/2027',
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderPicker(CHECKED);

    expect(
      await screen.findByText('Escolha uma data base entre 26/10/2026 e 24/01/2027'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });
});
