import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Feedback';
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
import { SummaryStep } from './SummaryStep';
import { TimeStep } from './TimeStep';

/**
 * Booking flow for `/reservar` and `/app/reservar` (NUC-98): Sala e data, Horário, Resumo, then
 * the payment page. The selection lives in the URL, so it survives login, refresh and Back.
 */
export function BookingFlowPage() {
  usePageTitle('Reservar');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const notice = (location.state as { notice?: string } | null)?.notice;

  const selection = parseSelection(params);
  const step = resolveStep(params);

  const go = useCallback(
    (next: FlowSelection, nextStep: FlowStep, replace: boolean, message?: string) => {
      void navigate(
        { pathname, search: `?${buildSearch(next, nextStep)}` },
        { replace, ...(message ? { state: { notice: message } } : {}) },
      );
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

      {notice ? <Alert tone="error">{notice}</Alert> : null}

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
        <SummaryStep
          selection={selection}
          onBack={() => {
            go(selection, 'horario', false);
          }}
          onChooseAnotherTime={(message) => {
            go(selection, 'horario', true, message);
          }}
        />
      ) : null}
    </div>
  );
}
