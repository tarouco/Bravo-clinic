import type { LocalDate, QuoteRequestInput, QuoteStatus, QuoteStatusUpdate } from '@bravo/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookings, extraServices, quoteRequests } from '../../db/schema';
import { quoteReceivedTemplate } from '../../emails/templates/gestao';
import { audit, type RequestContext } from '../../lib/audit';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { AppError, notFound, validationFailed } from '../../lib/errors';
import { withNotifications, type NotificationDeps } from '../notifications/notifications.service';

// Quote request funnel (GES-90..GES-97): public requests, the tenant's own list, the admin funnel
// with guarded status moves and staff notes.

const PAGE_SIZE = 50;

type QuoteRow = typeof quoteRequests.$inferSelect;
interface Joined {
  request: QuoteRow;
  serviceName: string;
  bookingCode: string | null;
}

/** Admin funnel row (web `quoteRequestSchema`). */
const adminView = ({ request: r, serviceName, bookingCode }: Joined) => ({
  id: r.id,
  status: r.status as QuoteStatus,
  serviceId: r.serviceId,
  serviceName,
  name: r.name,
  phone: r.phone,
  email: r.email,
  description: r.description,
  desiredOn: r.desiredOn as LocalDate | null,
  bookingCode,
  staffNotes: r.staffNotes,
  createdAt: r.createdAt.toISOString(),
});
export type AdminQuoteRequestView = ReturnType<typeof adminView>;

/** Tenant row (web `ownQuoteRequestSchema`): no contact data or staff notes. */
const ownView = ({ request: r, serviceName, bookingCode }: Joined) => ({
  id: r.id,
  status: r.status as QuoteStatus,
  serviceName,
  description: r.description,
  desiredOn: r.desiredOn as LocalDate | null,
  bookingCode,
  createdAt: r.createdAt.toISOString(),
});

function selectJoined(db: Db | Tx) {
  return db
    .select({ request: quoteRequests, serviceName: extraServices.name, bookingCode: bookings.code })
    .from(quoteRequests)
    .innerJoin(extraServices, eq(extraServices.id, quoteRequests.serviceId))
    .leftJoin(bookings, eq(bookings.id, quoteRequests.bookingId));
}

