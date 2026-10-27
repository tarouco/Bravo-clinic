import { randomUUID } from 'node:crypto';
import type { ExpenseCategoryInput, ExpenseInput, LocalDate } from '@bravo/core';
import { and, asc, desc, eq, gte, isNull, lt, lte, max, ne, or, sql } from 'drizzle-orm';
import { withTransaction, type Db, type Tx } from '../../db/client';
import { expenseCategories, expenses } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { conflict, notFound, storageUnavailable, validationFailed } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { Storage } from '../../lib/storage';

// Expenses, expense categories and attachments (GES-11..GES-19). Deletes are soft (`deleted_at`);
// attachments live in the private bucket `expense-attachments` and are read through 300 s
// presigned URLs.

const BUCKET = 'expense-attachments';
const PAGE_SIZE = 50;
/** Lifetime of an attachment download link (GES-18). */
export const ATTACHMENT_URL_SECONDS = 300;
export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** A partial body as the validators produce it (absent keys may be `undefined`). */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

type CategoryRow = typeof expenseCategories.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;

export const categoryView = (r: CategoryRow) => ({
  id: r.id,
  name: r.name,
  displayOrder: r.displayOrder,
  active: r.active,
});

/** `Expense` of the web contract (gestao design "Web-assumed API contract"). */
export const expenseView = (r: ExpenseRow, categoryName: string) => ({
  id: r.id,
  date: r.date as LocalDate,
  categoryId: r.categoryId,
  categoryName,
  description: r.description,
  amountCents: r.amountCents,
  recurrence: r.recurrence as ExpenseInput['recurrence'],
  recurrenceParentId: r.recurrenceParentId,
  attachmentName: r.attachmentName,
  attachmentContentType: r.attachmentContentType,
});
export type ExpenseView = ReturnType<typeof expenseView>;

const auditable = (r: ExpenseRow) => ({
  date: r.date,
  categoryId: r.categoryId,
  description: r.description,
  amountCents: r.amountCents,
  recurrence: r.recurrence,
  attachmentName: r.attachmentName,
});

// ---- Categories (GES-19) ----

export async function listExpenseCategories(db: Db | Tx) {
  const rows = await db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.displayOrder), asc(expenseCategories.name));
  return rows.map(categoryView);
}

async function assertNameFree(tx: Tx, name: string, exceptId?: string) {
  const conditions = [sql`lower(${expenseCategories.name}) = lower(${name})`];
  if (exceptId !== undefined) conditions.push(ne(expenseCategories.id, exceptId));
  const [taken] = await tx
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(...conditions));
  if (taken !== undefined) throw conflict('CONFLICT', 'Já existe uma categoria com este nome');
}

export async function createExpenseCategory(
  tx: Tx,
  ctx: RequestContext,
  input: ExpenseCategoryInput,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('expense_categories'))`);
  await assertNameFree(tx, input.name);
  const [last] = await tx
    .select({ order: max(expenseCategories.displayOrder) })
    .from(expenseCategories);
  const [row] = await tx
    .insert(expenseCategories)
    .values({
      name: input.name,
      displayOrder: input.displayOrder ?? (last?.order ?? -1) + 1,
      active: input.active ?? true,
    })
    .returning();
  if (row === undefined) throw new Error('expense category insert returned no row');
  await audit(tx, ctx, {
    action: 'expense_category.create',
    entityType: 'expense_category',
    entityId: row.id,
    after: categoryView(row),
  });
  return categoryView(row);
}

/** Rename, reorder or (de)activate; old expenses keep their category (GES-19). */
export async function updateExpenseCategory(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  patch: Patch<ExpenseCategoryInput>,
  now: Date,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('expense_categories'))`);
  const [before] = await tx
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id))
    .for('update');
  if (before === undefined) throw notFound('NOT_FOUND', 'Categoria não encontrada');
  if (patch.name !== undefined) await assertNameFree(tx, patch.name, id);
  const [after] = await tx
    .update(expenseCategories)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.displayOrder !== undefined && { displayOrder: patch.displayOrder }),
      ...(patch.active !== undefined && { active: patch.active }),
      updatedAt: now,
    })
    .where(eq(expenseCategories.id, id))
    .returning();
  if (after === undefined) throw notFound();
  await audit(tx, ctx, {
    action: 'expense_category.update',
    entityType: 'expense_category',
    entityId: id,
    before: categoryView(before),
    after: categoryView(after),
  });
  return categoryView(after);
}

