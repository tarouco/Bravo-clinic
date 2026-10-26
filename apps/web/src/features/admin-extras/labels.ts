import { formatBRL, QUOTE_STATUSES, type QuoteStatus } from '@bravo/core';

export { QUOTE_STATUSES };

/** Funnel columns of the quote requests, in funnel order (design: Novo ... Perdido). */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  new: 'Novo',
  contacted: 'Em contato',
  quote_sent: 'Orçamento enviado',
  won: 'Fechado',
  lost: 'Perdido',
};

/**
 * Statuses a request may move to (GES-95): `new → contacted → quote_sent → won | lost`, and any
 * request that is not closed can be marked lost. `won` and `lost` are final.
 */
export const QUOTE_NEXT_STATUSES: Record<QuoteStatus, readonly QuoteStatus[]> = {
  new: ['contacted', 'lost'],
  contacted: ['quote_sent', 'lost'],
  quote_sent: ['won', 'lost'],
  won: [],
  lost: [],
};

export const UNIT_LABELS = { hour: 'Hora', project: 'Projeto' } as const;
export const SALE_MODE_LABELS = { quote: 'Sob orçamento', online: 'Venda online' } as const;
export const SERVICE_STATUS_LABELS = { active: 'Ativo', inactive: 'Inativo' } as const;

/** 8000 + hour -> "R$ 80,00/h", 150000 + project -> "R$ 1.500,00/projeto", null -> "Sob consulta". */
export function formatServicePrice(cents: number | null, unit: 'hour' | 'project'): string {
  if (cents === null) return 'Sob consulta';
  return `${formatBRL(cents)}${unit === 'hour' ? '/h' : '/projeto'}`;
}
