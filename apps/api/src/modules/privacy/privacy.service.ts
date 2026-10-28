import { utcToLocal } from '@bravo/core';
import { and, asc, desc, eq, gt, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { revokeAllSessions } from '../../auth/session';
import { withTransaction, type Db, type Tx } from '../../db/client';
import {
  authTokens,
  bookings,
  charges,
  consents,
  creditLedger,
  creditLots,
  emailOutbox,
  extraMinutesLedger,
  extraServices,
  icsFeedTokens,
  packageLedger,
  pushSubscriptions,
  quoteRequests,
  refunds,
  rooms,
  savedCards,
  subscriptions,
  userTotp,
  users,
} from '../../db/schema';
import { accountDeletedTemplate } from '../../emails/templates/gestao';
import { audit, type RequestContext } from '../../lib/audit';
import { verifyPassword } from '../../lib/crypto';
import { AppError, notFound, tooManyRequests } from '../../lib/errors';
import { consumeRateLimit, rateLimitKey } from '../../middleware/rate-limit';
import {
  getCustomerSubscriptions,
  listCouponUsesByUser,
} from '../subscriptions/admin-queries.service';
import {
  withNotifications,
  type EmitEvent,
  type EmitResult,
  type NotificationDeps,
} from '../notifications/notifications.service';

// LGPD self-service (GES-121..GES-127, design "LGPD anonymization"): the data export, the consent
// list and the anonymization of an account. Accounts are never hard-deleted; fiscal and legal
// records (bookings, charges, refunds, ledgers, subscriptions, consents, audit) stay linked to the
// anonymized id.

const EXPORTS_PER_DAY = 3;
/** Booking statuses that still hold a slot (the non-terminal ones). */
const OPEN_BOOKINGS = ['awaiting_payment', 'pre_reserved', 'held_for_renewal', 'confirmed', 'paid'];

const iso = (d: Date | null) => d?.toISOString() ?? null;

async function findUser(db: Db | Tx, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user === undefined || user.status === 'deleted') throw notFound();
  return user;
}

/** `GET /app/me/consents` (GES-128): what the user accepted, newest first. */
export async function listConsents(db: Db | Tx, userId: string) {
  const rows = await db
    .select()
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(desc(consents.acceptedAt), desc(consents.id));
  return {
    items: rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      version: c.version,
      acceptedAt: c.acceptedAt.toISOString(),
    })),
  };
}

/** Only the origin of a push endpoint is exported (the path identifies the device). */
function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return '';
  }
}

/**
 * `GET /app/me/data-export` (GES-121..GES-123): everything the clinic keeps about the user as one
 * JSON document, with audit `user.data_export`; at most 3 per user per day (429). Explicit
 * projections keep out password hashes, TOTP secrets and recovery codes, token hashes, gateway
 * card ids and raw provider payloads.
 */
