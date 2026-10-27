import { addDays, localToUtc, utcToLocal } from '@bravo/core';
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { blocks, bookings, icsFeedTokens, rooms, users } from '../../db/schema';
import type { Env } from '../../env';
import type { RequestContext } from '../../lib/audit';
import { audit } from '../../lib/audit';
import { randomToken, sha256Hex } from '../../lib/crypto';
import { notFound, validationFailed } from '../../lib/errors';
import { icsCalendar, icsEvent, type IcsStatus } from '../../lib/ics';
import { appUrl } from '../../lib/request-meta';

// Calendar feeds (GES-42..GES-52): one active clinic feed, one per room and one personal feed per
// user. Only the SHA-256 of the token and its 6-char prefix are stored; the URL is shown once.

export type FeedScope = 'clinic' | 'room' | 'user';
type FeedRow = typeof icsFeedTokens.$inferSelect;

/** Requests one feed token may make per hour before 429 (GES-51). */
export const FEED_RATE_LIMIT = 60;
export const FEED_RATE_WINDOW_SECONDS = 3600;

/** Statuses a clinic/room feed shows (GES-44). Cancelled and expired bookings are absent. */
export const CLINIC_FEED_STATUSES = [
  'pre_reserved',
  'awaiting_payment',
  'held_for_renewal',
  'confirmed',
  'paid',
  'completed',
  'no_show',
] as const;

/** Statuses a personal feed shows (GES-46). */
export const PERSONAL_FEED_STATUSES = [
  'held_for_renewal',
  'confirmed',
  'paid',
  'completed',
] as const;

const TENTATIVE = new Set(['pre_reserved', 'held_for_renewal']);
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Rate-limit bucket key of a feed (per token id, never the raw token). */
export const feedRateLimitKey = (feedId: string) => `ics_feed:${feedId}`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** LOCATION of every event (gestao design "ICS serializer and feeds"). */
export const feedLocation = (roomName: string) =>
  `Bravô Clinic — ${roomName}, Praia Brava, Itajaí – SC`;

function feedUrl(env: Pick<Env, 'APP_BASE_URL'>, token: string): string {
  return appUrl(env, `/api/ics/${token}.ics`);
}

async function revokeRow(tx: Tx, ctx: RequestContext, row: FeedRow, now: Date): Promise<void> {
  await tx.update(icsFeedTokens).set({ revokedAt: now }).where(eq(icsFeedTokens.id, row.id));
  await audit(tx, ctx, {
    action: 'ics_feed.revoke',
    entityType: 'ics_feed',
    entityId: row.id,
    before: { scope: row.scope, roomId: row.roomId, userId: row.userId, prefix: row.tokenPrefix },
  });
}

async function activeFeeds(
  tx: Db | Tx,
  target: { scope: FeedScope; roomId?: string | undefined; userId?: string | undefined },
): Promise<FeedRow[]> {
  const conditions = [eq(icsFeedTokens.scope, target.scope), isNull(icsFeedTokens.revokedAt)];
  if (target.scope === 'room') conditions.push(eq(icsFeedTokens.roomId, target.roomId ?? ''));
  if (target.scope === 'user') conditions.push(eq(icsFeedTokens.userId, target.userId ?? ''));
  return tx
    .select()
    .from(icsFeedTokens)
    .where(and(...conditions))
    .for('update');
}

/**
 * Issues a feed and revokes the previous active one of the same scope and room (or user), so a
 * regenerated link replaces the old one (GES-42, GES-45). The raw token appears only in the URL.
 */
