import { nextOccurrences, utcToLocal, type ExpenseRecurrence, type LocalDate } from '@bravo/core';
import { and, eq, isNull, lte, max, ne } from 'drizzle-orm';
import { withTransaction } from '../db/client';
import { expenses } from '../db/schema';
import { audit } from '../lib/audit';
import { JOB_CONTEXT, type Job } from './runner';

// Daily `recurring-expenses` (GES-14, GES-15; `0 9 * * *` UTC, trigger added by T49): one child row
// per due occurrence of every live recurring parent, never one dated after today.

/**
 * Children continue after the latest child ever created (deleted ones included, so a deleted
 * child is not re-created); the partial unique index `(recurrence_parent_id, date)` makes a
 * concurrent or repeated run a no-op.
 */
export const recurringExpenses: Job = async (deps, now) => {
  const today = utcToLocal(now).date;
  const parents = await deps.db
    .select()
    .from(expenses)
    .where(
      and(
        ne(expenses.recurrence, 'none'),
        isNull(expenses.deletedAt),
        isNull(expenses.recurrenceParentId),
        lte(expenses.date, today),
      ),
    );
  let created = 0;
  for (const parent of parents) {
    const [last] = await deps.db
      .select({ date: max(expenses.date) })
      .from(expenses)
      .where(eq(expenses.recurrenceParentId, parent.id));
    const dates = nextOccurrences(
      parent.date as LocalDate,
      parent.recurrence as ExpenseRecurrence,
      (last?.date ?? null) as LocalDate | null,
      today,
    );
    if (dates.length === 0) continue;
    created += await withTransaction(deps.db, async (tx) => {
      const rows = await tx
        .insert(expenses)
        .values(
          dates.map((date) => ({
            date,
            categoryId: parent.categoryId,
            description: parent.description,
            amountCents: parent.amountCents,
            recurrence: 'none',
            recurrenceParentId: parent.id,
          })),
        )
        .onConflictDoNothing()
        .returning();
      for (const row of rows) {
        await audit(tx, JOB_CONTEXT, {
          action: 'expense.create',
          entityType: 'expense',
          entityId: row.id,
          after: {
            date: row.date,
            amountCents: row.amountCents,
            recurrenceParentId: parent.id,
          },
        });
      }
      return rows.length;
    });
  }
  return { parents: parents.length, created };
};
