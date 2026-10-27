import { formatBRL, formatDateBR, formatTimeBR, type LocalDate } from '@bravo/core';
import { renderLayout, type Rendered } from './layout';

// The 17 pt-BR receita e-mails (REC-159, REC-161). Template names are the notification catalog's
// event names (packages/core/src/notifications/catalog.ts, AD-025). Every paragraph goes through
// the shared layout, which escapes it.

export const REVENUE_TEMPLATES = [
  'subscription.activated',
  'subscription.renewal_charge',
  'subscription.renewal_reminder',
  'subscription.renewal_approved',
  'subscription.renewal_failed',
  'subscription.suspended',
  'subscription.ended',
  'subscription.cancelled',
  'subscription.switched',
  'subscription.period_ending',
  'subscription.price_change',
  'subscription.next_period_conflicts',
  'subscription.sale_link',
  'extra_hours.purchased',
  'credit.granted',
  'subscription.compensation',
  'payment.late_refund',
] as const;
export type RevenueTemplate = (typeof REVENUE_TEMPLATES)[number];

const FOOTNOTE = 'Dúvidas? Responda este e-mail ou fale com a recepção da Bravô Clinic.';

/** "02/12/2026" of a local date. */
export function formatLocalDateBR(date: LocalDate): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

/** "20h", "6h 24min", "45min". */
export function formatHoursMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}min`;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}min`;
}

const METHOD_LABEL = { pix: 'Pix', saved_card: 'cartão salvo', card: 'cartão' } as const;
type Method = keyof typeof METHOD_LABEL;

function render(
  subject: string,
  heading: string,
  paragraphs: string[],
  cta: { label: string; href: string },
): Rendered {
  const { html, text } = renderLayout({ heading, paragraphs, cta, footnote: FOOTNOTE });
  return { subject, html, text };
}

interface Base {
  name: string;
  /** Absolute link of the button. */
  link: string;
}

interface SubscriptionBase extends Base {
  categoryName: string;
}

const occurrenceLine = (o: { startsAt: Date; endsAt: Date }) =>
  `${formatDateBR(o.startsAt)} das ${formatTimeBR(o.startsAt)} às ${formatTimeBR(o.endsAt)}`;

export interface ActivatedData extends SubscriptionBase {
  startsOn: LocalDate;
  endsOn: LocalDate;
  priceCents: number;
  includedMinutes?: number;
  roomName?: string;
  occurrences?: { startsAt: Date; endsAt: Date }[];
}

export function subscriptionActivatedTemplate(d: ActivatedData): Rendered {
  const period = `Período: ${formatLocalDateBR(d.startsOn)} a ${formatLocalDateBR(d.endsOn)} (exclusivo), ${formatBRL(d.priceCents)}.`;
  const paragraphs = [`Olá, ${d.name}! Sua assinatura ${d.categoryName} está ativa.`, period];
  if (d.includedMinutes !== undefined) {
    paragraphs.push(`Saldo do período: ${formatHoursMinutes(d.includedMinutes)}.`);
  }
  if (d.occurrences !== undefined && d.occurrences.length > 0) {
    paragraphs.push(
      `${String(d.occurrences.length)} ocorrências${d.roomName === undefined ? '' : ` na ${d.roomName}`}:`,
      ...d.occurrences.map(occurrenceLine),
      'O convite de calendário (.ics) com todas as ocorrências segue em anexo.',
    );
  }
  return render(`Assinatura ativa — ${d.categoryName}`, 'Assinatura ativa', paragraphs, {
    label: 'Ver minhas compras',
    href: d.link,
  });
}

export interface RenewalChargeData extends SubscriptionBase {
  amountCents: number;
  /** The base date of the new period: payment is due before it (REC-161). */
  dueOn: LocalDate;
  method: Method;
  cardLast4?: string;
  pixCopyPaste?: string | null;
  /** REC-52: the saved card is missing or from another gateway. */
  askCardUpdate?: boolean;
}

