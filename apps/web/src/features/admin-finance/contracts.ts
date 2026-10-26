import {
  REVENUE_CATEGORIES,
  financeGroupingSchema,
  financeRegimeSchema,
  localDateSchema,
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