export async function exportUserData(
  deps: { db: Db },
  ctx: RequestContext,
  userId: string,
  now: Date,
): Promise<{ fileName: string; data: Record<string, unknown> }> {
  const limit = await consumeRateLimit(deps.db, rateLimitKey('data-export', userId), {
    limit: EXPORTS_PER_DAY,
    windowSeconds: 86_400,
    now,
  });
  if (!limit.allowed) throw tooManyRequests(limit.retryAfterSeconds);
  const db = deps.db;
  const user = await findUser(db, userId);

  const bookingRows = await db
    .select({ booking: bookings, roomName: rooms.name })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .where(eq(bookings.userId, userId))
    .orderBy(asc(bookings.startsAt));
  const chargeRows = await db
    .select()
    .from(charges)
    .where(eq(charges.userId, userId))
    .orderBy(asc(charges.createdAt));
  const chargeIds = chargeRows.map((c) => c.id);
  const refundRows =
    chargeIds.length === 0
      ? []
      : await db
          .select()
          .from(refunds)
          .where(inArray(refunds.chargeId, chargeIds))
          .orderBy(asc(refunds.createdAt));
  const quoteRows = await db
    .select({ request: quoteRequests, serviceName: extraServices.name })
    .from(quoteRequests)
    .innerJoin(extraServices, eq(extraServices.id, quoteRequests.serviceId))
    .where(eq(quoteRequests.userId, userId))
    .orderBy(asc(quoteRequests.createdAt));
  const pushRows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  const cardRows = await db.select().from(savedCards).where(eq(savedCards.userId, userId));
  const mailRows = await db
    .select({
      subject: emailOutbox.subject,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
    })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.toAddress, user.email), eq(emailOutbox.status, 'sent')))
    .orderBy(asc(emailOutbox.createdAt));
  const packageEntries = await db
    .select({
      at: packageLedger.createdAt,
      entryType: packageLedger.entryType,
      minutes: packageLedger.minutes,
      bookingId: packageLedger.bookingId,
    })
    .from(packageLedger)
    .where(eq(packageLedger.userId, userId))
    .orderBy(asc(packageLedger.createdAt));
  const extraEntries = await db
    .select({
      at: extraMinutesLedger.createdAt,
      entryType: extraMinutesLedger.entryType,
      minutes: extraMinutesLedger.minutes,
      bookingId: extraMinutesLedger.bookingId,
    })
    .from(extraMinutesLedger)
    .where(eq(extraMinutesLedger.userId, userId))
    .orderBy(asc(extraMinutesLedger.createdAt));
  const creditEntries = await db
    .select({
      at: creditLedger.createdAt,
      entryType: creditLedger.entryType,
      amountCents: creditLedger.amountCents,
      bookingId: creditLedger.bookingId,
    })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(asc(creditLedger.createdAt));
  const creditRows = await db
    .select()
    .from(creditLots)
    .where(eq(creditLots.userId, userId))
    .orderBy(asc(creditLots.createdAt));

  const data = {
    exportedAt: now.toISOString(),
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerifiedAt: iso(user.emailVerifiedAt),
      role: user.role,
      docType: user.docType,
      docNumber: user.docNumber,
      phone: user.phone,
      profession: user.profession,
      professionalRegistry: user.professionalRegistry,
      googleLinked: user.googleSub !== null,
      createdAt: user.createdAt.toISOString(),
    },
    consents: (await listConsents(db, userId)).items,
    bookings: bookingRows.map(({ booking: b, roomName }) => ({
      code: b.code,
      roomName,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      status: b.status,
      paymentMode: b.paymentMode,
      grossCents: b.grossCents,
      discountCents: b.discountCents,
      totalCents: b.totalCents,
      paidCents: b.paidCents,
      createdAt: b.createdAt.toISOString(),
    })),
    charges: chargeRows.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      method: c.method,
      amountCents: c.amountCents,
      status: c.status,
      refundedCents: c.refundedCents,
      approvedAt: iso(c.approvedAt),
      createdAt: c.createdAt.toISOString(),
    })),
    refunds: refundRows.map((r) => ({
      chargeId: r.chargeId,
      amountCents: r.amountCents,
      reason: r.reason,
      status: r.status,
      completedAt: iso(r.completedAt),
      createdAt: r.createdAt.toISOString(),
    })),
    subscriptions: await getCustomerSubscriptions(db, userId, now),
    ledgers: {
      packageMinutes: packageEntries.map((e) => ({ ...e, at: e.at.toISOString() })),
      extraMinutes: extraEntries.map((e) => ({ ...e, at: e.at.toISOString() })),
      credits: creditEntries.map((e) => ({ ...e, at: e.at.toISOString() })),
    },
    credits: creditRows.map((l) => ({
      source: l.source,
      amountCents: l.amountCents,
      remainingCents: l.remainingCents,
      expiresAt: l.expiresAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
    })),
    couponUses: (await listCouponUsesByUser(db, userId)).map((u) => ({
      code: u.couponCode,
      status: u.status,
      discountCents: u.discountCents,
      at: u.at,
      ...(u.bookingCode !== undefined && { bookingCode: u.bookingCode }),
    })),
    savedCards: cardRows.map((card) => ({
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      createdAt: card.createdAt.toISOString(),
      deletedAt: iso(card.deletedAt),
    })),
    quoteRequests: quoteRows.map(({ request: q, serviceName }) => ({
      serviceName,
      status: q.status,
      name: q.name,
      email: q.email,
      phone: q.phone,
      description: q.description,
      desiredOn: q.desiredOn,
      createdAt: q.createdAt.toISOString(),
    })),
    pushSubscriptions: pushRows.map((p) => ({
      endpointOrigin: endpointOrigin(p.endpoint),
      createdAt: p.createdAt.toISOString(),
    })),
    emails: mailRows.map((m) => ({
      subject: m.subject,
      sentAt: (m.sentAt ?? m.createdAt).toISOString(),
    })),
  };

  await withTransaction(db, (tx) =>
    audit(tx, ctx, { action: 'user.data_export', entityType: 'user', entityId: userId }),
  );
  return { fileName: `bravo-meus-dados-${utcToLocal(now).date}.json`, data };
}

/**
 * What blocks a deletion (GES-125): future non-terminal bookings, active or suspended
 * subscriptions and pending charges.
 */
async function deletionBlockers(tx: Tx, userId: string, now: Date) {
  const openBookings = await tx
    .select({ code: bookings.code })
    .from(bookings)
    .where(
      and(
        eq(bookings.userId, userId),
        inArray(bookings.status, OPEN_BOOKINGS),
        gt(bookings.endsAt, now),
      ),
    )
    .orderBy(asc(bookings.startsAt));
  const openSubscriptions = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ['active', 'suspended'])),
    )
    .orderBy(asc(subscriptions.createdAt));
  const pendingCharges = await tx
    .select({ id: charges.id })
    .from(charges)
    .where(
      and(
        eq(charges.userId, userId),
        eq(charges.status, 'pending'),
        or(isNull(charges.expiresAt), gt(charges.expiresAt, now)),
      ),
    )
    .orderBy(asc(charges.createdAt));
  return { bookings: openBookings, subscriptions: openSubscriptions, charges: pendingCharges };
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Senha ou confirmação incorreta');

