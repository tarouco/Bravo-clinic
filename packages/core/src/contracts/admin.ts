import { z } from 'zod';
import { emailSchema, phoneSchema, DOCUMENT_MESSAGE } from '../validation/auth-schemas';
import { parseDocument } from '../validation/document';
import { settingsCatalog } from '../settings/catalog';
import { diffDays } from '../time';
import { bookingStatusSchema } from '../status/booking';
import {
  adminCellSchema,
  affectedBookingSchema,
  bookingCodeSchema,
  bookingDetailSchema,
  bookingSourceSchema,
  bookingSummarySchema,
  businessHoursRowSchema,
  centsSchema,
  holidayScopeSchema,
  holidaySourceSchema,
  idSchema,
  instantSchema,
  justificationSchema,
  localDateSchema,
  minuteOfDaySchema,
  policyValuesSchema,
  positiveCentsSchema,
  weekdaysSchema,
} from './common';
import { availabilityDaySchema } from './public';
import { cancellationPreviewSchema } from './app';

// Admin endpoints (`/api/admin`, staff + MFA) of design.md section "API Contract".

const endAfterStart = {
  check: (v: { startMinute: number; endMinute: number }) => v.endMinute > v.startMinute,
  params: { error: 'O fim precisa ser depois do início', path: ['endMinute'] },
};

/** Comma-separated query list of ids; absent or empty means null (whole clinic). */
const idListQuerySchema = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? null : v.split(',').map((s) => s.trim())))
  .pipe(z.array(idSchema).nullable());

// ---- Calendar configuration (NUC-32..NUC-38) ----

export const businessHoursUpdateSchema = z.object({
  rows: z
    .array(businessHoursRowSchema)
    .length(8, { error: 'Informe os 8 dias (segunda a domingo e feriados)' })
    .refine((rows) => new Set(rows.map((r) => r.dayType)).size === rows.length, {
      error: 'Cada dia aparece uma única vez',
    }),
});
export type BusinessHoursUpdate = z.infer<typeof businessHoursUpdateSchema>;

export const businessHoursResponseSchema = z.object({
  businessHours: z.array(businessHoursRowSchema).length(8),
});

export const calendarSettingsSchema = z
  .object({
    slotMinutes: settingsCatalog['calendar.slot_minutes'].schema,
    defaultBookingMinutes: settingsCatalog['calendar.default_booking_minutes'].schema,
    cleanupMinutes: settingsCatalog['calendar.cleanup_minutes'].schema,
    minAdvanceMinutes: settingsCatalog['calendar.min_advance_minutes'].schema,
    maxAdvanceDays: settingsCatalog['calendar.max_advance_days'].schema,
  })
  .refine((s) => s.defaultBookingMinutes % s.slotMinutes === 0, {
    error: 'A duração padrão precisa ser múltipla do slot',
    path: ['defaultBookingMinutes'],
  });
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;

export const calendarWarningSchema = z.object({
  code: z.literal('cleanup_not_slot_multiple'),
  lostMinutesPerBooking: z.number().int().positive(),
});

export const calendarConfigSchema = z.object({
  businessHours: z.array(businessHoursRowSchema).length(8),
  settings: calendarSettingsSchema,
  warnings: z.array(calendarWarningSchema),
  onboarding: z.object({ pricesReviewed: z.boolean() }),
});
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;

export const calendarSettingsResultSchema = z.object({
  settings: calendarSettingsSchema,
  warnings: z.array(calendarWarningSchema),
});

// ---- Holidays and closed days (NUC-43..NUC-50) ----

export const holidaysQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

export const holidaySchema = z.object({
  id: idSchema,
  date: localDateSchema,
  name: z.string().min(1),
  scope: holidayScopeSchema,
  source: holidaySourceSchema,
  isClosed: z.boolean(),
  needsReview: z.boolean(),
  alert: z.boolean(),
});
export type Holiday = z.infer<typeof holidaySchema>;

export const holidayListSchema = z.object({ items: z.array(holidaySchema) });

export const holidayCreateSchema = z.object({
  date: localDateSchema,
  name: z.string().trim().min(2, { error: 'Informe o nome do feriado' }).max(120),
  scope: holidayScopeSchema,
});