export async function issueFeed(
  tx: Tx,
  ctx: RequestContext,
  target: { scope: FeedScope; roomId?: string | undefined; userId?: string | undefined },
  deps: { env: Pick<Env, 'APP_BASE_URL'>; now: Date },
): Promise<{ id: string; url: string; prefix: string }> {
  if (target.scope === 'room') {
    const [room] = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.id, target.roomId ?? ''));
    if (room === undefined) {
      throw validationFailed([{ path: ['roomId'], message: 'Sala não encontrada' }]);
    }
  }
  for (const previous of await activeFeeds(tx, target)) {
    await revokeRow(tx, ctx, previous, deps.now);
  }
  const token = randomToken();
  const prefix = token.slice(0, 6);
  const [row] = await tx
    .insert(icsFeedTokens)
    .values({
      scope: target.scope,
      roomId: target.scope === 'room' ? (target.roomId ?? null) : null,
      userId: target.scope === 'user' ? (target.userId ?? null) : null,
      tokenHash: sha256Hex(token),
      tokenPrefix: prefix,
      createdBy: ctx.actorUserId,
      createdAt: deps.now,
    })
    .returning();
  if (row === undefined) throw new Error('issueFeed: insert returned no row');
  await audit(tx, ctx, {
    action: 'ics_feed.issue',
    entityType: 'ics_feed',
    entityId: row.id,
    after: { scope: row.scope, roomId: row.roomId, userId: row.userId, prefix },
  });
  return { id: row.id, url: feedUrl(deps.env, token), prefix };
}

/** Revokes a clinic or room feed by id; 404 when it is unknown or already revoked (GES-43). */
export async function revokeFeed(tx: Tx, ctx: RequestContext, id: string, now: Date) {
  const [row] = await tx
    .select()
    .from(icsFeedTokens)
    .where(and(eq(icsFeedTokens.id, id), isNull(icsFeedTokens.revokedAt)))
    .for('update');
  if (row === undefined || row.scope === 'user') throw notFound();
  await revokeRow(tx, ctx, row, now);
}

/** Revokes the user's personal feed, if any (GES-45). */
export async function revokePersonalFeed(tx: Tx, ctx: RequestContext, userId: string, now: Date) {
  for (const row of await activeFeeds(tx, { scope: 'user', userId })) {
    await revokeRow(tx, ctx, row, now);
  }
}

/** `GET /admin/integrations/calendar`: active clinic/room feeds and the rooms a feed can cover. */
export async function listSharedFeeds(db: Db | Tx) {
  const rows = await db
    .select({
      id: icsFeedTokens.id,
      scope: icsFeedTokens.scope,
      roomId: icsFeedTokens.roomId,
      roomName: rooms.name,
      prefix: icsFeedTokens.tokenPrefix,
      createdAt: icsFeedTokens.createdAt,
    })
    .from(icsFeedTokens)
    .leftJoin(rooms, eq(rooms.id, icsFeedTokens.roomId))
    .where(and(inArray(icsFeedTokens.scope, ['clinic', 'room']), isNull(icsFeedTokens.revokedAt)))
    .orderBy(asc(icsFeedTokens.createdAt));
  const roomRows = await db
    .select({ id: rooms.id, name: rooms.name })
    .from(rooms)
    .where(eq(rooms.status, 'active'))
    .orderBy(asc(rooms.displayOrder), asc(rooms.name));
  return {
    feeds: rows.map((r) => ({
      id: r.id,
      scope: r.scope as 'clinic' | 'room',
      roomId: r.roomId,
      roomName: r.roomName,
      prefix: r.prefix,
      createdAt: r.createdAt.toISOString(),
    })),
    rooms: roomRows,
  };
}

/** `GET /app/calendar-feed`: whether the user has an active personal feed. */
export async function personalFeedStatus(db: Db | Tx, userId: string) {
  const [row] = await db
    .select({ prefix: icsFeedTokens.tokenPrefix, createdAt: icsFeedTokens.createdAt })
    .from(icsFeedTokens)
    .where(
      and(
        eq(icsFeedTokens.scope, 'user'),
        eq(icsFeedTokens.userId, userId),
        isNull(icsFeedTokens.revokedAt),
      ),
    );
  return row === undefined
    ? { active: false, prefix: null, createdAt: null }
    : { active: true, prefix: row.prefix, createdAt: row.createdAt.toISOString() };
}

/** The active feed of a raw token, or null for a malformed, unknown or revoked one (GES-52). */
export async function findFeedByToken(db: Db | Tx, token: string): Promise<FeedRow | null> {
  if (!TOKEN_FORMAT.test(token)) return null;
  const [row] = await db
    .select()
    .from(icsFeedTokens)
    .where(and(eq(icsFeedTokens.tokenHash, sha256Hex(token)), isNull(icsFeedTokens.revokedAt)));
  return row ?? null;
}

