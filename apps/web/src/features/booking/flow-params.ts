// The booking flow keeps its state in the URL (NUC-98): `sala`, `data`, `inicio`, `fim` or
// `bloco`, plus `etapa` for the step. Refreshing, going back and logging in all keep the selection.

export type FlowStep = 'data' | 'horario' | 'resumo';

export const FLOW_STEP_LABELS = ['Sala e data', 'Horário', 'Resumo', 'Pagamento'] as const;
export const FLOW_STEP_INDEX: Record<FlowStep, number> = { data: 0, horario: 1, resumo: 2 };

export interface FlowSelection {
  /** Room slug. */
  sala: string | null;
  /** `YYYY-MM-DD`. */
  data: string | null;
  inicio: number | null;
  fim: number | null;
  /** Id of a closed-block category. */
  bloco: string | null;
}

export const EMPTY_SELECTION: FlowSelection = {
  sala: null,
  data: null,
  inicio: null,
  fim: null,
  bloco: null,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function minuteParam(value: string | null): number | null {
  if (value === null || !/^\d{1,4}$/.test(value)) return null;
  const minute = Number(value);
  return minute <= 1440 ? minute : null;
}

export function parseSelection(params: URLSearchParams): FlowSelection {
  const data = params.get('data');
  return {
    sala: params.get('sala') || null,
    data: data !== null && DATE_RE.test(data) ? data : null,
    inicio: minuteParam(params.get('inicio')),
    fim: minuteParam(params.get('fim')),
    bloco: params.get('bloco') || null,
  };
}

/** A start and end, or a closed block: enough to ask for a price. */
export function isComplete(selection: FlowSelection): boolean {
  if (!selection.sala || !selection.data) return false;
  if (selection.bloco) return true;
  return selection.inicio !== null && selection.fim !== null && selection.fim > selection.inicio;
}

/** The step to show: `etapa` when the selection supports it, else the furthest one it does. */
export function resolveStep(params: URLSearchParams): FlowStep {
  const selection = parseSelection(params);
  const wanted = params.get('etapa');
  const hasDay = selection.sala !== null && selection.data !== null;
  if (wanted === 'resumo' && isComplete(selection)) return 'resumo';
  if (wanted === 'data' || !hasDay) return 'data';
  return 'horario';
}

/** Query string (without `?`) for the selection and step; empty values are left out. */
export function buildSearch(selection: FlowSelection, step?: FlowStep): string {
  const search = new URLSearchParams();
  if (selection.sala) search.set('sala', selection.sala);
  if (selection.data) search.set('data', selection.data);
  if (selection.bloco) search.set('bloco', selection.bloco);
  else {
    if (selection.inicio !== null) search.set('inicio', String(selection.inicio));
    if (selection.fim !== null) search.set('fim', String(selection.fim));
  }
  if (step) search.set('etapa', step);
  return search.toString();
}
