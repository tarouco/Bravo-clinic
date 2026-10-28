import {
  utcToLocal,
  type BookingStatus,
  type CustomerProfileInput,
  type LocalDate,
  type QuoteStatus,
} from '@bravo/core';
import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { bookings, consents, extraServices, quoteRequests, rooms, users } from '../../db/schema';
import { audit, type RequestContext } from '../../lib/audit';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { notFound } from '../../lib/errors';
import { maskDocument } from '../admin/customers.service';
import {
  getCustomerBalances,
  getCustomerSubscriptions,
  listCouponUsesByUser,
} from '../subscriptions/admin-queries.service';

// Clientes (GES-99..GES-102): the staff view of a tenant. Search and reads are open to reception;
// the profile edit is admin only (the route guards it).

const SEARCH_PAGE = 50;
const BOOKINGS_PAGE = 20;

type UserRow = typeof users.$inferSelect;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const docMaskedOf = (u: UserRow) =>
  u.docType === null || u.docNumber === null ? null : maskDocument(u.docType, u.docNumber);

const summaryView = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  docMasked: docMaskedOf(u),
});

const profileView = (u: UserRow) => ({
  ...summaryView(u),
  docType: u.docType as 'cpf' | 'cnpj' | null,
  profession: u.profession,
  professionalRegistry: u.professionalRegistry,
  notes: u.notes,
  createdAt: u.createdAt.toISOString(),
});
export type CustomerProfileView = ReturnType<typeof profileView>;

const localDateOf = (instant: Date | string): LocalDate =>
  utcToLocal(typeof instant === 'string' ? new Date(instant) : instant).date;

/**
 * `GET /admin/customers?q&cursor` (GES-99): tenants (never staff or deleted users) matching the
 * name or e-mail (case-insensitive substring), the document digits or the phone digits; newest
 * first, 50 per page. An empty `q` lists the first page of every tenant.
 */
export async function searchCustomerProfiles(
  db: Db | Tx,
  filters: { q?: string | undefined; cursor?: string | undefined },
) {
  const term = (filters.q ?? '').trim();
  const digits = term.replace(/\D/g, '');
  const pattern = `%${escapeLike(term)}%`;
  const after = filters.cursor === undefined ? undefined : decodeCursor(filters.cursor);
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.role, 'tenant'),
        ne(users.status, 'deleted'),
        term === ''
          ? undefined
          : or(
              sql`${users.name} ilike ${pattern}`,
              sql`${users.email} ilike ${pattern}`,
              digits.length >= 2 ? sql`${users.docNumber} like ${`%${digits}%`}` : undefined,
              digits.length >= 2
                ? sql`regexp_replace(coalesce(${users.phone}, ''), '\\D', '', 'g') like ${`%${digits}%`}`
                : undefined,
            ),
        after === undefined
          ? undefined
          : sql`(${users.createdAt}, ${users.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(SEARCH_PAGE + 1);
  const page = rows.slice(0, SEARCH_PAGE);
  const last = page.at(-1);
  return {
    items: page.map(summaryView),
    nextCursor:
      rows.length > SEARCH_PAGE && last !== undefined
        ? encodeCursor({ at: last.createdAt, id: last.id })
        : null,
  };
}

async function findCustomer(db: Db | Tx, id: string): Promise<UserRow> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, 'tenant')));
  if (user === undefined) throw notFound('NOT_FOUND', 'Cliente não encontrado');
  return user;
}

/** One page of a customer's bookings, newest start first (GES-100). */
export async function listCustomerBookings(
  db: Db | Tx,
  userId: string,
  cursor: string | undefined,
) {
  await findCustomer(db, userId);
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  const rows = await db
    .select({ booking: bookings, roomName: rooms.name })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .where(
      and(
        eq(bookings.userId, userId),
        after === undefined
          ? undefined
          : sql`(${bookings.startsAt}, ${bookings.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(bookings.startsAt), desc(bookings.id))
    .limit(BOOKINGS_PAGE + 1);
  const page = rows.slice(0, BOOKINGS_PAGE);
  const last = page.at(-1);
  return {
    items: page.map(({ booking: b, roomName }) => ({
      id: b.id,
      code: b.code,
      roomName,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status as BookingStatus,
      totalCents: b.totalCents,
    })),
    nextCursor:
      rows.length > BOOKINGS_PAGE && last !== undefined
        ? encodeCursor({ at: last.booking.startsAt, id: last.booking.id })
        : null,
  };
}

