import {
  POLICY_SNAPSHOT_KEYS,
  type PolicySection,
  type PolicySnapshot,
  type SettingsValues,
} from '../contracts/common';

/**
 * The payment and policy values frozen in `bookings.policy_snapshot` (NUC-31): every
 * `payment.*`, `policy.*` (with `policy.version`) and `credits.validity_days` value.
 */
export function policySnapshot(values: SettingsValues): PolicySnapshot {
  const out: Record<string, unknown> = {};
  for (const key of POLICY_SNAPSHOT_KEYS) out[key] = structuredClone(values[key]);
  return out as PolicySnapshot;
}

function hours(n: number): string {
  return n === 1 ? '1 hora' : `${String(n)} horas`;
}

function days(n: number): string {
  return n === 1 ? '1 dia' : `${String(n)} dias`;
}

const CLINIC_OPTION_TEXT = {
  refund: 'o reembolso integral',
  minutes: 'a devolução dos minutos ao pacote',
  credit: 'um crédito do valor pago',
} as const;

function listOr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ou ${items.at(-1) ?? ''}`;
}

/**
 * pt-BR policy text rendered from a snapshot, identical on checkout, the Políticas page and
 * e-mails: sections "Sinal e saldo", "Reagendamento", "Cancelamento" and "No-show".
 */
export function renderPolicyText(snapshot: PolicySnapshot): PolicySection[] {
  const deposit = snapshot['payment.deposit_percent'];
  const refundable = snapshot['payment.deposit_refundable'];
  const charge = snapshot['payment.balance_charge_hours_before'];
  const deadline = snapshot['payment.balance_deadline_hours_before'];
  const upfront = snapshot['payment.full_upfront_threshold_hours'];
  const freeCount = snapshot['policy.reschedule_free_count'];
  const rescheduleHours = snapshot['policy.reschedule_min_hours_before'];
  const windowDays = snapshot['policy.reschedule_window_days'];
  const cancelHours = snapshot['policy.cancel_refund_min_hours_before'];
  const packageHours = snapshot['policy.package_cancel_return_min_hours_before'];
  const noShow = snapshot['policy.no_show_after_minutes'];
  const creditDays = snapshot['credits.validity_days'];
  const clinicOptions = snapshot['policy.clinic_cancel_options'].map((o) => CLINIC_OPTION_TEXT[o]);

  const rescheduleRule =
    freeCount === 0
      ? 'O reagendamento pelo site e pelo app não está disponível; fale com a recepção.'
      : `Você tem ${String(freeCount)} ${freeCount === 1 ? 'reagendamento cortesia' : 'reagendamentos cortesia'} por reserva, feito com pelo menos ${hours(rescheduleHours)} de antecedência, para qualquer horário disponível em até ${days(windowDays)}.`;

  return [
    {
      title: 'Sinal e saldo',
      paragraphs: [
        `Para confirmar a reserva avulsa, você paga um sinal de ${String(deposit)}% do valor. ${
          refundable
            ? 'O sinal é reembolsável em caso de desistência dentro do prazo de cancelamento.'
            : 'O sinal não é reembolsável em caso de desistência.'
        }`,
        `O saldo é cobrado ${hours(charge)} antes do início, no cartão salvo ou por Pix, e precisa ser pago até ${hours(deadline)} antes do início. Sem o pagamento, a reserva é cancelada e o sinal fica retido.`,
        `Reservas feitas com menos de ${hours(upfront)} de antecedência são pagas integralmente no ato.`,
      ],
    },
    {
      title: 'Reagendamento',
      paragraphs: [
        rescheduleRule,
        `Se o novo horário for mais caro, você paga a diferença no ato. Se for mais barato, a diferença vira crédito, válido por ${days(creditDays)}.`,
        'Fora dessas condições, só a recepção pode reagendar.',
      ],
    },
    {
      title: 'Cancelamento',
      paragraphs: [
        refundable
          ? `Cancelando com pelo menos ${hours(cancelHours)} de antecedência, você recebe de volta todo o valor pago.`
          : `Cancelando com pelo menos ${hours(cancelHours)} de antecedência, você perde só o sinal e recebe de volta o que pagou além dele.`,
        `Com menos de ${hours(cancelHours)} de antecedência, não há reembolso.`,
        `Reservas pagas com pacote de horas devolvem os minutos ao saldo quando canceladas com pelo menos ${hours(packageHours)} de antecedência, dentro do período vigente.`,
        `Se a clínica cancelar a reserva, você escolhe entre ${listOr(clinicOptions)}.`,
      ],
    },
    {
      title: 'No-show',
      paragraphs: [
        `Sem check-in até ${String(noShow)} minutos após o início, a reserva é marcada como no-show, sem reembolso; minutos de pacote são consumidos.`,
      ],
    },
  ];
}