export const holidayUpdateSchema = z
  .object({
    isClosed: z.boolean().optional(),
    name: z.string().trim().min(2).max(120).optional(),
    needsReview: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nada para alterar' });

export const holidayImportSchema = z.object({ year: z.number().int().min(2000).max(2100) });
export const holidayImportResultSchema = z.object({
  inserted: z.number().int().min(0),
  updated: z.number().int().min(0),
});

export const closedDaysQuerySchema = z.object({ from: localDateSchema, to: localDateSchema });

export const closedDaySchema = z.object({
  id: idSchema,
  date: localDateSchema,
  roomId: idSchema.nullable(),
  roomName: z.string().nullable(),
  reason: z.string().nullable(),
});
export const closedDayListSchema = z.object({ items: z.array(closedDaySchema) });

export const closedDayPreviewQuerySchema = z.object({
  date: localDateSchema,
  roomIds: idListQuerySchema,
});

export const compensationSummarySchema = z.object({
  subscribers: z.number().int().min(0),
  minutes: z.number().int().min(0),
  creditCents: centsSchema,
  fixedOccurrencesCancelled: z.number().int().min(0),
});

export const closedDayPreviewSchema = z.object({
  affectedBookings: z.array(affectedBookingSchema),
  compensation: compensationSummarySchema,
});

export const closedDayCreateSchema = z.object({
  date: localDateSchema,
  roomIds: z.array(idSchema).min(1).nullable(),
  reason: z.string().trim().max(200).optional(),
});

export const closedDayCreateResultSchema = z.object({
  items: z.array(closedDaySchema).min(1),
  compensation: compensationSummarySchema,
});

// ---- Blocks (NUC-54..NUC-58) ----

export const blockTagSchema = z
  .string({ error: 'Informe a tag do bloqueio' })
  .trim()
  .min(1, { error: 'Informe a tag do bloqueio' })
  .max(60, { error: 'Use no máximo 60 caracteres' });

export const blocksQuerySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  roomId: idSchema.optional(),
});

export const blockSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  tag: z.string().min(1),
  startsAt: instantSchema,
  endsAt: instantSchema,
  recurrenceId: idSchema.nullable(),
});
export const blockListSchema = z.object({ items: z.array(blockSchema) });

export const blockCreateSchema = z
  .object({
    roomIds: z.array(idSchema).min(1, { error: 'Escolha pelo menos uma sala' }),
    tag: blockTagSchema,
    date: localDateSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
  })
  .refine(endAfterStart.check, endAfterStart.params);

export const blockCreateResultSchema = z.object({ items: z.array(blockSchema).min(1) });

export const blockRecurrenceSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  tag: z.string().min(1),
  weekdays: weekdaysSchema,
  startMinute: minuteOfDaySchema,
  endMinute: minuteOfDaySchema,
  validFrom: localDateSchema,
  validUntil: localDateSchema.nullable(),
  active: z.boolean(),
});
export const blockRecurrenceListSchema = z.object({ items: z.array(blockRecurrenceSchema) });

export const blockRecurrenceCreateSchema = z
  .object({
    roomIds: z.array(idSchema).min(1, { error: 'Escolha pelo menos uma sala' }),
    tag: blockTagSchema,
    weekdays: weekdaysSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    validFrom: localDateSchema,
    validUntil: localDateSchema.optional(),
    skipConflicts: z.boolean().optional(),
  })
  .refine(endAfterStart.check, endAfterStart.params)
  .refine((r) => r.validUntil === undefined || r.validUntil >= r.validFrom, {
    error: 'O fim da recorrência precisa ser depois do início',
    path: ['validUntil'],
  });

export const blockRecurrenceCreateResultSchema = z.object({
  items: z.array(blockRecurrenceSchema).min(1),
  created: z.number().int().min(0),
  skipped: z.array(z.object({ roomId: idSchema, date: localDateSchema })),
});

// ---- Categories (NUC-61..NUC-69) ----

export const categoryTypeSchema = z.enum(['hourly', 'block', 'hour_package', 'fixed_schedule']);
export const categoryPeriodSchema = z.enum(['single', 'monthly', 'bimonthly', 'quarterly']);
export const categoryStatusSchema = z.enum(['active', 'inactive']);
export const categoryVisibilitySchema = z.enum(['public', 'admin_only']);

export const adminCategorySchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  type: categoryTypeSchema,
  weekdays: weekdaysSchema,
  appliesOnHolidays: z.boolean(),
  startMinute: minuteOfDaySchema,
  endMinute: minuteOfDaySchema,
  weekdayRateCents: positiveCentsSchema.nullable(),
  weekendRateCents: positiveCentsSchema.nullable(),
  minDurationMinutes: z.number().int().positive().nullable(),
  fixedPriceCents: positiveCentsSchema.nullable(),
  pricePerOccurrenceCents: positiveCentsSchema.nullable(),
  includedMinutes: z.number().int().positive().nullable(),
  period: categoryPeriodSchema,
  isReference: z.boolean(),
  status: categoryStatusSchema,
  visibility: categoryVisibilitySchema,
  roomId: idSchema.nullable(),
  displayOrder: z.number().int(),
  version: z.number().int().min(1),
  averageHourlyCents: centsSchema,
  editable: z.boolean(),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminCategoryListSchema = z.object({ items: z.array(adminCategorySchema) });

