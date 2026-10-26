import {
  categoryAverageHourlyCents,
  fromPriceCents,
  policySnapshot,
  renderPolicyText,
  type Catalog,
  type Clinic,
  type PoliciesPublic,
  type RoomDetail,
  type RoomSummary,
} from '@bravo/core';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { bookingCategories, roomPhotos, rooms } from '../../db/schema';
import type { Registry } from '../../extensions/registry';
import { notFound } from '../../lib/errors';
import {
  loadBusinessHours,
  loadHourlyCategories,
  getActiveRoomBySlug,
} from '../calendar/calendar.repo';
import { loadSettings } from '../settings/settings.repo';

type Media = Pick<Registry, 'roomMedia'>;
type RoomRow = typeof rooms.$inferSelect;
type PhotoRow = typeof roomPhotos.$inferSelect;

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'] as const;

function toPhoto(row: PhotoRow, registry: Media): RoomDetail['photos'][number] | null {
  const url = registry.roomMedia.photoUrl(row.storageKey);
  return url === null ? null : { url, alt: row.alt, width: row.width, height: row.height };
}

function summaryOf(
  room: RoomRow,
  photos: PhotoRow[],
  fromPrice: number | null,
  registry: Media,
): RoomSummary {
  const cover = photos.find((p) => p.isCover) ?? photos[0];
  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    description: room.description,
    idealFor: room.idealFor,
    equipment: room.equipment,
    cover: cover === undefined ? null : toPhoto(cover, registry),
    fromPriceCents: fromPrice,
  };
}

async function photosOf(db: Db, roomIds: string[]): Promise<Map<string, PhotoRow[]>> {
  const rows = await db
    .select()
    .from(roomPhotos)
    .orderBy(asc(roomPhotos.displayOrder), asc(roomPhotos.createdAt));
  const byRoom = new Map<string, PhotoRow[]>();
  for (const row of rows) {
    if (!roomIds.includes(row.roomId)) continue;
    byRoom.set(row.roomId, [...(byRoom.get(row.roomId) ?? []), row]);
  }
  return byRoom;
}

/** Active rooms by display order with "a partir de" from the public hourly categories (NUC-74). */
export async function listRooms(db: Db, registry: Media): Promise<{ items: RoomSummary[] }> {
  const [roomRows, hourly] = await Promise.all([
    db.select().from(rooms).where(eq(rooms.status, 'active')).orderBy(asc(rooms.displayOrder)),
    loadHourlyCategories(db),
  ]);
  const photos = await photosOf(
    db,
    roomRows.map((r) => r.id),
  );
  const from = fromPriceCents(hourly);
  return { items: roomRows.map((r) => summaryOf(r, photos.get(r.id) ?? [], from, registry)) };
}

/** One active room with all its photos; unknown or inactive rooms are 404 (NUC-75). */
export async function getRoomDetail(db: Db, slug: string, registry: Media): Promise<RoomDetail> {
  const room = await getActiveRoomBySlug(db, slug);
  if (room === null) throw notFound();
  const [hourly, photoMap] = await Promise.all([loadHourlyCategories(db), photosOf(db, [room.id])]);
  const photos = photoMap.get(room.id) ?? [];
  return {
    ...summaryOf(room, photos, fromPriceCents(hourly), registry),
    photos: photos.flatMap((p) => toPhoto(p, registry) ?? []),
  };
}

/** Active public hourly and block categories (NUC-76); inactive and admin-only ones are left out. */
export async function getCatalog(db: Db): Promise<Catalog> {
  const [rows, settings] = await Promise.all([
    db
      .select()
      .from(bookingCategories)
      .where(
        and(eq(bookingCategories.status, 'active'), eq(bookingCategories.visibility, 'public')),
      )
      .orderBy(asc(bookingCategories.displayOrder)),
    loadSettings(db),
  ]);
  const hourly: Catalog['hourly'] = [];
  const blocks: Catalog['blocks'] = [];
  for (const row of rows) {
    if (row.type === 'hourly') {
      hourly.push({
        id: row.id,
        name: row.name,
        weekdays: row.weekdays,
        appliesOnHolidays: row.appliesOnHolidays,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        weekdayRateCents: row.weekdayRateCents ?? 0,
        weekendRateCents: row.weekendRateCents ?? 0,
        minDurationMinutes: row.minDurationMinutes ?? 60,
        displayOrder: row.displayOrder,
        isReference: row.isReference,
      });
    } else if (row.type === 'block') {
      blocks.push({
        id: row.id,
        name: row.name,
        weekdays: row.weekdays,
        appliesOnHolidays: row.appliesOnHolidays,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        fixedPriceCents: row.fixedPriceCents ?? 0,
        averageHourlyCents: categoryAverageHourlyCents({
          type: 'block',
          id: row.id,
          name: row.name,
          weekdays: row.weekdays,
          appliesOnHolidays: row.appliesOnHolidays,
          startMinute: row.startMinute,
          endMinute: row.endMinute,
          fixedPriceCents: row.fixedPriceCents ?? 0,
        }),
      });
    }
  }
  return { hourly, blocks, pricesReviewed: settings['onboarding.prices_reviewed'] };
}

/** Contact data and the 8 business-hours rows for the Contato page (NUC-84). */
export async function getClinic(db: Db): Promise<Clinic> {
  const [hours, settings] = await Promise.all([loadBusinessHours(db), loadSettings(db)]);
  return {
    addressLine: settings['clinic.address_line'],
    whatsappE164: settings['clinic.whatsapp_e164'],
    contactEmail: settings['clinic.contact_email'],
    businessHours: DAY_ORDER.flatMap((dayType) => hours.find((h) => h.dayType === dayType) ?? []),
  };
}

/** Current policy version, values and the rendered text (NUC-85). */
export async function getPublicPolicies(db: Db): Promise<PoliciesPublic> {
  const snapshot = policySnapshot(await loadSettings(db));
  return {
    version: snapshot['policy.version'],
    values: snapshot,
    sections: renderPolicyText(snapshot),
  };
}
