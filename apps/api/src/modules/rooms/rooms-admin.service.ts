import {
  toPhotoUrl,
  type RoomInput,
  type RoomPhotoInput,
  type RoomPhotoUpdateInput,
} from '@bravo/core';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { withTransaction, type Db, type Tx } from '../../db/client';
import { bookings, roomPhotos, rooms, subscriptions } from '../../db/schema';
import type { RoomMediaPort } from '../../extensions/registry';
import { audit, type RequestContext } from '../../lib/audit';
import {
  AppError,
  conflict,
  notFound,
  storageUnavailable,
  validationFailed,
} from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { Storage } from '../../lib/storage';

// Salas admin (GES-103..GES-108): room CRUD with the inactivation guard and the photo gallery.
// Photos are WebP variants written by the browser to the public bucket `room-photos` (AD-026):
// `<storage_key>-large.webp` and `<storage_key>-small.webp`, served same-origin under `/media/*`.

const BUCKET = 'room-photos';
export const MAX_ROOM_PHOTOS = 12;
/** Objects never change once written: a new photo gets a new upload id (GES-108). */
export const PHOTO_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export type PhotoVariant = 'large' | 'small';
const VARIANTS: readonly PhotoVariant[] = ['large', 'small'];

/** Booking statuses that still hold the room (the non-terminal ones). */
const OPEN_BOOKINGS = ['awaiting_payment', 'pre_reserved', 'held_for_renewal', 'confirmed', 'paid'];

type RoomRow = typeof rooms.$inferSelect;
type PhotoRow = typeof roomPhotos.$inferSelect;

/** Public photo URLs (nucleo R13): the `large` variant; the web derives `small`. */
export const roomMediaPort: RoomMediaPort = {
  photoUrl: (storageKey) => toPhotoUrl(storageKey, 'large'),
};

export const photoStorageKey = (roomId: string, uploadId: string) => `rooms/${roomId}/${uploadId}`;
export const photoObjectKey = (storageKey: string, variant: PhotoVariant) =>
  `${storageKey}-${variant}.webp`;

const photoView = (p: PhotoRow) => ({
  id: p.id,
  storageKey: p.storageKey,
  alt: p.alt,
  isCover: p.isCover,
  displayOrder: p.displayOrder,
  width: p.width ?? 1,
  height: p.height ?? 1,
});
export type RoomPhotoView = ReturnType<typeof photoView>;

const roomView = (r: RoomRow, photos: PhotoRow[]) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  idealFor: r.idealFor,
  equipment: r.equipment,
  displayOrder: r.displayOrder,
  status: r.status as RoomInput['status'],
  photos: photos.map(photoView),
});
export type AdminRoomView = ReturnType<typeof roomView>;

const auditableRoom = (r: RoomRow) => ({
  name: r.name,
  slug: r.slug,
  description: r.description,
  idealFor: r.idealFor,
  equipment: r.equipment,
  displayOrder: r.displayOrder,
  status: r.status,
});

async function photosOf(db: Db | Tx, roomIds: string[]): Promise<PhotoRow[]> {
  if (roomIds.length === 0) return [];
  return db
    .select()
    .from(roomPhotos)
    .where(inArray(roomPhotos.roomId, roomIds))
    .orderBy(asc(roomPhotos.displayOrder), asc(roomPhotos.createdAt));
}

async function roomWithPhotos(db: Db | Tx, room: RoomRow): Promise<AdminRoomView> {
  return roomView(room, await photosOf(db, [room.id]));
}

/** `GET /admin/rooms`: every room, inactive ones included, with its photos in display order. */
export async function listAdminRooms(db: Db | Tx): Promise<{ items: AdminRoomView[] }> {
  const rows = await db.select().from(rooms).orderBy(asc(rooms.displayOrder), asc(rooms.name));
  const photos = await photosOf(
    db,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) =>
      roomView(
        r,
        photos.filter((p) => p.roomId === r.id),
      ),
    ),
  };
}

async function lockRoom(tx: Tx, id: string): Promise<RoomRow> {
  const [room] = await tx.select().from(rooms).where(eq(rooms.id, id)).for('update');
  if (room === undefined) throw notFound('NOT_FOUND', 'Sala não encontrada');
  return room;
}

async function assertSlugFree(tx: Tx, slug: string, exceptId?: string): Promise<void> {
  const [taken] = await tx
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(eq(rooms.slug, slug), exceptId === undefined ? undefined : ne(rooms.id, exceptId)));
  if (taken !== undefined) {
    throw new AppError(409, 'CONFLICT', 'Já existe uma sala com este endereço', [
      { path: 'slug', message: 'Já existe uma sala com este endereço' },
    ]);
  }
}

/** Creates a room with audit `room.create` (GES-103); the slug must be unused (409). */
export async function createRoom(
  tx: Tx,
  ctx: RequestContext,
  input: RoomInput,
): Promise<AdminRoomView> {
  await assertSlugFree(tx, input.slug);
  const [row] = await tx.insert(rooms).values(input).returning();
  if (row === undefined) throw new Error('room insert returned no row');
  await audit(tx, ctx, {
    action: 'room.create',
    entityType: 'room',
    entityId: row.id,
    after: auditableRoom(row),
  });
  return roomView(row, []);
}

