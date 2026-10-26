import type { StaffEventKey } from '@bravo/core';
import type { OutboxStatus } from './contracts';

/** Gateway environments as the admin reads them (GES-36). */
export const ENVIRONMENT_LABELS = { test: 'Teste', production: 'Produção' } as const;

/** The 7 staff notices an admin can switch on or off (GES-66), in catalog order. */
export const STAFF_EVENT_LABELS: Record<StaffEventKey, string> = {
  new_booking: 'Nova reserva',
  payment_received: 'Pagamento recebido',
  booking_cancelled: 'Reserva cancelada',
  new_subscription: 'Nova assinatura',
  renewal_failed: 'Falha na renovação de assinatura',
  pre_reservation_expired: 'Pré-reserva expirada',
  new_quote_request: 'Novo pedido de orçamento',
};

export const OUTBOX_STATUS_LABELS: Record<OutboxStatus, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  failed: 'Falhou',
  not_sent: 'Não enviado',
};

/** What a tool needs from the token: `write` tools need Leitura e escrita (GES-63). */
export const MCP_TOOL_SCOPE_LABELS = { read: 'Leitura', write: 'Leitura e escrita' } as const;

export const MCP_TOKEN_SCOPE_LABELS = { read: 'Leitura', read_write: 'Leitura e escrita' } as const;

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 536870912 -> "512 MB", 1536 -> "1,5 KB" (binary units, pt-BR decimals). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value.toLocaleString('pt-BR', { maximumFractionDigits: unit === 0 ? 0 : 1 });
  return `${text} ${BYTE_UNITS[unit] ?? 'B'}`;
}