/**
 * The VCALENDAR of a feed at `now` (GES-44, GES-46..GES-49): bookings of the allowed statuses
 * (and, for clinic/room feeds, active blocks) starting within the window, in UTC, with no
 * cleanup buffer, amounts or other customers' data. Cancelled bookings are simply absent.
 */
export async function renderFeed(db: Db | Tx, feed: FeedRow, now: Date): Promise<string> {
  const today = utcToLocal(now).date;
  const personal = feed.scope === 'user';
  const windowStart = localToUtc(addDays(today, personal ? -30 : -90), 0);
  const windowEnd = localToUtc(addDays(today, 181), 0);

  const bookingConditions = [
    gte(bookings.startsAt, windowStart),
    lt(bookings.startsAt, windowEnd),
    inArray(bookings.status, personal ? [...PERSONAL_FEED_STATUSES] : [...CLINIC_FEED_STATUSES]),
  ];
  if (personal) bookingConditions.push(eq(bookings.userId, feed.userId ?? ''));
  if (feed.scope === 'room') bookingConditions.push(eq(bookings.roomId, feed.roomId ?? ''));

  const bookingRows = await db
    .select({
      icsUid: bookings.icsUid,
      icsSequence: bookings.icsSequence,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      status: bookings.status,
      roomName: rooms.name,
      customerName: users.name,
    })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(and(...bookingConditions))
    .orderBy(asc(bookings.startsAt));

  const events: string[][] = bookingRows.map((b) =>
    icsEvent({
      uid: b.icsUid,
      sequence: b.icsSequence,
      dtstamp: now,
      start: b.startsAt,
      end: b.endsAt,
      summary: personal
        ? `Bravô Clinic · ${b.roomName}`
        : `${firstName(b.customerName)} · ${b.roomName}`,
      location: feedLocation(b.roomName),
      status: (TENTATIVE.has(b.status) ? 'TENTATIVE' : 'CONFIRMED') satisfies IcsStatus,
    }),
  );

  let roomName: string | null = null;
  if (!personal) {
    const blockConditions = [
      isNull(blocks.cancelledAt),
      gte(blocks.startsAt, windowStart),
      lt(blocks.startsAt, windowEnd),
    ];
    if (feed.scope === 'room') blockConditions.push(eq(blocks.roomId, feed.roomId ?? ''));
    const blockRows = await db
      .select({
        id: blocks.id,
        tag: blocks.tag,
        startsAt: blocks.startsAt,
        endsAt: blocks.endsAt,
        roomName: rooms.name,
      })
      .from(blocks)
      .innerJoin(rooms, eq(rooms.id, blocks.roomId))
      .where(and(...blockConditions))
      .orderBy(asc(blocks.startsAt));
    for (const block of blockRows) {
      events.push(
        icsEvent({
          uid: `block-${block.id}@bravo-clinic`,
          sequence: 0,
          dtstamp: now,
          start: block.startsAt,
          end: block.endsAt,
          summary: `${block.tag} · ${block.roomName}`,
          location: feedLocation(block.roomName),
        }),
      );
    }
    if (feed.scope === 'room') {
      const [room] = await db
        .select({ name: rooms.name })
        .from(rooms)
        .where(eq(rooms.id, feed.roomId ?? ''));
      roomName = room?.name ?? null;
    }
  }

  const name = personal
    ? 'Bravô Clinic — Minhas reservas'
    : roomName !== null
      ? `Bravô Clinic — ${roomName}`
      : 'Bravô Clinic — Agenda';
  return icsCalendar(events, { method: 'PUBLISH', name });
}

/** Records the fetch time of a feed (diagnostics only). */
export async function touchFeed(db: Db | Tx, feedId: string, now: Date): Promise<void> {
  await db.update(icsFeedTokens).set({ lastAccessedAt: now }).where(eq(icsFeedTokens.id, feedId));
}