/** 422 on `categoryId` when the category is unknown or inactive (GES-12). */
async function activeCategory(tx: Db | Tx, id: string): Promise<CategoryRow> {
  const [row] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, id));
  if (row === undefined || !row.active) {
    throw validationFailed([{ path: ['categoryId'], message: 'Escolha uma categoria ativa' }]);
  }
  return row;
}

// ---- Expenses (GES-11, GES-13) ----

export interface ExpenseFilters {
  from?: LocalDate | undefined;
  to?: LocalDate | undefined;
  categoryId?: string | undefined;
  cursor?: string | undefined;
}

/** Live expenses, newest date first, 50 per page (deleted rows never appear, GES-13). */
export async function listExpenses(
  db: Db | Tx,
  filters: ExpenseFilters,
): Promise<{ items: ExpenseView[]; nextCursor: string | null }> {
  const conditions = [isNull(expenses.deletedAt)];
  if (filters.from !== undefined) conditions.push(gte(expenses.date, filters.from));
  if (filters.to !== undefined) conditions.push(lte(expenses.date, filters.to));
  if (filters.categoryId !== undefined)
    conditions.push(eq(expenses.categoryId, filters.categoryId));
  if (filters.cursor !== undefined) {
    const after = decodeCursor(filters.cursor);
    const date = after.at.toISOString().slice(0, 10);
    const older = or(
      lt(expenses.date, date),
      and(eq(expenses.date, date), lt(expenses.id, after.id)),
    );
    if (older !== undefined) conditions.push(older);
  }
  const rows = await db
    .select({ expense: expenses, categoryName: expenseCategories.name })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(...conditions))
    .orderBy(desc(expenses.date), desc(expenses.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => expenseView(r.expense, r.categoryName)),
    nextCursor:
      rows.length > PAGE_SIZE && last !== undefined
        ? encodeCursor({ at: new Date(`${last.expense.date}T00:00:00.000Z`), id: last.expense.id })
        : null,
  };
}

async function liveExpense(tx: Db | Tx, id: string, lock = false): Promise<ExpenseRow> {
  const query = tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), isNull(expenses.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) throw notFound('NOT_FOUND', 'Despesa não encontrada');
  return row;
}

async function categoryName(tx: Db | Tx, id: string): Promise<string> {
  const [row] = await tx
    .select({ name: expenseCategories.name })
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id));
  return row?.name ?? '';
}

export async function createExpense(tx: Tx, ctx: RequestContext, input: ExpenseInput) {
  const category = await activeCategory(tx, input.categoryId);
  const [row] = await tx
    .insert(expenses)
    .values({
      date: input.date,
      categoryId: category.id,
      description: input.description,
      amountCents: input.amountCents,
      recurrence: input.recurrence,
      createdBy: ctx.actorUserId,
    })
    .returning();
  if (row === undefined) throw new Error('expense insert returned no row');
  await audit(tx, ctx, {
    action: 'expense.create',
    entityType: 'expense',
    entityId: row.id,
    after: auditable(row),
  });
  return expenseView(row, category.name);
}

/** Edits an expense; a changed category must be active (an unchanged inactive one is kept). */
export async function updateExpense(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  patch: Patch<ExpenseInput>,
  now: Date,
) {
  const before = await liveExpense(tx, id, true);
  if (patch.categoryId !== undefined && patch.categoryId !== before.categoryId) {
    await activeCategory(tx, patch.categoryId);
  }
  const [after] = await tx
    .update(expenses)
    .set({
      ...(patch.date !== undefined && { date: patch.date }),
      ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.amountCents !== undefined && { amountCents: patch.amountCents }),
      ...(patch.recurrence !== undefined && { recurrence: patch.recurrence }),
      updatedAt: now,
    })
    .where(eq(expenses.id, id))
    .returning();
  if (after === undefined) throw notFound();
  await audit(tx, ctx, {
    action: 'expense.update',
    entityType: 'expense',
    entityId: id,
    before: auditable(before),
    after: auditable(after),
  });
  return expenseView(after, await categoryName(tx, after.categoryId));
}