/**
 * `GET /admin/customers/:id` (GES-100): profile, first page of bookings, subscriptions with base
 * date, next charge and minute balance, open extra-minute lots, available credits, coupon uses,
 * consents and quote requests (receita R12 reads for the revenue sections).
 */
export async function getCustomerDetail(db: Db | Tx, id: string, now: Date) {
  const user = await findCustomer(db, id);
  const [bookingPage, subscriptionViews, balances, couponUses, consentRows, quotes] =
    await Promise.all([
      listCustomerBookings(db, id, undefined),
      getCustomerSubscriptions(db, id, now),
      getCustomerBalances(db, id, now),
      listCouponUsesByUser(db, id),
      db
        .select()
        .from(consents)
        .where(eq(consents.userId, id))
        .orderBy(desc(consents.acceptedAt), desc(consents.id)),
      db
        .select({
          id: quoteRequests.id,
          serviceName: extraServices.name,
          status: quoteRequests.status,
          createdAt: quoteRequests.createdAt,
        })
        .from(quoteRequests)
        .innerJoin(extraServices, eq(extraServices.id, quoteRequests.serviceId))
        .where(eq(quoteRequests.userId, id))
        .orderBy(desc(quoteRequests.createdAt), desc(quoteRequests.id)),
    ]);
  return {
    profile: profileView(user),
    bookings: bookingPage,
    subscriptions: subscriptionViews.map((s) => ({
      id: s.id,
      categoryName: s.category.name,
      roomName: s.room?.name ?? null,
      status: s.status,
      baseOn: s.baseOn,
      nextChargeOn: s.nextCharge?.on ?? null,
      balanceMinutes: s.balance?.packageMinutes ?? 0,
    })),
    extraLots: balances.extraLots
      .filter((lot) => lot.minutesRemaining > 0)
      .map((lot) => ({
        id: lot.id,
        source: lot.source,
        remainingMinutes: lot.minutesRemaining,
        expiresOn: localDateOf(lot.expiresAt),
      })),
    credits: balances.creditLots
      .filter((lot) => lot.remainingCents > 0)
      .map((lot) => ({
        id: lot.id,
        source: lot.source,
        remainingCents: lot.remainingCents,
        expiresOn: localDateOf(lot.expiresAt),
      })),
    couponUses: couponUses.map((use) => ({
      id: use.id,
      code: use.couponCode,
      status: use.status,
      discountCents: use.discountCents,
      usedAt: use.at,
    })),
    consents: consentRows.map((c) => ({
      id: c.id,
      kind: c.kind,
      version: c.version,
      acceptedAt: c.acceptedAt.toISOString(),
    })),
    quoteRequests: quotes.map((q) => ({
      id: q.id,
      serviceName: q.serviceName,
      status: q.status as QuoteStatus,
      createdAt: q.createdAt.toISOString(),
    })),
  };
}

/** Staff notes, up to 4000 chars, with audit `customer.notes` (GES-101). */
export async function saveCustomerNotes(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  notes: string,
  now: Date,
): Promise<{ notes: string }> {
  const before = await findCustomer(tx, id);
  await tx.update(users).set({ notes, updatedAt: now }).where(eq(users.id, id));
  await audit(tx, ctx, {
    action: 'customer.notes',
    entityType: 'user',
    entityId: id,
    before: { notes: before.notes },
    after: { notes },
  });
  return { notes };
}

const blankToNull = (value: string): string | null => (value === '' ? null : value);

const auditableProfile = (u: UserRow) => ({
  name: u.name,
  phone: u.phone,
  profession: u.profession,
  professionalRegistry: u.professionalRegistry,
});

/** Admin edit of name, phone, profession and registry with audit `customer.update` (GES-102). */
export async function updateCustomerProfile(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: CustomerProfileInput,
  now: Date,
): Promise<CustomerProfileView> {
  const before = await findCustomer(tx, id);
  const changes: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.phone !== undefined) changes.phone = input.phone;
  if (input.profession !== undefined) changes.profession = blankToNull(input.profession);
  if (input.professionalRegistry !== undefined) {
    changes.professionalRegistry = blankToNull(input.professionalRegistry);
  }
  const [row] = await tx
    .update(users)
    .set({ ...changes, updatedAt: now })
    .where(eq(users.id, id))
    .returning();
  if (row === undefined) throw notFound('NOT_FOUND', 'Cliente não encontrado');
  await audit(tx, ctx, {
    action: 'customer.update',
    entityType: 'user',
    entityId: id,
    before: auditableProfile(before),
    after: auditableProfile(row),
  });
  return profileView(row);
}
