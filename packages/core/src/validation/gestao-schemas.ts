import { z } from 'zod';
import { addDays, diffDays, type LocalDate } from '../time';
import { emailSchema, phoneSchema } from './auth-schemas';
import { idSchema, justificationSchema, localDateSchema } from '../contracts/common';
import { updateMeSchema } from '../contracts/app';
import { settingsCatalog } from '../settings/catalog';

// Gestao request schemas (gestao design "Core: gestao contracts", AD-024): one definition with
// pt-BR messages for the Admin forms and the API validator.

// ---- Shared vocabulary ----

export const REVENUE_CATEGORIES = [
  'rental_single',
  'subscription_initial',
  'subscription_renewal',
  'extra_hours',
  'extra_services',
  'other',
] as const;
export const revenueCategorySchema = z.enum(REVENUE_CATEGORIES, {
  error: 'Escolha a categoria de receita',
});

export const EXPENSE_RECURRENCES = ['none', 'monthly', 'quarterly', 'yearly'] as const;
export const expenseRecurrenceSchema = z.enum(EXPENSE_RECURRENCES, {
  error: 'Escolha a recorrência',
});
export type ExpenseRecurrence = z.infer<typeof expenseRecurrenceSchema>;

export const financeRegimeSchema = z.enum(['cash', 'accrual'], { error: 'Escolha o regime' });
export const financeGroupingSchema = z.enum(['week', 'month', 'quarter'], {
  error: 'Escolha o agrupamento',
});

export const QUOTE_STATUSES = ['new', 'contacted', 'quote_sent', 'won', 'lost'] as const;
export const quoteStatusSchema = z.enum(QUOTE_STATUSES, { error: 'Status inválido' });
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

export const staffRoleSchema = z.enum(['admin', 'reception'], { error: 'Escolha o perfil' });

/** Longest finance report range, both ends included (GES-25). */
export const MAX_REPORT_DAYS = 731;

const MAX_AMOUNT_CENTS = 100_000_000;

/** Integer cents 1..100000000 (GES-11, GES-20). */
const amountSchema = z
  .number({ error: 'Informe o valor' })
  .int({ error: 'Informe o valor em centavos' })
  .min(1, { error: 'Informe um valor maior que zero' })
  .max(MAX_AMOUNT_CENTS, { error: 'O valor máximo é R$ 1.000.000,00' });

function requiredText(label: string, min: number, max: number) {
  const tooShort =
    min <= 1 ? `Informe ${label}` : `Informe ${label} com pelo menos ${String(min)} caracteres`;
  return z
    .string({ error: `Informe ${label}` })
    .trim()
    .min(min, { error: tooShort })
    .max(max, { error: `Use no máximo ${String(max)} caracteres` });
}