function renewalParagraphs(d: RenewalChargeData): string[] {
  const method =
    d.method === 'saved_card' && d.cardLast4 !== undefined
      ? `cartão final ${d.cardLast4}`
      : METHOD_LABEL[d.method];
  const lines = [
    `Valor: ${formatBRL(d.amountCents)}.`,
    `Vencimento: ${formatLocalDateBR(d.dueOn)}.`,
    `Forma de pagamento: ${method}.`,
  ];
  if (d.method === 'pix' && d.pixCopyPaste) lines.push(`Pix copia e cola: ${d.pixCopyPaste}`);
  if (d.askCardUpdate === true) {
    lines.push(
      'Seu cartão salvo não está disponível. Cadastre um cartão para as próximas renovações.',
    );
  }
  return lines;
}

export function renewalChargeTemplate(d: RenewalChargeData): Rendered {
  return render(
    `Renovação da assinatura — ${d.categoryName}`,
    'Renovação da assinatura',
    [
      `Olá, ${d.name}! A renovação da sua assinatura ${d.categoryName} foi gerada.`,
      ...renewalParagraphs(d),
    ],
    { label: 'Pagar renovação', href: d.link },
  );
}

export function renewalReminderTemplate(d: RenewalChargeData): Rendered {
  return render(
    `Lembrete: renovação pendente — ${d.categoryName}`,
    'Renovação pendente',
    [
      `Olá, ${d.name}! A renovação da sua assinatura ${d.categoryName} ainda não foi paga.`,
      ...renewalParagraphs(d),
    ],
    { label: 'Pagar renovação', href: d.link },
  );
}

export interface RenewalApprovedData extends SubscriptionBase {
  amountCents: number;
  startsOn: LocalDate;
  endsOn: LocalDate;
}

export function renewalApprovedTemplate(d: RenewalApprovedData): Rendered {
  return render(
    `Renovação confirmada — ${d.categoryName}`,
    'Renovação confirmada',
    [
      `Olá, ${d.name}! Recebemos ${formatBRL(d.amountCents)} da renovação da sua assinatura ${d.categoryName}.`,
      `Próximo período: ${formatLocalDateBR(d.startsOn)} a ${formatLocalDateBR(d.endsOn)}.`,
    ],
    { label: 'Ver minhas compras', href: d.link },
  );
}

export interface RenewalFailedData extends SubscriptionBase {
  amountCents: number;
  dueOn: LocalDate;
}

export function renewalFailedTemplate(d: RenewalFailedData): Rendered {
  return render(
    `Renovação recusada — ${d.categoryName}`,
    'Renovação recusada',
    [
      `Olá, ${d.name}! Não conseguimos cobrar ${formatBRL(d.amountCents)} da renovação da sua assinatura ${d.categoryName}.`,
      `Pague por Pix ou com outro cartão até ${formatLocalDateBR(d.dueOn)} para manter seus horários.`,
    ],
    { label: 'Pagar renovação', href: d.link },
  );
}

export interface SuspendedData extends SubscriptionBase {
  graceEndsOn: LocalDate;
}

export function suspendedTemplate(d: SuspendedData): Rendered {
  return render(
    `Assinatura suspensa — ${d.categoryName}`,
    'Assinatura suspensa',
    [
      `Olá, ${d.name}! A renovação da sua assinatura ${d.categoryName} não foi paga e ela está suspensa.`,
      `Regularize até ${formatLocalDateBR(d.graceEndsOn)} para reativá-la. Suas horas extras continuam válidas.`,
    ],
    { label: 'Regularizar', href: d.link },
  );
}

export function endedTemplate(d: SubscriptionBase): Rendered {
  return render(
    `Assinatura encerrada — ${d.categoryName}`,
    'Assinatura encerrada',
    [
      `Olá, ${d.name}! Sua assinatura ${d.categoryName} foi encerrada porque a renovação não foi paga no prazo.`,
      'Você pode assinar novamente quando quiser.',
    ],
    { label: 'Ver pacotes', href: d.link },
  );
}

