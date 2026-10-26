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