function maxText(max: number) {
  return z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${String(max)} caracteres` });
}

/** A blank string counts as absent (optional form fields send ""). */
function optionalField<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );
}

function isLocalDate(value: unknown): value is LocalDate {
  return localDateSchema.safeParse(value).success;
}

function formatLocalDateBR(date: LocalDate): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

// ---- Finance (GES-11..GES-25) ----

export const expenseInputSchema = z.object({
  date: localDateSchema,
  categoryId: z.uuid({ error: 'Escolha a categoria' }),
  description: requiredText('a descrição', 1, 200),
  amountCents: amountSchema,
  recurrence: expenseRecurrenceSchema.default('none'),
});
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

/** Create body; the edit route applies `.partial()` (rename, reorder, deactivate; GES-19). */
export const expenseCategoryInputSchema = z.object({
  name: requiredText('o nome da categoria', 2, 60),
  displayOrder: z
    .number({ error: 'Ordem inválida' })
    .int({ error: 'Ordem inválida' })
    .min(0, {
      error: 'Ordem inválida',
    })
    .optional(),
  active: z.boolean().optional(),
});
export type ExpenseCategoryInput = z.infer<typeof expenseCategoryInputSchema>;

export const manualReceiptMethodSchema = z.enum(['cash', 'card_machine', 'pix_direct'], {
  error: 'Escolha a forma de recebimento',
});

export const manualReceiptInputSchema = z.object({
  date: localDateSchema,
  revenueCategory: revenueCategorySchema,
  method: manualReceiptMethodSchema,
  amountCents: amountSchema,
  description: optionalField(maxText(500)),
  userId: idSchema.optional(),
  bookingId: idSchema.optional(),
});
export type ManualReceiptInput = z.infer<typeof manualReceiptInputSchema>;

/** Deletions that must be justified, 5..500 chars (GES-21, GES-114, GES-127). */
export const deleteWithJustificationSchema = z.object({ justification: justificationSchema });

/** `GET /admin/finance/summary` and `/dre.xlsx` query (GES-22, GES-25, GES-29). */
export const financeQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    grouping: financeGroupingSchema.default('month'),
    regime: financeRegimeSchema.default('cash'),
  })
  .superRefine((q, ctx) => {
    if (!isLocalDate(q.from) || !isLocalDate(q.to)) return;
    const days = diffDays(q.from, q.to) + 1;
    if (days < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'A data final precisa ser igual ou posterior à data inicial',
        path: ['to'],
      });
    } else if (days > MAX_REPORT_DAYS) {
      ctx.addIssue({
        code: 'custom',
        message: `O período pode ter no máximo ${String(MAX_REPORT_DAYS)} dias`,
        path: ['to'],
      });
    }
  });
export type FinanceQuery = z.infer<typeof financeQuerySchema>;

// ---- Integrações (GES-36, GES-53, GES-65, GES-66) ----

/** `PUT /admin/integrations/gateway/:provider`; an empty secret keeps the stored one (GES-36). */
export const gatewayCredentialsSchema = z.object({
  enabled: z.boolean({ error: 'Informe se o provedor está habilitado' }),
  environment: z.enum(['test', 'production'], { error: 'Escolha o ambiente' }),
  config: z.record(z.string(), maxText(500)).default({}),
  secrets: z.record(z.string(), maxText(2000)).default({}),
});
export type GatewayCredentialsInput = z.infer<typeof gatewayCredentialsSchema>;

export const notificationRecipientSchema = z.object({ email: emailSchema });

/** The 7 staff-event toggles; an unknown key fails (GES-66). */
export const notificationEventsSchema = z.strictObject(
  settingsCatalog['notifications.events'].schema.shape,
  { error: (iss) => (iss.code === 'unrecognized_keys' ? 'Evento desconhecido' : undefined) },
);
export type NotificationEventsInput = z.infer<typeof notificationEventsSchema>;

export const mcpTokenInputSchema = z.object({
  name: requiredText('um nome para o token', 1, 60),
  scope: z.enum(['read', 'read_write'], { error: 'Escolha o escopo' }),
  expiresInDays: z
    .number({ error: 'A validade precisa ser de 1 a 365 dias' })
    .int({ error: 'A validade precisa ser de 1 a 365 dias' })
    .min(1, { error: 'A validade precisa ser de 1 a 365 dias' })
    .max(365, { error: 'A validade precisa ser de 1 a 365 dias' })
    .optional(),
});
export type McpTokenInput = z.infer<typeof mcpTokenInputSchema>;

// ---- Serviços extras and orçamentos (GES-84..GES-96) ----

export const extraServiceInputSchema = z
  .object({
    name: requiredText('o nome do serviço', 2, 80),
    description: maxText(1000).default(''),
    referencePriceCents: z
      .number({ error: 'Preço inválido' })
      .int({ error: 'Preço inválido' })
      .min(0, { error: 'Preço inválido' })
      .max(10_000_000, { error: 'O preço máximo é R$ 100.000,00' })
      .nullable()
      .default(null),
    unit: z.enum(['hour', 'project'], { error: 'Escolha a unidade' }),
    saleMode: z.enum(['quote', 'online'], { error: 'Escolha a forma de venda' }).default('quote'),
    status: z.enum(['active', 'inactive'], { error: 'Status inválido' }).default('active'),
    displayOrder: z.number().int().min(0, { error: 'Ordem inválida' }).default(0),
  })
  .refine((s) => s.saleMode !== 'online' || s.referencePriceCents !== null, {
    error: 'Informe o preço para vender online',
    path: ['referencePriceCents'],
  });
export type ExtraServiceInput = z.infer<typeof extraServiceInputSchema>;

/**
 * `POST /public/quote-requests` (GES-90). `today` is the clinic's local date, injected so the
 * desired date stays within today..today + 365. `website` is the honeypot (GES-93).
 */
export function quoteRequestInputSchema(today: LocalDate) {
  const limit = addDays(today, 365);
  return z.object({
    serviceId: z.uuid({ error: 'Escolha o serviço' }),
    name: requiredText('seu nome', 2, 120),
    phone: phoneSchema,
    email: optionalField(emailSchema),
    description: requiredText('o que você precisa', 10, 2000),
    desiredOn: optionalField(
      localDateSchema.refine((d) => d >= today && d <= limit, {
        error: `Escolha uma data entre ${formatLocalDateBR(today)} e ${formatLocalDateBR(limit)}`,
      }),
    ),
    bookingId: idSchema.optional(),
    website: z.string().optional(),
  });
}
export type QuoteRequestInput = z.infer<ReturnType<typeof quoteRequestInputSchema>>;

export const quoteStatusUpdateSchema = z
  .object({
    status: quoteStatusSchema.optional(),
    staffNotes: z.string().max(2000, { error: 'Use no máximo 2000 caracteres' }).optional(),
  })
  .refine((v) => v.status !== undefined || v.staffNotes !== undefined, {
    error: 'Informe o status ou as anotações',
  });
export type QuoteStatusUpdate = z.infer<typeof quoteStatusUpdateSchema>;

// ---- Salas (GES-103..GES-107) ----

export const roomInputSchema = z.object({
  name: requiredText('o nome da sala', 2, 60),
  slug: z
    .string({ error: 'Informe o endereço da sala' })
    .trim()
    .min(2, { error: 'Use de 2 a 40 caracteres' })
    .max(40, { error: 'Use de 2 a 40 caracteres' })
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'Use letras minúsculas, números e hífens' }),
  description: maxText(2000).default(''),
  idealFor: z
    .array(requiredText('o item', 1, 40))
    .max(8, { error: 'Use no máximo 8 itens' })
    .default([]),
  equipment: z
    .array(requiredText('o item', 1, 80))
    .max(30, { error: 'Use no máximo 30 itens' })
    .default([]),
  displayOrder: z.number().int().min(0, { error: 'Ordem inválida' }).default(0),
  status: z.enum(['active', 'inactive'], { error: 'Status inválido' }).default('active'),
});
export type RoomInput = z.infer<typeof roomInputSchema>;

const photoDimension = z
  .number({ error: 'Dimensão inválida' })
  .int({ error: 'Dimensão inválida' })
  .min(1, { error: 'Dimensão inválida' })
  .max(10_000, { error: 'Dimensão inválida' });

/** `POST /admin/rooms/:id/photos` after both variants were uploaded (GES-105). */
export const roomPhotoInputSchema = z.object({
  uploadId: z.uuid({ error: 'Envio inválido' }),
  alt: requiredText('a descrição da foto', 1, 200),
  width: photoDimension,
  height: photoDimension,
});
export type RoomPhotoInput = z.infer<typeof roomPhotoInputSchema>;

// ---- Usuários, Clientes, auditoria (GES-101..GES-115) ----

export const staffUserInputSchema = z.object({
  name: requiredText('o nome', 2, 120),
  email: emailSchema,
  role: staffRoleSchema,
});
export type StaffUserInput = z.infer<typeof staffUserInputSchema>;

export const roleChangeSchema = z
  .object({
    role: staffRoleSchema.optional(),
    status: z.enum(['active', 'disabled'], { error: 'Status inválido' }).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    error: 'Informe o perfil ou o status',
  });
export type RoleChangeInput = z.infer<typeof roleChangeSchema>;

export const customerNotesSchema = z.object({
  notes: z.string({ error: 'Anotações inválidas' }).max(4000, {
    error: 'Use no máximo 4000 caracteres',
  }),
});

/** Admin edit of a customer's profile fields (GES-102); same rules as the tenant's own edit. */
export const customerProfileSchema = updateMeSchema.omit({ document: true });
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

export const auditOriginSchema = z.enum(['web', 'app', 'admin', 'mcp', 'job', 'system'], {
  error: 'Origem inválida',
});

/** `GET /admin/audit` query, at most 100 rows per page (GES-115). */
export const auditQuerySchema = z.object({
  actorId: idSchema.optional(),
  origin: auditOriginSchema.optional(),
  actionPrefix: maxText(100).optional(),
  entityType: maxText(60).optional(),
  entityId: maxText(100).optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number({ error: 'Tamanho de página inválido' })
    .int({ error: 'Tamanho de página inválido' })
    .min(1, { error: 'Tamanho de página inválido' })
    .max(100, { error: 'Use no máximo 100 itens por página' })
    .default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

// ---- Push and LGPD (GES-76, GES-124) ----

const base64UrlKey = z
  .string({ error: 'Chave inválida' })
  .min(1, { error: 'Chave inválida' })
  .max(200, { error: 'Chave inválida' })
  .regex(/^[A-Za-z0-9_-]+$/, { error: 'Chave inválida' });

/** Body of `POST /app/push/subscriptions`: `PushSubscription.toJSON()` (GES-76). */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url({ protocol: /^https$/, error: 'Endereço de notificação inválido' })
    .max(1000, { error: 'Endereço de notificação inválido' }),
  keys: z.object({ p256dh: base64UrlKey, auth: base64UrlKey }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/**
 * `POST /app/me/deletion`: the current password, or the text `EXCLUIR` for Google-only accounts.
 * Whether the value is right is checked by the service (401, GES-126).
 */
export const deletionConfirmSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    confirmText: z.string().trim().max(20).optional(),
  })
  .refine((v) => v.password !== undefined || v.confirmText !== undefined, {
    error: 'Informe sua senha ou digite EXCLUIR',
    path: ['password'],
  });
export type DeletionConfirmInput = z.infer<typeof deletionConfirmSchema>;