/** Soft delete with audit; reports exclude the row from then on (GES-13). */
export async function deleteExpense(tx: Tx, ctx: RequestContext, id: string, now: Date) {
  const before = await liveExpense(tx, id, true);
  await tx.update(expenses).set({ deletedAt: now, updatedAt: now }).where(eq(expenses.id, id));
  await audit(tx, ctx, {
    action: 'expense.delete',
    entityType: 'expense',
    entityId: id,
    before: auditable(before),
    after: { deletedAt: now.toISOString() },
  });
  return expenseView(before, await categoryName(tx, before.categoryId));
}

// ---- Attachments (GES-16..GES-18) ----

interface AttachmentDeps {
  db: Db;
  storage?: Storage | undefined;
  now: () => Date;
}

function storageOf(deps: AttachmentDeps): Storage {
  if (deps.storage === undefined) throw storageUnavailable();
  return deps.storage;
}

async function deleteObjectQuietly(storage: Storage, key: string) {
  try {
    await storage.delete(BUCKET, key);
  } catch (error) {
    logger.error('expense attachment cleanup failed', {
      error: { name: (error as Error).name, message: (error as Error).message },
    });
  }
}

/** Name shown for the file: the `X-File-Name` the browser sent, or `comprovante.<ext>`. */
export function attachmentName(raw: string | undefined, contentType: string): string {
  let name = '';
  try {
    name = decodeURIComponent(raw ?? '').trim();
  } catch {
    name = '';
  }
  name = name.replace(/[\r\n"\\/]/g, '_').slice(0, 200);
  return name === '' ? `comprovante.${EXTENSION[contentType] ?? 'bin'}` : name;
}

/**
 * Stores the file, points the expense at it, then deletes the previous object once the row
 * committed (GES-16). A failed commit removes the new object again.
 */
export async function setAttachment(
  deps: AttachmentDeps,
  ctx: RequestContext,
  id: string,
  file: { bytes: Uint8Array; contentType: string; name: string },
) {
  const storage = storageOf(deps);
  await liveExpense(deps.db, id);
  const key = `expenses/${id}/${randomUUID()}`;
  await storage.put(BUCKET, key, file.bytes, { contentType: file.contentType });
  let previous: string | null = null;
  let view: ExpenseView;
  try {
    view = await withTransaction(deps.db, async (tx) => {
      const before = await liveExpense(tx, id, true);
      previous = before.attachmentKey;
      const [after] = await tx
        .update(expenses)
        .set({
          attachmentKey: key,
          attachmentName: file.name,
          attachmentContentType: file.contentType,
          updatedAt: deps.now(),
        })
        .where(eq(expenses.id, id))
        .returning();
      if (after === undefined) throw notFound();
      await audit(tx, ctx, {
        action: 'expense.attachment_upload',
        entityType: 'expense',
        entityId: id,
        before: { attachmentName: before.attachmentName },
        after: {
          attachmentName: file.name,
          attachmentContentType: file.contentType,
          size: file.bytes.byteLength,
        },
      });
      return expenseView(after, await categoryName(tx, after.categoryId));
    });
  } catch (error) {
    await deleteObjectQuietly(storage, key);
    throw error;
  }
  if (previous !== null) await deleteObjectQuietly(storage, previous);
  return view;
}

/** Presigned download URL valid for 300 s (GES-18); 404 without an attachment. */
export async function attachmentUrl(deps: AttachmentDeps, id: string): Promise<string> {
  const row = await liveExpense(deps.db, id);
  if (row.attachmentKey === null) throw notFound('NOT_FOUND', 'Despesa sem comprovante');
  return storageOf(deps).presignGet(
    BUCKET,
    row.attachmentKey,
    ATTACHMENT_URL_SECONDS,
    row.attachmentName ?? undefined,
  );
}

/** Clears the attachment columns, then deletes the object after commit. */
export async function removeAttachment(deps: AttachmentDeps, ctx: RequestContext, id: string) {
  const storage = storageOf(deps);
  const key = await withTransaction(deps.db, async (tx) => {
    const before = await liveExpense(tx, id, true);
    if (before.attachmentKey === null) throw notFound('NOT_FOUND', 'Despesa sem comprovante');
    await tx
      .update(expenses)
      .set({
        attachmentKey: null,
        attachmentName: null,
        attachmentContentType: null,
        updatedAt: deps.now(),
      })
      .where(eq(expenses.id, id));
    await audit(tx, ctx, {
      action: 'expense.attachment_delete',
      entityType: 'expense',
      entityId: id,
      before: { attachmentName: before.attachmentName },
    });
    return before.attachmentKey;
  });
  await deleteObjectQuietly(storage, key);
}
