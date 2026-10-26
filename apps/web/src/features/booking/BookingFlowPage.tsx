import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Stepper } from '../../components/ui/Stepper';
import { usePageTitle } from '../../lib/usePageTitle';
import { DateStep } from './DateStep';
import {
  buildSearch,
  FLOW_STEP_INDEX,
  FLOW_STEP_LABELS,
  parseSelection,
  resolveStep,
  type FlowSelection,
  type FlowStep,
} from './flow-params';
import { TimeStep } from './TimeStep';

/**
 * Booking flow for `/reservar` and `/app/reservar` (NUC-98): Sala e data, Horário, Resumo, then
 * the payment page. The selection lives in the URL, so it survives login, refresh and Back.
 */
export function BookingFlowPage() {
  usePageTitle('Reservar');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const selection = parseSelection(params);
  const step = resolveStep(params);

  const go = useCallback(
    (next: FlowSelection, nextStep: FlowStep, replace: boolean) => {
      void navigate({ pathname, search: `?${buildSearch(next, nextStep)}` }, { replace });
    },
    [navigate, pathname],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-space-xl px-gutter py-space-xl md:py-space-3xl">
      <header className="space-y-space-md">
        <h1 className="font-display-l-mobile text-display-l-mobile text-ink md:font-display-l md:text-display-l">
          Reservar sala
        </h1>
        <Stepper
          label="Etapas da reserva"
          steps={FLOW_STEP_LABELS}
          current={FLOW_STEP_INDEX[step]}
        />
      </header>

      {step === 'data' ? (
        <DateStep
          selection={selection}
          onChange={(next) => {
            go(next, 'data', true);
          }}
          onContinue={() => {
            go(selection, 'horario', false);
          }}
        />
      ) : null}
      {step === 'horario' ? (
        <TimeStep
          selection={selection}
          onChange={(next) => {
            go(next, 'horario', true);
          }}
          onBack={() => {
            go(selection, 'data', false);
          }}
          onContinue={() => {
            go(selection, 'resumo', false);
          }}
        />
      ) : null}
      {step === 'resumo' ? (
        <p className="font-body text-body text-ink-muted">Resumo da reserva em construção.</p>
      ) : null}
    </div>
  );
}
