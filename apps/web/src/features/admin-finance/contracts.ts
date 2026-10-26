import {
  REVENUE_CATEGORIES,
  expenseRecurrenceSchema,
  financeGroupingSchema,
  financeRegimeSchema,
  localDateSchema,
  manualReceiptMethodSchema,
  revenueCategorySchema,
} from '@bravo/core';
import { z } from 'zod';

// Response shapes of the gestao finance routes (gestao design "Data Models" and "Finance
// services"). Core owns the request schemas and the `Totals` type; the response contracts are
// declared here, so MSW fixtures are validated against them (AD-035) and the types of the hooks
// come from the same definition. The shapes the design leaves open are listed in the design's
// "Web-assumed API contract" section.

const cents = z.number().int();

/** `Totals` of core: deductions negative, net = 1+2+3+4, result = net + expenses. */
export const totalsSchema = z
  .object({
    grossCents: cents,
    discountsCents: cents,
    refundsCents: cents,
    feesCents: cents,
    netCents: cents,
    expensesCents: cents,
    resultCents: cents,
  })
  .refine((t) => t.netCents === t.grossCents + t.discountsCents + t.refundsCents + t.feesCents, {
    error: 'netCents must be gross + discounts + refunds + fees',
  })
  .refine((t) => t.resultCents === t.netCents + t.expensesCents, {
    error: 'resultCents must be net + expenses',
  });

const rangeSchema = z.object({ from: localDateSchema, to: localDateSchema });

const delta = z.object({ deltaCents: cents, deltaPercent: z.number().nullable() });

export const financeSummarySchema = z.object({
  regime: financeRegimeSchema,
  grouping: financeGroupingSchema,
  from: localDateSchema,
  to: localDateSchema,
  buckets: z.array(
    z
      .object({ key: z.string().min(1), label: z.string().min(1) })
      .extend(rangeSchema.shape)
      .and(totalsSchema),
  ),
  totals: totalsSchema,
  previous: rangeSchema.and(totalsSchema),
  comparison: z.object({
    grossCents: delta,
    discountsCents: delta,
    refundsCents: delta,
    feesCents: delta,
    netCents: delta,
    expensesCents: delta,
    resultCents: delta,
  }),
  byRevenueCategory: z.object(
    Object.fromEntries(REVENUE_CATEGORIES.map((c) => [c, cents])) as Record<
      (typeof REVENUE_CATEGORIES)[number],
      typeof cents
    >,
  ),
  byExpenseCategory: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), cents })),
});
export type FinanceSummary = z.infer<typeof financeSummarySchema>;
export type FinanceTotals = z.infer<typeof totalsSchema>;

// ---- Expenses and manual receipts (GES-11..GES-21) ----

export const expenseCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  displayOrder: z.number().int().min(0),
  active: z.boolean(),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;
export const expenseCategoryListSchema = z.object({ items: z.array(expenseCategorySchema) });

export const expenseSchema = z.object({
  id: z.string().min(1),
  date: localDateSchema,
  categoryId: z.string().min(1),
  categoryName: z.string().min(1),
  description: z.string().min(1),
  amountCents: z.number().int().min(1),
  recurrence: expenseRecurrenceSchema,
  /** Set on the child rows the daily job materializes from a recurring parent (GES-14). */
  recurrenceParentId: z.string().nullable(),
  attachmentName: z.string().nullable(),
  attachmentContentType: z.string().nullable(),
});
export type Expense = z.infer<typeof expenseSchema>;
export const expenseListSchema = z.object({
  items: z.array(expenseSchema),
  nextCursor: z.string().nullable(),
});

export const manualReceiptSchema = z.object({
  id: z.string().min(1),
  date: localDateSchema,
  revenueCategory: revenueCategorySchema,
  method: manualReceiptMethodSchema,
  amountCents: z.number().int().min(1),
  description: z.string().nullable(),
  customerName: z.string().nullable(),
  bookingCode: z.string().nullable(),
});
export type ManualReceipt = z.infer<typeof manualReceiptSchema>;
export const manualReceiptListSchema = z.object({
  items: z.array(manualReceiptSchema),
  nextCursor: z.string().nullable(),
});