/**
 * Future non-terminal bookings and active/suspended fixed-schedule subscriptions on a room: what
 * must be reallocated before it can be inactivated (GES-104).
 */
async function futureCommitments(tx: Tx, roomId: string, now: Date) {
  const bookingRows = await tx
    .select({ code: bookings.code })
    .from(bookings)
    .where(
      and(
        eq(bookings.roomId, roomId),
        inArray(bookings.status, OPEN_BOOKINGS),
        gt(bookings.endsAt, now),
      ),
    )
    .orderBy(asc(bookings.startsAt));
  const subscriptionRows = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.roomId, roomId),
        eq(subscriptions.type, 'fixed_schedule'),
        inArray(subscriptions.status, ['active', 'suspended']),
      ),
    )
    .orderBy(asc(subscriptions.createdAt));
  return { bookings: bookingRows, subscriptions: subscriptionRows };
}

/**
 * Replaces a room's fields with audit `room.update` (GES-103). Inactivating a room that still has
 * future bookings or fixed-schedule subscriptions is 409 `ROOM_HAS_FUTURE_COMMITMENTS` (GES-104).
 */
export async function updateRoom(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: RoomInput,
  now: Date,
): Promise<AdminRoomView> {
  const before = await lockRoom(tx, id);
  if (input.slug !== before.slug) await assertSlugFree(tx, input.slug, id);
  if (input.status === 'inactive' && before.status === 'active') {
    const commitments = await futureCommitments(tx, id, now);
    if (commitments.bookings.length > 0 || commitments.subscriptions.length > 0) {
      throw new AppError(
        409,
        'ROOM_HAS_FUTURE_COMMITMENTS',
        'A sala tem reservas futuras ou horários fixos. Realoque-os antes de inativar.',
        commitments,
      );
    }
  }
  const [row] = await tx
    .update(rooms)
    .set({ ...input, updatedAt: now })
    .where(eq(rooms.id, id))
    .returning();
  if (row === undefined) throw new Error('room update returned no row');
  await audit(tx, ctx, {
    action: 'room.update',
    entityType: 'room',
    entityId: id,
    before: auditableRoom(before),
    after: auditableRoom(row),
  });
  return roomWithPhotos(tx, row);
}

// ---- Photos ---------------------------------------------------------------------------------

export interface PhotoDeps {
  db: Db;
  storage?: Storage | undefined;
}

function storageOf(deps: PhotoDeps): Storage {
  if (deps.storage === undefined) throw storageUnavailable();
  return deps.storage;
}

const tooManyPhotos = () =>
  validationFailed([
    { path: [], message: `Uma sala tem no máximo ${String(MAX_ROOM_PHOTOS)} fotos` },
  ]);

async function photoCount(db: Db | Tx, roomId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roomPhotos)
    .where(eq(roomPhotos.roomId, roomId));
  return row?.count ?? 0;
}

/**
 * Stores one WebP variant of a future photo (GES-105, GES-106, GES-108) with an immutable cache
 * header. The caller validated the body (415/413); a room with 12 photos is 422.
 */
export async function uploadPhotoVariant(
  deps: PhotoDeps,
  input: { roomId: string; uploadId: string; variant: PhotoVariant; bytes: Uint8Array },
): Promise<void> {
  const [room] = await deps.db
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.id, input.roomId));
  if (room === undefined) throw notFound('NOT_FOUND', 'Sala não encontrada');
  if ((await photoCount(deps.db, input.roomId)) >= MAX_ROOM_PHOTOS) throw tooManyPhotos();
  await storageOf(deps).put(
    BUCKET,
    photoObjectKey(photoStorageKey(input.roomId, input.uploadId), input.variant),
    input.bytes,
    { contentType: 'image/webp', cacheControl: PHOTO_CACHE_CONTROL },
  );
}

/**
 * Registers an uploaded photo (GES-105): both variants must exist in the bucket (422 otherwise,
 * nothing inserted), the room must have fewer than 12 photos; audit `room_photo.create`.
 */