async function page(
  db: Db | Tx,
  filters: { userId?: string; status?: QuoteStatus | undefined; cursor?: string | undefined },
): Promise<{ rows: Joined[]; nextCursor: string | null }> {
  const after = filters.cursor === undefined ? undefined : decodeCursor(filters.cursor);
  const rows = await selectJoined(db)
    .where(
      and(
        filters.userId === undefined ? undefined : eq(quoteRequests.userId, filters.userId),
        filters.status === undefined ? undefined : eq(quoteRequests.status, filters.status),
        after === undefined
          ? undefined
          : sql`(${quoteRequests.createdAt}, ${quoteRequests.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(quoteRequests.createdAt), desc(quoteRequests.id))
    .limit(PAGE_SIZE + 1);
  const shown = rows.slice(0, PAGE_SIZE);
  const last = shown.at(-1);
  return {
    rows: shown,
    nextCursor:
      rows.length > PAGE_SIZE && last !== undefined
        ? encodeCursor({ at: last.request.createdAt, id: last.request.id })
        : null,
  };
}

/** `GET /admin/quote-requests` (GES-96): newest first, optionally one status. */
export async function listQuoteRequests(
  db: Db | Tx,
  filters: { status?: QuoteStatus | undefined; cursor?: string | undefined },
) {
  const { rows, nextCursor } = await page(db, filters);
  return { items: rows.map(adminView), nextCursor };
}

/** `GET /app/quote-requests` (GES-97): only the session user's requests. */
export async function listOwnQuoteRequests(
  db: Db | Tx,
  userId: string,
  cursor: string | undefined,
) {
  const { rows, nextCursor } = await page(db, { userId, cursor });
  return { items: rows.map(ownView), nextCursor };
}

/**
 * Stores a request in status `new` (GES-90, GES-91) and, in the same transaction, emits
 * `staff.new_quote_request` and, when an e-mail was given, `quote.received` (GES-94). The service
 * must be active; a booking must belong to the session user.
 */
export async function createQuoteRequest(
  deps: NotificationDeps,
  ctx: RequestContext,
  input: Omit<QuoteRequestInput, 'website'>,
  sessionUserId: string | null,
) {
  return withNotifications(deps, ctx, async (tx, notify) => {
    const [service] = await tx
      .select()
      .from(extraServices)
      .where(and(eq(extraServices.id, input.serviceId), eq(extraServices.status, 'active')));
    if (service === undefined) {
      throw validationFailed([{ path: ['serviceId'], message: 'Serviço indisponível' }]);
    }
    let bookingCode: string | null = null;
    if (input.bookingId !== undefined) {
      const [booking] =
        sessionUserId === null
          ? []
          : await tx
              .select({ code: bookings.code })
              .from(bookings)
              .where(and(eq(bookings.id, input.bookingId), eq(bookings.userId, sessionUserId)));
      if (booking === undefined) {
        throw validationFailed([{ path: ['bookingId'], message: 'Reserva não encontrada' }]);
      }
      bookingCode = booking.code;
    }
    const [row] = await tx
      .insert(quoteRequests)
      .values({
        serviceId: service.id,
        userId: sessionUserId,
        bookingId: input.bookingId ?? null,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone,
        description: input.description,
        desiredOn: input.desiredOn ?? null,
        source: sessionUserId === null ? 'web' : 'app',
      })
      .returning();
    if (row === undefined) throw new Error('quote request insert returned no row');

    await notify({
      name: 'staff.new_quote_request',
      entityId: row.id,
      data: {
        requesterName: row.name,
        serviceName: service.name,
        phone: row.phone,
        desiredOn: row.desiredOn,
      },
    });
    if (row.email !== null) {
      await notify({
        name: 'quote.received',
        entityId: row.id,
        to: row.email,
        data: { serviceName: service.name },
        email: {
          ...quoteReceivedTemplate({ name: row.name, serviceName: service.name }, deps.env),
          dedupeKey: `quote_received:${row.id}`,
        },
      });
    }
    return ownView({ request: row, serviceName: service.name, bookingCode });
  });
}

/** Allowed moves (GES-95): the funnel forward, and any open request to `lost`. */
const NEXT: Record<QuoteStatus, readonly QuoteStatus[]> = {
  new: ['contacted', 'lost'],
  contacted: ['quote_sent', 'lost'],
  quote_sent: ['won', 'lost'],
  won: [],
  lost: [],
};

const invalidTransition = () =>
  new AppError(409, 'INVALID_TRANSITION', 'O pedido mudou de status. Atualize a página.');

/**
 * `PATCH /admin/quote-requests/:id` (GES-95, GES-96): a status move guarded by
 * `WHERE status = <from>` (a concurrent move loses with 409) with audit `quote_request.status`,
 * and/or the staff notes with audit `quote_request.notes`.
 */
export async function updateQuoteRequest(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: QuoteStatusUpdate,
  now: Date,
): Promise<AdminQuoteRequestView> {
  const [current] = await tx.select().from(quoteRequests).where(eq(quoteRequests.id, id));
  if (current === undefined) throw notFound('NOT_FOUND', 'Pedido não encontrado');
  const from = current.status as QuoteStatus;

  if (input.status !== undefined) {
    if (!NEXT[from].includes(input.status)) throw invalidTransition();
    const moved = await tx
      .update(quoteRequests)
      .set({ status: input.status, updatedAt: now })
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.status, from)))
      .returning({ id: quoteRequests.id });
    if (moved.length === 0) throw invalidTransition();
    await audit(tx, ctx, {
      action: 'quote_request.status',
      entityType: 'quote_request',
      entityId: id,
      before: { status: from },
      after: { status: input.status },
    });
  }
  if (input.staffNotes !== undefined) {
    await tx
      .update(quoteRequests)
      .set({ staffNotes: input.staffNotes, updatedAt: now })
      .where(eq(quoteRequests.id, id));
    await audit(tx, ctx, {
      action: 'quote_request.notes',
      entityType: 'quote_request',
      entityId: id,
      before: { staffNotes: current.staffNotes },
      after: { staffNotes: input.staffNotes },
    });
  }
  const [joined] = await selectJoined(tx).where(eq(quoteRequests.id, id));
  if (joined === undefined) throw notFound('NOT_FOUND', 'Pedido não encontrado');
  return adminView(joined);
}
