import type { LocalDate, ManualReceiptInput, RevenueCategory } from '@bravo/core';
import { and, desc, eq, gte, isNull, lt, lte, or } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookings, manualReceipts, users } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { notFound, validationFailed } from '../../lib/errors';

// Manual receipts (GES-20, GES-21): money received outside the gateway (cash, card machine, direct
// Pix). They enter the DRE as gross revenue of their category; deletes are soft and justified.

const PAGE_SIZE = 50;

type ReceiptRow = typeof manualReceipts.$inferSelect;

/** `ManualReceipt` of the web contract (gestao design "Web-assumed API contract"). */
const receiptView = (r: ReceiptRow, customerName: string | null, bookingCode: string | null) => ({
  id: r.id,
  date: r.date as LocalDate,
  revenueCategory: r.revenueCategory as RevenueCategory,
  method: r.method as ManualReceiptInput['method'],
  amountCents: r.amountCents,
  description: r.description,
  customerName,
  bookingCode,
});
export type ManualReceiptView = ReturnType<typeof receiptView>;

const auditable = (r: ReceiptRow) => ({
  date: r.date,
  revenueCategory: r.revenueCategory,
  method: r.method,
  amountCents: r.amountCents,
  description: r.description,
  userId: r.userId,
  bookingId: r.bookingId,
});

function selectViews(db: Db | Tx) {
  return db
    .select({ receipt: manualReceipts, customerName: users.name, bookingCode: bookings.code })
    .from(manualReceipts)
    .leftJoin(users, eq(users.id, manualReceipts.userId))
    .leftJoin(bookings, eq(bookings.id, manualReceipts.bookingId));
}

/** Live receipts of a range, newest date first, 50 per page. */
export async function listReceipts(
  db: Db | Tx,
  filters: {
    from?: LocalDate | undefined;
    to?: LocalDate | undefined;
    cursor?: string | undefined;
  },
): Promise<{ items: ManualReceiptView[]; nextCursor: string | null }> {
  const conditions = [isNull(manualReceipts.deletedAt)];
  if (filters.from !== undefined) conditions.push(gte(manualReceipts.date, filters.from));
  if (filters.to !== undefined) conditions.push(lte(manualReceipts.date, filters.to));
  if (filters.cursor !== undefined) {
    const after = decodeCursor(filters.cursor);
    const date = after.at.toISOString().slice(0, 10);
    const older = or(
      lt(manualReceipts.date, date),
      and(eq(manualReceipts.date, date), lt(manualReceipts.id, after.id)),
    );
    if (older !== undefined) conditions.push(older);
  }
  const rows = await selectViews(db)
    .where(and(...conditions))
    .orderBy(desc(manualReceipts.date), desc(manualReceipts.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => receiptView(r.receipt, r.customerName, r.bookingCode)),
    nextCursor:
      rows.length > PAGE_SIZE && last !== undefined
        ? encodeCursor({ at: new Date(`${last.receipt.date}T00:00:00.000Z`), id: last.receipt.id })
        : null,
  };
}

/**
 * Records a receipt with audit `manual_receipt.create` (GES-20). The customer and the booking
 * must exist, and a booking given with a customer must be that customer's.
 */
export async function createReceipt(tx: Tx, ctx: RequestContext, input: ManualReceiptInput) {
  let customerName: string | null = null;
  let bookingCode: string | null = null;
  if (input.userId !== undefined) {
    const [user] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, input.userId));
    if (user === undefined) {
      throw validationFailed([{ path: ['userId'], message: 'Cliente não encontrado' }]);
    }
    customerName = user.name;
  }
  if (input.bookingId !== undefined) {
    const [booking] = await tx
      .select({ code: bookings.code, userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId));
    if (booking === undefined || (input.userId !== undefined && booking.userId !== input.userId)) {
      throw validationFailed([{ path: ['bookingId'], message: 'Reserva não encontrada' }]);
    }
    bookingCode = booking.code;
  }
  const [row] = await tx
    .insert(manualReceipts)
    .values({
      date: input.date,
      revenueCategory: input.revenueCategory,
      method: input.method,
      amountCents: input.amountCents,
      description: input.description ?? null,
      userId: input.userId ?? null,
      bookingId: input.bookingId ?? null,
      createdBy: ctx.actorUserId,
    })
    .returning();
  if (row === undefined) throw new Error('manual receipt insert returned no row');
  await audit(tx, ctx, {
    action: 'manual_receipt.create',
    entityType: 'manual_receipt',
    entityId: row.id,
    after: auditable(row),
  });
  return receiptView(row, customerName, bookingCode);
}

/** Soft delete with the justification in the audit row (GES-21). */
export async function deleteReceipt(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  justification: string,
  now: Date,
): Promise<void> {
  const [before] = await tx
    .select()
    .from(manualReceipts)
    .where(and(eq(manualReceipts.id, id), isNull(manualReceipts.deletedAt)))
    .for('update');
  if (before === undefined) throw notFound('NOT_FOUND', 'Recebimento não encontrado');
  await tx.update(manualReceipts).set({ deletedAt: now }).where(eq(manualReceipts.id, id));
  await audit(tx, ctx, {
    action: 'manual_receipt.delete',
    entityType: 'manual_receipt',
    entityId: id,
    justification,
    before: auditable(before),
    after: { deletedAt: now.toISOString() },
  });
}