const categoryNameSchema = z
  .string({ error: 'Informe o nome da categoria' })
  .trim()
  .min(2, { error: 'Informe o nome da categoria' })
  .max(80, { error: 'Use no máximo 80 caracteres' });

const categoryCommon = {
  name: categoryNameSchema,
  weekdays: weekdaysSchema,
  appliesOnHolidays: z.boolean(),
  startMinute: minuteOfDaySchema,
  endMinute: minuteOfDaySchema,
  status: categoryStatusSchema.optional(),
  visibility: categoryVisibilitySchema.optional(),
};

export const hourlyCategoryCreateSchema = z
  .object({
    type: z.literal('hourly'),
    ...categoryCommon,
    weekdayRateCents: positiveCentsSchema,
    weekendRateCents: positiveCentsSchema,
    minDurationMinutes: z.number().int().positive({ error: 'Informe a duração mínima' }),
  })
  .refine(endAfterStart.check, endAfterStart.params);

export const blockCategoryCreateSchema = z
  .object({ type: z.literal('block'), ...categoryCommon, fixedPriceCents: positiveCentsSchema })
  .refine(endAfterStart.check, endAfterStart.params);

/** Package types are validated by the registered `CategoryHandler` schema (receita). */
export const handledCategoryCreateSchema = z.looseObject({
  type: z.enum(['hour_package', 'fixed_schedule']),
});

export const categoryCreateSchema = z.discriminatedUnion('type', [
  hourlyCategoryCreateSchema,
  blockCategoryCreateSchema,
  handledCategoryCreateSchema,
]);
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z
  .strictObject({
    name: categoryNameSchema.optional(),
    weekdays: weekdaysSchema.optional(),
    appliesOnHolidays: z.boolean().optional(),
    startMinute: minuteOfDaySchema.optional(),
    endMinute: minuteOfDaySchema.optional(),
    weekdayRateCents: positiveCentsSchema.optional(),
    weekendRateCents: positiveCentsSchema.optional(),
    minDurationMinutes: z.number().int().positive().optional(),
    fixedPriceCents: positiveCentsSchema.optional(),
    status: categoryStatusSchema.optional(),
    visibility: categoryVisibilitySchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nada para alterar' });
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export const categoryReorderSchema = z.object({
  ids: z
    .array(idSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Categorias repetidas' }),
});

export const pricesReviewedSchema = z.object({ pricesReviewed: z.literal(true) });

// ---- Policy settings (NUC-172..NUC-174) ----

/** PUT body: every policy value; cross-field rules of NUC-173 report the offending paths. */
export const policySettingsUpdateSchema = policyValuesSchema.superRefine((v, ctx) => {
  const charge = v['payment.balance_charge_hours_before'];
  const deadline = v['payment.balance_deadline_hours_before'];
  if (deadline >= charge) {
    ctx.addIssue({
      code: 'custom',
      message: 'O prazo do saldo precisa ser menor que o momento da cobrança',
      path: ['payment.balance_deadline_hours_before'],
    });
  }
  const reminders = v['payment.balance_reminder_hours_before'];
  const ordered = reminders.every((h, i) => i === 0 || h < (reminders[i - 1] ?? 0));
  const inside = reminders.every((h) => h >= deadline && h <= charge);
  if (!ordered || !inside) {
    ctx.addIssue({
      code: 'custom',
      message: 'Os lembretes precisam ser decrescentes e ficar entre o prazo e a cobrança',
      path: ['payment.balance_reminder_hours_before'],
    });
  }
});

export const policySettingsSchema = z.object({
  version: z.number().int().min(1),
  values: policyValuesSchema,
});
export type PolicySettings = z.infer<typeof policySettingsSchema>;

// ---- Gestão de Reservas (NUC-157..NUC-171) ----

export const calendarEventsQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    roomId: idSchema.optional(),
    status: bookingStatusSchema.optional(),
    categoryId: idSchema.optional(),
  })
  .refine((q) => diffDays(q.from, q.to) >= 0 && diffDays(q.from, q.to) <= 42, {
    error: 'O período precisa ter no máximo 42 dias',
    path: ['to'],
  });

export const calendarEventsSchema = z.object({
  bookings: z.array(
    z.object({
      id: idSchema,
      code: bookingCodeSchema,
      firstName: z.string(),
      fullName: z.string(),
      roomId: idSchema,
      roomName: z.string().min(1),
      status: bookingStatusSchema,
      statusLabel: z.string().min(1),
      paidCents: centsSchema,
      totalCents: centsSchema,
      packageMinutes: z.number().int().min(0),
      startsAt: instantSchema,
      endsAt: instantSchema,
      cleanupUntil: instantSchema,
      categoryNames: z.array(z.string()),
      checkedInAt: instantSchema.nullable(),
      holdExpiresAt: instantSchema.nullable(),
    }),
  ),
  blocks: z.array(blockSchema),
  closedDays: z.array(closedDaySchema),
  holidays: z.array(holidaySchema),
});
export type CalendarEvents = z.infer<typeof calendarEventsSchema>;

export const adminAvailabilityDaySchema = availabilityDaySchema.extend({
  cells: z.array(adminCellSchema),
});
export type AdminAvailabilityDay = z.infer<typeof adminAvailabilityDaySchema>;

export const adminBookingsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: bookingStatusSchema.optional(),
  roomId: idSchema.optional(),
  categoryId: idSchema.optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  cursor: z.string().min(1).optional(),
});