export interface CancelledData extends SubscriptionBase {
  minutesLost?: number;
}

export function cancelledTemplate(d: CancelledData): Rendered {
  const paragraphs = [`Olá, ${d.name}! Sua assinatura ${d.categoryName} foi cancelada.`];
  if (d.minutesLost !== undefined && d.minutesLost > 0) {
    paragraphs.push(
      `O saldo de ${formatHoursMinutes(d.minutesLost)} deste período expirou, sem reembolso.`,
    );
  }
  paragraphs.push('Suas horas extras e créditos continuam válidos até o vencimento.');
  return render(`Assinatura cancelada — ${d.categoryName}`, 'Assinatura cancelada', paragraphs, {
    label: 'Ver minhas compras',
    href: d.link,
  });
}

export interface SwitchedData extends SubscriptionBase {
  fromCategoryName: string;
  startsOn: LocalDate;
  convertedMinutes?: number;
}

export function switchedTemplate(d: SwitchedData): Rendered {
  const paragraphs = [
    `Olá, ${d.name}! Sua assinatura mudou de ${d.fromCategoryName} para ${d.categoryName}.`,
    `Nova data base: ${formatLocalDateBR(d.startsOn)}.`,
  ];
  if (d.convertedMinutes !== undefined && d.convertedMinutes > 0) {
    paragraphs.push(
      `Seu saldo anterior virou ${formatHoursMinutes(d.convertedMinutes)} no novo pacote.`,
    );
  }
  return render(`Pacote alterado — ${d.categoryName}`, 'Pacote alterado', paragraphs, {
    label: 'Ver minhas compras',
    href: d.link,
  });
}

export interface PeriodEndingData extends SubscriptionBase {
  endsOn: LocalDate;
  daysLeft: number;
  remainingMinutes: number;
}

export function periodEndingTemplate(d: PeriodEndingData): Rendered {
  const when = d.daysLeft === 1 ? 'amanhã' : `em ${String(d.daysLeft)} dias`;
  return render(
    `Seu período termina ${when} — ${d.categoryName}`,
    'Seu período está terminando',
    [
      `Olá, ${d.name}! O período atual da sua assinatura ${d.categoryName} termina ${when}, em ${formatLocalDateBR(d.endsOn)}.`,
      `Saldo restante: ${formatHoursMinutes(d.remainingMinutes)}. O saldo não acumula para o próximo período.`,
    ],
    { label: 'Reservar agora', href: d.link },
  );
}

export interface PriceChangeData extends SubscriptionBase {
  newPriceCents: number;
  /** "por ocorrência" for fixed schedules. */
  unit?: string;
  firstRenewalOn: LocalDate;
}

export function priceChangeTemplate(d: PriceChangeData): Rendered {
  const unit = d.unit === undefined ? '' : ` ${d.unit}`;
  return render(
    `Novo valor da assinatura — ${d.categoryName}`,
    'Novo valor da assinatura',
    [
      `Olá, ${d.name}! O valor de ${d.categoryName} passa a ser ${formatBRL(d.newPriceCents)}${unit}.`,
      `O novo valor vale a partir da renovação de ${formatLocalDateBR(d.firstRenewalOn)}.`,
    ],
    { label: 'Ver minhas compras', href: d.link },
  );
}

export interface NextPeriodConflictsData extends SubscriptionBase {
  conflicts: { date: LocalDate; label: string }[];
}

