import {
  expenseCategoryInputSchema,
  expenseInputSchema,
  expenseRecurrenceSchema,
  idSchema,
  localDateSchema,
} from '@bravo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { readBinaryBody } from '../../lib/storage';
import { actorContext } from '../../lib/request-meta';
import { validate } from '../../middleware/validate';
import {
  ATTACHMENT_TYPES,
  attachmentName,
  attachmentUrl,
  createExpense,
  createExpenseCategory,
  deleteExpense,
  listExpenseCategories,
  listExpenses,
  removeAttachment,
  setAttachment,
  updateExpense,
  updateExpenseCategory,
} from '../../modules/finance/expenses.service';
import type { AppEnv } from '../../types';

const idParam = z.object({ id: idSchema });
const listQuery = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  categoryId: idSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
});
// No default on `recurrence` here: an edit that leaves it out keeps the stored rule.
const expensePatchSchema = z
  .object({ ...expenseInputSchema.shape, recurrence: expenseRecurrenceSchema })
  .partial();
const categoryPatchSchema = expenseCategoryInputSchema.partial();

/** Despesas and categories (GES-11..GES-19); `adminRoutes` limits `/finance/*` to admins. */
export function adminFinanceExpenseRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/finance/expense-categories', async (c) =>
    c.json({ items: await listExpenseCategories(c.var.deps.db) }),
  );

  app.post(
    '/finance/expense-categories',
    validate('json', expenseCategoryInputSchema),
    async (c) => {
      const ctx = actorContext(c);
      const category = await withTransaction(c.var.deps.db, (tx) =>
        createExpenseCategory(tx, ctx, c.req.valid('json')),
      );
      return c.json(category, 201);
    },
  );

  app.patch(
    '/finance/expense-categories/:id',
    validate('param', idParam),
    validate('json', categoryPatchSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      return c.json(
        await withTransaction(db, (tx) =>
          updateExpenseCategory(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
        ),
      );
    },
  );

  app.get('/finance/expenses', validate('query', listQuery), async (c) =>
    c.json(await listExpenses(c.var.deps.db, c.req.valid('query'))),
  );

  app.post('/finance/expenses', validate('json', expenseInputSchema), async (c) => {
    const ctx = actorContext(c);
    const expense = await withTransaction(c.var.deps.db, (tx) =>
      createExpense(tx, ctx, c.req.valid('json')),
    );
    return c.json(expense, 201);
  });

  app.patch(
    '/finance/expenses/:id',
    validate('param', idParam),
    validate('json', expensePatchSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const ctx = actorContext(c);
      return c.json(
        await withTransaction(db, (tx) =>
          updateExpense(tx, ctx, c.req.valid('param').id, c.req.valid('json'), now()),
        ),
      );
    },
  );

  app.delete('/finance/expenses/:id', validate('param', idParam), async (c) => {
    const { db, now } = c.var.deps;
    const ctx = actorContext(c);
    await withTransaction(db, (tx) => deleteExpense(tx, ctx, c.req.valid('param').id, now()));
    return c.body(null, 204);
  });

  app.put('/finance/expenses/:id/attachment', validate('param', idParam), async (c) => {
    const ctx = actorContext(c);
    const file = await readBinaryBody(c, { allowed: ATTACHMENT_TYPES });
    const expense = await setAttachment(c.var.deps, ctx, c.req.valid('param').id, {
      ...file,
      name: attachmentName(c.req.header('X-File-Name'), file.contentType),
    });
    return c.json(expense);
  });

  app.get('/finance/expenses/:id/attachment', validate('param', idParam), async (c) =>
    c.redirect(await attachmentUrl(c.var.deps, c.req.valid('param').id), 302),
  );

  app.delete('/finance/expenses/:id/attachment', validate('param', idParam), async (c) => {
    await removeAttachment(c.var.deps, actorContext(c), c.req.valid('param').id);
    return c.body(null, 204);
  });
  return app;
}
