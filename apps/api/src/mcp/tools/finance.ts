import { expenseInputSchema, formatBRL, idSchema, localDateSchema } from '@bravo/core';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction } from '../../db/client';
import { expenseCategories, expenses } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { createExpense, deleteExpense, listExpenses } from '../../modules/finance/expenses.service';
import { defineTool, type ToolDefinition } from '../server';

// gestao finance tools of design "MCP tool catalog" (AD-028): the same services as Financeiro.

const formatDate = (date: string) => date.split('-').reverse().join('/');

export function financeTools(): ToolDefinition[] {
  return [
    defineTool({
      name: 'expenses_list',
      description: 'Lista as despesas de um período (de/até), opcionalmente de uma categoria.',
      scope: 'read',
      input: z.object({
        from: localDateSchema,
        to: localDateSchema,
        categoryId: idSchema.optional(),
        cursor: z.string().min(1).max(200).optional(),
      }),
      run: (tc, input) => listExpenses(tc.deps.db, input),
    }),
    defineTool({
      name: 'expense_create',
      description:
        'Lança uma despesa (data, categoria ativa, descrição, valor em centavos e recorrência opcional).',
      scope: 'write',
      input: expenseInputSchema,
      run: (tc, input) => withTransaction(tc.deps.db, (tx) => createExpense(tx, tc.ctx, input)),
    }),
    defineTool({
      name: 'expense_delete',
      description: 'Exclui uma despesa (fica fora dos relatórios). Exige confirm: true.',
      scope: 'write',
      destructive: true,
      input: z.object({ expenseId: idSchema }),
      preview: async (tc, input) => {
        const [row] = await tc.deps.db
          .select({
            date: expenses.date,
            description: expenses.description,
            amountCents: expenses.amountCents,
            category: expenseCategories.name,
          })
          .from(expenses)
          .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
          .where(and(eq(expenses.id, input.expenseId), isNull(expenses.deletedAt)));
        if (row === undefined) throw notFound('NOT_FOUND', 'Despesa não encontrada');
        return `Excluir a despesa "${row.description}" (${row.category}) de ${formatBRL(row.amountCents)} em ${formatDate(row.date)}; ela deixa de contar nos relatórios.`;
      },
      run: async (tc, input) => {
        const deleted = await withTransaction(tc.deps.db, (tx) =>
          deleteExpense(tx, tc.ctx, input.expenseId, tc.deps.now()),
        );
        return { deleted: true, expense: deleted };
      },
    }),
  ];
}
