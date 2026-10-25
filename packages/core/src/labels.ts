import type { BookingStatus, PaymentMode, PaymentStatusCode } from './status/booking';

/** pt-BR labels of every stored status code (PRD 7.5). */
export const bookingStatusLabel: Record<BookingStatus, string> = {
  awaiting_payment: 'Aguardando pgto',
  pre_reserved: 'Pré-reserva',
  held_for_renewal: 'Pré-reservada (renovação)',
  confirmed: 'Confirmada',
  paid: 'Quitada',
  completed: 'Concluída',
  no_show: 'No-show',
  expired: 'Expirada',
  cancelled_by_tenant: 'Cancelada pelo locatário',
  cancelled_nonpayment: 'Cancelada por falta de pagamento',
  cancelled_by_clinic: 'Cancelada pela clínica',
};

export const paymentStatusLabel: Record<PaymentStatusCode, string> = {
  awaiting: 'Aguardando pagamento',
  deposit_paid: 'Sinal pago · saldo pendente',
  manual_pending: 'Confirmada manualmente · pagamento pendente',
  paid: 'Quitada',
  package: 'Pago com pacote',
  refunded: 'Reembolsada',
  none: '—',
};

export const paymentModeLabel: Record<PaymentMode, string> = {
  deposit_balance: 'Sinal + saldo',
  full_upfront: 'Pagamento integral',
  package: 'Pacote de horas',
  subscription: 'Assinatura',
  manual: 'Confirmação manual',
};

export type ChargeStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded'
  | 'charged_back';

export const chargeStatusLabel: Record<ChargeStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
  expired: 'Expirado',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolsado parcialmente',
  charged_back: 'Estornado',
};

export type HolidayScopeCode = 'national' | 'state' | 'municipal' | 'optional';

export const holidayScopeLabel: Record<HolidayScopeCode, string> = {
  national: 'Nacional',
  state: 'Estadual',
  municipal: 'Municipal',
  optional: 'Ponto facultativo',
};