export async function registerPhoto(
  deps: PhotoDeps,
  ctx: RequestContext,
  roomId: string,
  input: RoomPhotoInput,
): Promise<RoomPhotoView> {
  const storage = storageOf(deps);
  const storageKey = photoStorageKey(roomId, input.uploadId);
  const heads = await Promise.all(
    VARIANTS.map((variant) => storage.head(BUCKET, photoObjectKey(storageKey, variant))),
  );
  return withTransaction(deps.db, async (tx) => {
    await lockRoom(tx, roomId);
    const missing = VARIANTS.filter((_, index) => heads[index] === null);
    if (missing.length > 0) {
      throw validationFailed([
        { path: ['uploadId'], message: `Envio incompleto: falta a versão ${missing.join(' e ')}` },
      ]);
    }
    const [duplicate] = await tx
      .select({ id: roomPhotos.id })
      .from(roomPhotos)
      .where(eq(roomPhotos.storageKey, storageKey));
    if (duplicate !== undefined) throw conflict('CONFLICT', 'Esta foto já foi cadastrada');
    if ((await photoCount(tx, roomId)) >= MAX_ROOM_PHOTOS) throw tooManyPhotos();
    const [last] = await tx
      .select({ max: sql<number | null>`max(${roomPhotos.displayOrder})` })
      .from(roomPhotos)
      .where(eq(roomPhotos.roomId, roomId));
    const [row] = await tx
      .insert(roomPhotos)
      .values({
        roomId,
        storageKey,
        alt: input.alt,
        width: input.width,
        height: input.height,
        displayOrder: last?.max === null || last?.max === undefined ? 0 : last.max + 1,
      })
      .returning();
    if (row === undefined) throw new Error('room photo insert returned no row');
    await audit(tx, ctx, {
      action: 'room_photo.create',
      entityType: 'room_photo',
      entityId: row.id,
      after: { roomId, storageKey, alt: row.alt, displayOrder: row.displayOrder },
    });
    return photoView(row);
  });
}

async function lockPhoto(tx: Tx, roomId: string, photoId: string): Promise<PhotoRow> {
  const [photo] = await tx
    .select()
    .from(roomPhotos)
    .where(and(eq(roomPhotos.id, photoId), eq(roomPhotos.roomId, roomId)))
    .for('update');
  if (photo === undefined) throw notFound('NOT_FOUND', 'Foto não encontrada');
  return photo;
}

/**
 * Alt text, cover and position of one photo with audit `room_photo.update` (GES-107). Setting the
 * cover clears it on the other photos first, so a room keeps at most one.
 */
export async function updatePhoto(
  tx: Tx,
  ctx: RequestContext,
  roomId: string,
  photoId: string,
  input: RoomPhotoUpdateInput,
): Promise<RoomPhotoView> {
  await lockRoom(tx, roomId);
  const before = await lockPhoto(tx, roomId, photoId);
  if (input.isCover === true) {
    await tx
      .update(roomPhotos)
      .set({ isCover: false })
      .where(and(eq(roomPhotos.roomId, roomId), ne(roomPhotos.id, photoId)));
  }
  const [row] = await tx
    .update(roomPhotos)
    .set({
      ...(input.alt !== undefined && { alt: input.alt }),
      ...(input.isCover !== undefined && { isCover: input.isCover }),
      ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
    })
    .where(eq(roomPhotos.id, photoId))
    .returning();
  if (row === undefined) throw new Error('room photo update returned no row');
  await audit(tx, ctx, {
    action: 'room_photo.update',
    entityType: 'room_photo',
    entityId: photoId,
    before: { alt: before.alt, isCover: before.isCover, displayOrder: before.displayOrder },
    after: { alt: row.alt, isCover: row.isCover, displayOrder: row.displayOrder },
  });
  return photoView(row);
}

/** Sets the gallery order from the full list of the room's photo ids (GES-107). */
export async function reorderPhotos(
  tx: Tx,
  ctx: RequestContext,
  roomId: string,
  ids: string[],
): Promise<void> {
  await lockRoom(tx, roomId);
  const current = await photosOf(tx, [roomId]);
  const known = new Set(current.map((p) => p.id));
  if (
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => known.has(id))
  ) {
    throw validationFailed([
      { path: ['ids'], message: 'Informe todas as fotos da sala, uma vez cada' },
    ]);
  }
  for (const [index, id] of ids.entries()) {
    await tx.update(roomPhotos).set({ displayOrder: index }).where(eq(roomPhotos.id, id));
  }
  await audit(tx, ctx, {
    action: 'room_photo.reorder',
    entityType: 'room',
    entityId: roomId,
    before: { ids: current.map((p) => p.id) },
    after: { ids },
  });
}

/**
 * Deletes a photo with audit `room_photo.delete` (GES-107); both objects are removed after the
 * commit, and a failed object delete is only logged.
 */
export async function deletePhoto(
  deps: PhotoDeps,
  ctx: RequestContext,
  roomId: string,
  photoId: string,
): Promise<void> {
  const storage = storageOf(deps);
  const removed = await withTransaction(deps.db, async (tx) => {
    await lockRoom(tx, roomId);
    const photo = await lockPhoto(tx, roomId, photoId);
    await tx.delete(roomPhotos).where(eq(roomPhotos.id, photoId));
    await audit(tx, ctx, {
      action: 'room_photo.delete',
      entityType: 'room_photo',
      entityId: photoId,
      before: { roomId, storageKey: photo.storageKey, alt: photo.alt, isCover: photo.isCover },
    });
    return photo;
  });
  for (const variant of VARIANTS) {
    try {
      await storage.delete(BUCKET, photoObjectKey(removed.storageKey, variant));
    } catch (error) {
      logger.error('room photo cleanup failed', {
        requestId: ctx.requestId,
        storageKey: removed.storageKey,
        variant,
        error: { name: (error as Error).name, message: (error as Error).message },
      });
    }
  }
}