export const adminBookingListSchema = z.object({
  items: z.array(
    bookingSummarySchema.extend({
      customerName: z.string(),
      customerEmail: z.string(),
      source: bookingSourceSchema,
    }),
  ),
  nextCursor: z.string().min(1).nullable(),
});

export const adminBookingDetailSchema = bookingDetailSchema.extend({
  customer: z.object({
    id: idSchema,
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
  }),
});
export type AdminBookingDetail = z.infer<typeof adminBookingDetailSchema>;

export const staffCreateBookingSchema = z
  .object({
    userId: idSchema,
    roomId: idSchema,
    date: localDateSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    blockCategoryId: idSchema.optional(),
    kind: z.enum(['booking', 'pre_reservation']),
    expiresInHours: z.number().int().min(1).max(720).optional(),
    confirmManually: z.boolean().optional(),
    justification: justificationSchema.optional(),
  })
  .refine(endAfterStart.check, endAfterStart.params)
  .refine((b) => b.confirmManually !== true || b.justification !== undefined, {
    error: 'Informe a justificativa',
    path: ['justification'],
  });
export type StaffCreateBookingInput = z.infer<typeof staffCreateBookingSchema>;

export const staffBookingCreatedSchema = bookingDetailSchema.extend({
  paymentLink: z.url().nullable(),
});

export const confirmManualSchema = z.object({ justification: justificationSchema });
export const resendLinkResultSchema = z.object({ paymentLink: z.url() });

export const cleanupExceptionSchema = z.object({
  cleanupMinutes: z.number().int().min(0).max(240),
  justification: justificationSchema,
});

export const adminRescheduleSchema = z
  .object({
    roomId: idSchema.optional(),
    date: localDateSchema,
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    exception: z.boolean().optional(),
    differenceHandling: z.enum(['add_to_balance', 'waive']).optional(),
    justification: justificationSchema.optional(),
  })
  .refine(endAfterStart.check, endAfterStart.params)
  .refine(
    (r) =>
      (r.exception !== true && r.differenceHandling !== 'waive') || r.justification !== undefined,
    { error: 'Informe a justificativa', path: ['justification'] },
  );

export const adminRescheduleResultSchema = bookingDetailSchema.extend({ creditCents: centsSchema });

export const adminCancellationPreviewSchema = cancellationPreviewSchema.extend({
  clinicOptions: z.array(z.enum(['refund', 'minutes', 'credit'])),
});

export const adminCancelSchema = z.object({
  reason: z
    .string({ error: 'Informe o motivo' })
    .trim()
    .min(3, { error: 'Informe o motivo' })
    .max(500),
  resolution: z.enum(['refund', 'credit', 'minutes']),
  justification: justificationSchema.optional(),
});

export const customerSearchQuerySchema = z.object({
  q: z.string().trim().min(2, { error: 'Digite pelo menos 2 caracteres' }).max(120),
});

export const customerSearchResultSchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema,
        name: z.string(),
        email: z.string(),
        docMasked: z.string().nullable(),
        phone: z.string().nullable(),
      }),
    )
    .max(20),
});

export const customerCreateSchema = z.object({
  name: z
    .string({ error: 'Informe o nome' })
    .trim()
    .min(2, { error: 'Informe o nome completo' })
    .max(120, { error: 'Use no máximo 120 caracteres' }),
  email: emailSchema,
  phone: phoneSchema,
  document: z
    .string({ error: DOCUMENT_MESSAGE })
    .trim()
    .refine((v) => parseDocument(v) !== null, { error: DOCUMENT_MESSAGE }),
});
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const customerCreatedSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
});