export function nextPeriodConflictsTemplate(d: NextPeriodConflictsData): Rendered {
  return render(
    `Datas indisponíveis no próximo período — ${d.categoryName}`,
    'Datas indisponíveis no próximo período',
    [
      `Olá, ${d.name}! Não conseguimos pré-reservar estas datas do próximo período da sua assinatura ${d.categoryName}:`,
      ...d.conflicts.map((c) => `${formatLocalDateBR(c.date)}: ${c.label}`),
      'A renovação cobra só as ocorrências pré-reservadas.',
    ],
    { label: 'Ver minhas compras', href: d.link },
  );
}

export interface SaleLinkData extends SubscriptionBase {
  amountCents: number;
  holdExpiresAt: Date;
}

export function saleLinkTemplate(d: SaleLinkData): Rendered {
  return render(
    `Sua assinatura ${d.categoryName} está pronta para pagamento`,
    'Assinatura reservada para você',
    [
      `Olá, ${d.name}! A Bravô Clinic reservou a assinatura ${d.categoryName} para você.`,
      `Valor: ${formatBRL(d.amountCents)}. Pague até ${formatDateBR(d.holdExpiresAt)} às ${formatTimeBR(d.holdExpiresAt)}.`,
    ],
    { label: 'Pagar assinatura', href: d.link },
  );
}

export interface ExtraHoursData extends Base {
  hours: number;
  amountCents: number;
  expiresAt: Date;
}

export function extraHoursPurchasedTemplate(d: ExtraHoursData): Rendered {
  return render(
    'Horas extras confirmadas',
    'Horas extras confirmadas',
    [
      `Olá, ${d.name}! Recebemos ${formatBRL(d.amountCents)} de ${String(d.hours)} horas extras.`,
      `${formatHoursMinutes(d.hours * 60)} disponíveis até ${formatDateBR(d.expiresAt)}.`,
    ],
    { label: 'Reservar agora', href: d.link },
  );
}

export interface CreditGrantedData extends Base {
  amountCents: number;
  sourceLabel: string;
  expiresAt: Date;
}

export function creditGrantedTemplate(d: CreditGrantedData): Rendered {
  return render(
    `Você recebeu ${formatBRL(d.amountCents)} em créditos`,
    'Créditos disponíveis',
    [
      `Olá, ${d.name}! Você recebeu ${formatBRL(d.amountCents)} em créditos (${d.sourceLabel}).`,
      `Use em reservas, pacotes e horas extras até ${formatDateBR(d.expiresAt)}.`,
    ],
    { label: 'Ver meus créditos', href: d.link },
  );
}

export interface CompensationData extends SubscriptionBase {
  closedOn: LocalDate;
  minutes?: number;
  creditCents?: number;
}

export function compensationTemplate(d: CompensationData): Rendered {
  const paragraphs = [
    `Olá, ${d.name}! A clínica estará fechada em ${formatLocalDateBR(d.closedOn)}, dentro do período da sua assinatura ${d.categoryName}.`,
  ];
  if (d.minutes !== undefined && d.minutes > 0) {
    paragraphs.push(
      `Como compensação, você recebeu ${formatHoursMinutes(d.minutes)} em horas extras.`,
    );
  }
  if (d.creditCents !== undefined && d.creditCents > 0) {
    paragraphs.push(`Como compensação, você recebeu ${formatBRL(d.creditCents)} em créditos.`);
  }
  return render(
    `Compensação de dia fechado — ${formatLocalDateBR(d.closedOn)}`,
    'Compensação de dia fechado',
    paragraphs,
    { label: 'Ver minhas compras', href: d.link },
  );
}

export interface LateRefundData extends Base {
  amountCents: number;
  description: string;
}

export function lateRefundTemplate(d: LateRefundData): Rendered {
  return render(
    'Pagamento estornado',
    'Pagamento estornado',
    [
      `Olá, ${d.name}! O pagamento de ${formatBRL(d.amountCents)} (${d.description}) chegou depois do prazo e não pôde ser usado.`,
      'O valor foi estornado integralmente para a mesma forma de pagamento.',
    ],
    { label: 'Ver minhas compras', href: d.link },
  );
}
