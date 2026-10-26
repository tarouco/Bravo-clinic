import { maskPhone } from '../../components/ui/form/masked';

/** "+5547999990001" -> "(47) 99999-0001"; null -> "—". */
export function formatPhone(e164: string | null): string {
  if (!e164) return '—';
  const digits = e164.replace(/\D/g, '');
  return maskPhone(digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits);
}

const CONSENT_LABELS: Record<string, string> = {
  booking_policy: 'Política de reservas',
  recurring_charge: 'Cobrança recorrente no cartão',
  subscription_terms: 'Termos da assinatura',
};

/** `booking_policy` -> "Política de reservas"; an unknown kind is shown as stored. */
export function consentLabel(kind: string): string {
  return CONSENT_LABELS[kind] ?? kind;
}
