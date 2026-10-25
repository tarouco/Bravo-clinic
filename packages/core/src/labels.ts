import type { BookingStatus, PaymentMode, PaymentStatusCode } from './status/booking';
import type {
  CouponUseStatus,
  CreditSource,
  ExtraLotSource,
  PackageLedgerEntryType,
  PeriodStatus,
  SubscriptionStatus,
} from './status/subscription';

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

export const subscriptionStatusLabel: Record<SubscriptionStatus, string> = {
  awaiting_payment: 'Aguardando pgto',
  active: 'Ativa',
  suspended: 'Suspensa',
  ended: 'Encerrada',
  cancelled: 'Cancelada',
  switched: 'Trocada',
  expired: 'Expirada',
};

export const periodStatusLabel: Record<PeriodStatus, string> = {
  upcoming: 'Próximo',
  awaiting_payment: 'Aguardando pgto',
  paid: 'Pago',
  active: 'Vigente',
  closed: 'Encerrado',
  failed: 'Não pago',
  cancelled: 'Cancelado',
};

const LEDGER_ENTRY_LABELS: Record<Exclude<PackageLedgerEntryType, 'period_grant'>, string> = {
  debit: 'Reserva',
  refund: 'Estorno',
  expiry: 'Expiração',
  conversion_in: 'Saldo convertido',
  conversion_out: 'Saldo transferido',
  manual_adjustment: 'Ajuste manual',
};

/**
 * Extrato label of a minute ledger entry (REC-42): `period_grant` of seq 1 is "Compra", of a later
 * seq "Renovação". Extra-minute entries share the other labels; their `grant` entries are labelled
 * by lot source (`extraLotSourceLabel`).
 */
export function ledgerEntryLabel(entryType: PackageLedgerEntryType, seq = 1): string {
  if (entryType === 'period_grant') return seq > 1 ? 'Renovação' : 'Compra';
  return LEDGER_ENTRY_LABELS[entryType];
}

export const extraLotSourceLabel: Record<ExtraLotSource, string> = {
  purchase: 'Horas extras compradas',
  closed_day_compensation: 'Compensação de dia fechado',
  manual: 'Ajuste',
};

export const creditSourceLabel: Record<CreditSource, string> = {
  reschedule_difference: 'Diferença de reagendamento',
  closed_day_compensation: 'Compensação de dia fechado',
  manual: 'Crédito manual',
  clinic_cancellation: 'Cancelamento pela clínica',
};

export const couponUseStatusLabel: Record<CouponUseStatus, string> = {
  reserved: 'Reservado',
  consumed: 'Usado',
  released: 'Liberado',
};
