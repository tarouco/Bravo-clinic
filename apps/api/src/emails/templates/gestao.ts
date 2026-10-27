import { formatBRL, formatDateBR, formatTimeBR, type LocalDate } from '@bravo/core';
import type { Env } from '../../env';
import { renderLayout, type Rendered } from './layout';

// The pt-BR e-mails owned by gestao (GES-73, design.md "Notification catalog"). Template names are
// the catalog's event names. Every link is absolute on APP_BASE_URL; callers pass site paths.

export const GESTAO_TEMPLATES = [
  'staff.new_booking',
  'staff.payment_received',
  'staff.booking_cancelled',
  'staff.new_subscription',
  'staff.renewal_failed',
  'staff.pre_reservation_expired',
  'staff.new_quote_request',
  'staff.payment_issue',
  'staff.holiday_review',
  'staff.invite',
  'quote.received',
  'privacy.account_deleted',
  'subscription.card_reregister',
  'system.test',
] as const;
export type GestaoTemplate = (typeof GESTAO_TEMPLATES)[number];

type BaseEnv = Pick<Env, 'APP_BASE_URL'>;

const STAFF_FOOTNOTE =
  'Você recebe este aviso porque está na lista de notificações da Bravô Clinic. O administrador pode alterar a lista em Integrações > E-mails.';
const TENANT_FOOTNOTE = 'Dúvidas? Responda este e-mail ou fale com a recepção da Bravô Clinic.';

const link = (env: BaseEnv, path: string) => new URL(path, env.APP_BASE_URL).toString();