/**
 * Anonymizes one account in the caller's transaction (design "LGPD anonymization"): blockers
 * first (409 `HAS_ACTIVE_COMMITMENTS`, nothing changed), then the personal columns, sessions,
 * TOTP, push subscriptions, auth tokens, feeds, saved cards, the user's quote requests and the
 * older outbox rows to the old address. The `privacy.account_deleted` confirmation is queued
 * first and left out of the rewrite.
 */
async function anonymize(
  tx: Tx,
  ctx: RequestContext,
  notify: (event: EmitEvent) => Promise<EmitResult>,
  deps: NotificationDeps,
  input: { userId: string; justification?: string; now: Date },
): Promise<void> {
  const { userId, now } = input;
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (user === undefined || user.status === 'deleted') throw notFound();
  const blockers = await deletionBlockers(tx, userId, now);
  if (blockers.bookings.length + blockers.subscriptions.length + blockers.charges.length > 0) {
    throw new AppError(
      409,
      'HAS_ACTIVE_COMMITMENTS',
      'Há reservas futuras, assinaturas ativas ou pagamentos pendentes. Resolva-os antes de excluir a conta.',
      blockers,
    );
  }

  const confirmation = await notify({
    name: 'privacy.account_deleted',
    entityId: userId,
    to: user.email,
    data: {},
    email: {
      ...accountDeletedTemplate({ name: user.name }, deps.env),
      dedupeKey: `account_deleted:${userId}`,
    },
  });

  const anonEmail = `deleted-${userId}@anon.invalid`;
  await tx
    .update(users)
    .set({
      status: 'deleted',
      name: 'Usuário removido',
      email: anonEmail,
      emailVerifiedAt: null,
      passwordHash: null,
      googleSub: null,
      docType: null,
      docNumber: null,
      phone: null,
      profession: null,
      professionalRegistry: null,
      notes: null,
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
  await revokeAllSessions(tx, userId, now);
  await tx.delete(userTotp).where(eq(userTotp.userId, userId));
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await tx.delete(authTokens).where(eq(authTokens.userId, userId));
  await tx
    .update(icsFeedTokens)
    .set({ revokedAt: now })
    .where(and(eq(icsFeedTokens.userId, userId), isNull(icsFeedTokens.revokedAt)));
  await tx
    .update(savedCards)
    .set({ deletedAt: now })
    .where(and(eq(savedCards.userId, userId), isNull(savedCards.deletedAt)));
  await tx
    .update(quoteRequests)
    .set({ name: 'Removido', email: null, phone: 'removido', updatedAt: now })
    .where(eq(quoteRequests.userId, userId));
  const keep = confirmation.outboxIds;
  await tx
    .update(emailOutbox)
    .set({ toAddress: anonEmail, html: '', textBody: '', attachments: sql`'[]'::jsonb` })
    .where(
      and(
        eq(emailOutbox.toAddress, user.email),
        keep.length === 0 ? undefined : notInArray(emailOutbox.id, keep),
      ),
    );
  await audit(tx, ctx, {
    action: 'user.anonymize',
    entityType: 'user',
    entityId: userId,
    ...(input.justification !== undefined && { justification: input.justification }),
    before: { status: user.status },
    after: { status: 'deleted' },
  });
}

/**
 * `POST /app/me/deletion` (GES-124..GES-126): the current password, or `EXCLUIR` for an account
 * without one (Google sign-in), confirms the deletion; a wrong value is 401 and changes nothing.
 */
export async function deleteOwnAccount(
  deps: NotificationDeps,
  ctx: RequestContext,
  userId: string,
  input: { password?: string | undefined; confirmText?: string | undefined },
): Promise<void> {
  const user = await findUser(deps.db, userId);
  const confirmed =
    user.passwordHash !== null
      ? input.password !== undefined && (await verifyPassword(input.password, user.passwordHash))
      : input.confirmText === 'EXCLUIR';
  if (!confirmed) throw invalidCredentials();
  const now = deps.now();
  await withNotifications(deps, ctx, (tx, notify) =>
    anonymize(tx, ctx, notify, deps, { userId, now }),
  );
}

/** `POST /admin/customers/:id/anonymize` (GES-127): same blockers and effects, justified. */
export async function anonymizeCustomer(
  deps: NotificationDeps,
  ctx: RequestContext,
  userId: string,
  justification: string,
): Promise<void> {
  const [target] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, 'tenant'), ne(users.status, 'deleted')));
  if (target === undefined) throw notFound('NOT_FOUND', 'Cliente não encontrado');
  const now = deps.now();
  await withNotifications(deps, ctx, (tx, notify) =>
    anonymize(tx, ctx, notify, deps, { userId, justification, now }),
  );
}