function render(
  env: BaseEnv,
  subject: string,
  heading: string,
  paragraphs: string[],
  cta: { label: string; path: string },
  footnote: string,
): Rendered {
  const { html, text } = renderLayout({
    heading,
    paragraphs,
    cta: { label: cta.label, href: link(env, cta.path) },
    footnote,
  });
  return { subject, html, text };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const when = (startsAt: Date) => `${formatDateBR(startsAt)} às ${formatTimeBR(startsAt)}`;

/** "02/12/2026" of a local date. */
const localDate = (date: LocalDate) => {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
};

const BOOKINGS = '/admin/reservas/lista';

// --- staff events -------------------------------------------------------------------------------

export interface StaffBookingData {
  customerName: string;
  roomName: string;
  startsAt: Date;
  code: string;
}

export function staffNewBookingTemplate(d: StaffBookingData, env: BaseEnv): Rendered {
  return render(
    env,
    `Nova reserva ${d.code}: ${d.roomName}, ${when(d.startsAt)}`,
    'Nova reserva',
    [
      `${firstName(d.customerName)} reservou a ${d.roomName} para ${when(d.startsAt)}.`,
      `Código da reserva: ${d.code}.`,
    ],
    { label: 'Ver reservas', path: BOOKINGS },
    STAFF_FOOTNOTE,
  );
}

export function staffBookingCancelledTemplate(
  d: StaffBookingData & { reason?: string },
  env: BaseEnv,
): Rendered {
  return render(
    env,
    `Reserva cancelada ${d.code}: ${d.roomName}, ${when(d.startsAt)}`,
    'Reserva cancelada',
    [
      `A reserva ${d.code} de ${firstName(d.customerName)} na ${d.roomName} para ${when(d.startsAt)} foi cancelada.`,
      ...(d.reason === undefined ? [] : [`Motivo: ${d.reason}.`]),
    ],
    { label: 'Ver reservas', path: BOOKINGS },
    STAFF_FOOTNOTE,
  );
}

export function staffPreReservationExpiredTemplate(d: StaffBookingData, env: BaseEnv): Rendered {
  return render(
    env,
    `Pré-reserva expirada ${d.code}: ${d.roomName}, ${when(d.startsAt)}`,
    'Pré-reserva expirada',
    [
      `A pré-reserva ${d.code} de ${firstName(d.customerName)} na ${d.roomName} para ${when(d.startsAt)} expirou sem pagamento.`,
      'O horário voltou a ficar disponível.',
    ],
    { label: 'Ver reservas', path: BOOKINGS },
    STAFF_FOOTNOTE,
  );
}

export interface StaffPaymentData {
  customerName: string;
  amountCents: number;
  /** What was paid, e.g. "Reserva BRV-ABC123" or "Pacote 20h mensal". */
  description: string;
}

export function staffPaymentReceivedTemplate(d: StaffPaymentData, env: BaseEnv): Rendered {
  return render(
    env,
    `Pagamento recebido: ${formatBRL(d.amountCents)}`,
    'Pagamento recebido',
    [`${firstName(d.customerName)} pagou ${formatBRL(d.amountCents)} (${d.description}).`],
    { label: 'Ver financeiro', path: '/admin/financeiro' },
    STAFF_FOOTNOTE,
  );
}

export interface StaffSubscriptionData {
  customerName: string;
  categoryName: string;
}

export function staffNewSubscriptionTemplate(
  d: StaffSubscriptionData & { startsOn?: LocalDate },
  env: BaseEnv,
): Rendered {
  const start = d.startsOn === undefined ? '' : `, com início em ${localDate(d.startsOn)}`;
  return render(
    env,
    `Nova assinatura: ${d.categoryName}`,
    'Nova assinatura',
    [`${firstName(d.customerName)} assinou ${d.categoryName}${start}.`],
    { label: 'Ver clientes', path: '/admin/clientes' },
    STAFF_FOOTNOTE,
  );
}

export function staffRenewalFailedTemplate(
  d: StaffSubscriptionData & { amountCents: number },
  env: BaseEnv,
): Rendered {
  return render(
    env,
    `Falha na renovação: ${d.categoryName}`,
    'Falha na renovação',
    [
      `A renovação de ${d.categoryName} de ${firstName(d.customerName)} (${formatBRL(d.amountCents)}) não foi paga.`,
      'A assinatura pode ser suspensa se o pagamento não for feito no prazo.',
    ],
    { label: 'Ver clientes', path: '/admin/clientes' },
    STAFF_FOOTNOTE,
  );
}

export interface StaffQuoteData {
  requesterName: string;
  serviceName: string;
  phone: string;
  desiredOn?: LocalDate | null;
}

export function staffNewQuoteRequestTemplate(d: StaffQuoteData, env: BaseEnv): Rendered {
  return render(
    env,
    `Novo pedido de orçamento: ${d.serviceName}`,
    'Novo pedido de orçamento',
    [
      `${d.requesterName} pediu um orçamento de ${d.serviceName}.`,
      `Telefone: ${d.phone}.`,
      ...(d.desiredOn ? [`Data desejada: ${localDate(d.desiredOn)}.`] : []),
    ],
    { label: 'Ver pedidos', path: '/admin/servicos-extras' },
    STAFF_FOOTNOTE,
  );
}

const PAYMENT_ISSUE_REASONS: Record<string, string> = {
  amount_mismatch: 'o valor aprovado pelo provedor é diferente do valor cobrado',
  unhandled_purpose: 'um pagamento aprovado não pôde ser aplicado automaticamente',
  charged_back: 'o cliente contestou um pagamento (chargeback)',
  refund_failed: 'um estorno falhou após todas as tentativas',
};

export function staffPaymentIssueTemplate(
  d: { reason: string; reference: string },
  env: BaseEnv,
): Rendered {
  const reason = PAYMENT_ISSUE_REASONS[d.reason] ?? 'um pagamento precisa de verificação manual';
  return render(
    env,
    'Problema em um pagamento',
    'Problema em um pagamento',
    [`Atenção: ${reason}.`, `Referência: ${d.reference}.`, 'Confira o pagamento no provedor.'],
    { label: 'Ver financeiro', path: '/admin/financeiro' },
    STAFF_FOOTNOTE,
  );
}

export function staffHolidayReviewTemplate(
  d: { holidays: { date: LocalDate; name: string }[] },
  env: BaseEnv,
): Rendered {
  return render(
    env,
    'Revise os feriados do calendário',
    'Feriados para revisar',
    [
      'Estes feriados precisam de revisão (abrir ou fechar a clínica):',
      ...d.holidays.map((h) => `${localDate(h.date)}: ${h.name}`),
    ],
    { label: 'Revisar calendário', path: '/admin/calendario' },
    STAFF_FOOTNOTE,
  );
}

export function staffInviteTemplate(
  d: { name: string; roleLabel: string; token: string },
  env: BaseEnv,
): Rendered {
  return render(
    env,
    'Convite para a equipe da Bravô Clinic',
    'Você foi convidado',
    [
      `Olá, ${firstName(d.name)}! Você foi cadastrado na Bravô Clinic como ${d.roleLabel}.`,
      'Defina sua senha pelo link abaixo. Ele vale por 72 horas.',
    ],
    { label: 'Definir senha', path: `/redefinir-senha?token=${encodeURIComponent(d.token)}` },
    'Se você não esperava este convite, ignore esta mensagem.',
  );
}

// --- tenant and requester -----------------------------------------------------------------------

export function quoteReceivedTemplate(
  d: { name: string; serviceName: string },
  env: BaseEnv,
): Rendered {
  return render(
    env,
    `Recebemos seu pedido de orçamento: ${d.serviceName}`,
    'Pedido de orçamento recebido',
    [
      `Olá, ${firstName(d.name)}! Recebemos seu pedido de orçamento de ${d.serviceName}.`,
      'Nossa equipe entra em contato em breve pelo telefone ou e-mail informado.',
    ],
    { label: 'Ver serviços extras', path: '/servicos-extras' },
    TENANT_FOOTNOTE,
  );
}

export function accountDeletedTemplate(d: { name: string }, env: BaseEnv): Rendered {
  return render(
    env,
    'Sua conta na Bravô Clinic foi excluída',
    'Conta excluída',
    [
      `Olá, ${firstName(d.name)}! Sua conta foi excluída e seus dados pessoais foram removidos.`,
      'Registros de reservas e pagamentos são mantidos sem identificação pessoal, como exige a legislação fiscal.',
    ],
    { label: 'Ir para o site', path: '/' },
    'Se você não pediu a exclusão, responda este e-mail.',
  );
}

export function cardReregisterTemplate(
  d: { name: string; categoryName: string },
  env: BaseEnv,
): Rendered {
  return render(
    env,
    'Cadastre seu cartão novamente',
    'Atualize seu cartão',
    [
      `Olá, ${firstName(d.name)}! Trocamos o provedor de pagamentos da Bravô Clinic.`,
      `Para manter a renovação automática de ${d.categoryName}, cadastre seu cartão novamente.`,
    ],
    { label: 'Cadastrar cartão', path: '/app/perfil/cartoes' },
    TENANT_FOOTNOTE,
  );
}

export function systemTestTemplate(_d: Record<string, never>, env: BaseEnv): Rendered {
  return render(
    env,
    'Teste de e-mail da Bravô Clinic',
    'Teste de e-mail',
    [
      'Este é um e-mail de teste enviado pela área administrativa.',
      'Se você o recebeu, o envio está funcionando.',
    ],
    { label: 'Abrir área administrativa', path: '/admin/integracoes' },
    STAFF_FOOTNOTE,
  );
}

// --- staff fan-out renderer ---------------------------------------------------------------------

const text = (d: Record<string, unknown>, key: string, fallback = '') => {
  const value = d[key];
  return typeof value === 'string' ? value : fallback;
};
const cents = (d: Record<string, unknown>, key: string) => {
  const value = d[key];
  return typeof value === 'number' ? value : 0;
};
const instant = (d: Record<string, unknown>, key: string) => {
  const value = d[key];
  return value instanceof Date ? value : new Date(typeof value === 'string' ? value : 0);
};

const bookingData = (d: Record<string, unknown>): StaffBookingData => ({
  customerName: text(d, 'customerName', 'Cliente'),
  roomName: text(d, 'roomName', 'sala'),
  startsAt: instant(d, 'startsAt'),
  code: text(d, 'code', text(d, 'entityId')),
});

export type StaffTemplate = Extract<GestaoTemplate, `staff.${string}`>;

/**
 * Renders a staff template from the loosely typed event data `emit()` receives (callers such as
 * nucleo's `notifyStaff` pass whatever they know; missing values fall back to neutral text).
 */
export function renderStaffEmail(
  template: StaffTemplate,
  data: Record<string, unknown>,
  env: BaseEnv,
): Rendered {
  switch (template) {
    case 'staff.new_booking':
      return staffNewBookingTemplate(bookingData(data), env);
    case 'staff.booking_cancelled':
      return staffBookingCancelledTemplate(bookingData(data), env);
    case 'staff.pre_reservation_expired':
      return staffPreReservationExpiredTemplate(bookingData(data), env);
    case 'staff.payment_received':
      return staffPaymentReceivedTemplate(
        {
          customerName: text(data, 'customerName', 'Cliente'),
          amountCents: cents(data, 'amountCents'),
          description: text(data, 'description', text(data, 'purpose', 'pagamento')),
        },
        env,
      );
    case 'staff.new_subscription':
      return staffNewSubscriptionTemplate(
        {
          customerName: text(data, 'customerName', 'Cliente'),
          categoryName: text(data, 'categoryName', 'assinatura'),
          ...(text(data, 'startsOn') !== '' && { startsOn: text(data, 'startsOn') as LocalDate }),
        },
        env,
      );
    case 'staff.renewal_failed':
      return staffRenewalFailedTemplate(
        {
          customerName: text(data, 'customerName', 'Cliente'),
          categoryName: text(data, 'categoryName', 'assinatura'),
          amountCents: cents(data, 'amountCents'),
        },
        env,
      );
    case 'staff.new_quote_request':
      return staffNewQuoteRequestTemplate(
        {
          requesterName: text(data, 'requesterName', 'Um visitante'),
          serviceName: text(data, 'serviceName', 'serviço extra'),
          phone: text(data, 'phone', 'não informado'),
          desiredOn: (text(data, 'desiredOn') || null) as LocalDate | null,
        },
        env,
      );
    case 'staff.payment_issue':
      return staffPaymentIssueTemplate(
        { reason: text(data, 'reason'), reference: text(data, 'entityId') },
        env,
      );
    case 'staff.holiday_review':
      return staffHolidayReviewTemplate(
        { holidays: (data['holidays'] as { date: LocalDate; name: string }[] | undefined) ?? [] },
        env,
      );
    case 'staff.invite':
      return staffInviteTemplate(
        {
          name: text(data, 'name'),
          roleLabel: text(data, 'roleLabel', 'membro da equipe'),
          token: text(data, 'token'),
        },
        env,
      );
  }
}
