import { randomUUID } from 'node:crypto';
import { localToUtc } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant, seededRoom } from '../../../test/booking-helpers';
import { createBooking as insertBooking } from '../../../test/factories';
import { createFixedCategory, createSubscription } from '../../../test/factories/revenue';
import { APP_ORIGIN, forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { auditLog, roomPhotos, rooms, subscriptions } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { memoryStorage } from '../../lib/storage';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-02T15:00:00.000Z');
let storage = memoryStorage();

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  storage = memoryStorage();
});

const buildApp = () =>
  createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv(), storage });
const call = (cookie: string | undefined, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, {
    ...(cookie !== undefined && { cookie }),
    ...(body !== undefined && { body }),
  });

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

/** A minimal RIFF/WEBP file of `size` bytes. */
function webp(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function upload(
  cookie: string,
  roomId: string,
  uploadId: string,
  variant: string,
  body: Uint8Array,
  contentType = 'image/webp',
) {
  return buildApp().request(`/admin/rooms/${roomId}/photo-uploads/${uploadId}/${variant}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, Origin: APP_ORIGIN, Cookie: cookie },
    body,
  });
}

/** Uploads both variants and registers the photo; returns the photo view. */
async function addPhoto(cookie: string, roomId: string, alt = 'Sala com maca e luz natural') {
  const uploadId = randomUUID();
  for (const variant of ['large', 'small']) {
    expect((await upload(cookie, roomId, uploadId, variant, webp())).status).toBe(204);
  }
  const res = await call(cookie, 'POST', `/admin/rooms/${roomId}/photos`, {
    uploadId,
    alt,
    width: 1600,
    height: 1067,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; storageKey: string; isCover: boolean; displayOrder: number };
}

const roomBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Sala Jardim',
  slug: 'sala-jardim',
  description: 'Sala com janela para o jardim.',
  idealFor: ['Psicologia', 'Nutrição'],
  equipment: ['Poltronas', 'Ar-condicionado'],
  displayOrder: 3,
  status: 'active',
  ...overrides,
});

describe('room create and edit (GES-103)', () => {
  it('creates a room (201) and edits it (200) with audit room.create / room.update', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const created = await call(admin.cookie, 'POST', '/admin/rooms', roomBody());
    const room = created.body as { id: string };
    const edited = await call(
      admin.cookie,
      'PATCH',
      `/admin/rooms/${room.id}`,
      roomBody({ name: 'Sala Jardim Norte', equipment: ['Poltronas'] }),
    );

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: room.id, ...roomBody(), photos: [] });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: 'Sala Jardim Norte', equipment: ['Poltronas'] });
    const [create] = await audits('room.create');
    expect(create).toMatchObject({
      entityType: 'room',
      entityId: room.id,
      after: { name: 'Sala Jardim', slug: 'sala-jardim' },
    });
    const [update] = await audits('room.update');
    expect(update).toMatchObject({
      before: { name: 'Sala Jardim', equipment: ['Poltronas', 'Ar-condicionado'] },
      after: { name: 'Sala Jardim Norte', equipment: ['Poltronas'] },
    });
  });

  it('answers 422 for invalid fields and 409 for a slug already in use', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const principal = await seededRoom(db);
    const created = (await call(admin.cookie, 'POST', '/admin/rooms', roomBody())).body as {
      id: string;
    };

    const invalid = await call(
      admin.cookie,
      'POST',
      '/admin/rooms',
      roomBody({ name: 'S', slug: 'Sala Jardim', idealFor: Array(9).fill('Psicologia') }),
    );
    const dupCreate = await call(
      admin.cookie,
      'POST',
      '/admin/rooms',
      roomBody({ slug: principal.slug }),
    );
    const dupEdit = await call(
      admin.cookie,
      'PATCH',
      `/admin/rooms/${created.id}`,
      roomBody({ slug: principal.slug }),
    );

    expect(invalid.status).toBe(422);
    expect(invalid.error?.details?.map((d) => d.path).sort()).toEqual(['idealFor', 'name', 'slug']);
    for (const res of [dupCreate, dupEdit]) {
      expect([res.status, res.error?.code, res.error?.details?.[0]?.path]).toEqual([
        409,
        'CONFLICT',
        'slug',
      ]);
    }
  });
});

describe('room inactivation guard (GES-104)', () => {
  it('answers 409 ROOM_HAS_FUTURE_COMMITMENTS with the booking codes and keeps the room active', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const { user } = await createTenant(db, { now: NOW });
    const future = await insertBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2027-03-09', 840),
      endsAt: localToUtc('2027-03-09', 960),
      status: 'confirmed',
    });
    // Past and cancelled bookings do not block.
    await insertBooking(db, {
      userId: user.id,
      roomId: room.id,
      startsAt: localToUtc('2027-02-09', 840),
      endsAt: localToUtc('2027-02-09', 960),
      status: 'completed',
    });

    const res = await call(
      admin.cookie,
      'PATCH',
      `/admin/rooms/${room.id}`,
      roomBody({ name: room.name, slug: room.slug, status: 'inactive' }),
    );

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('ROOM_HAS_FUTURE_COMMITMENTS');
    expect(res.error?.details).toEqual({ bookings: [{ code: future.code }], subscriptions: [] });
    const [row] = await db.select().from(rooms).where(eq(rooms.id, room.id));
    expect(row?.status).toBe('active');
    expect(await audits('room.update')).toHaveLength(0);
  });

  it('answers 409 with the subscription id of an active fixed schedule; 200 once nothing is left', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const { user } = await createTenant(db, { now: NOW });
    const category = await createFixedCategory(db);
    const { subscription } = await createSubscription(db, {
      userId: user.id,
      category,
      roomId: room.id,
      baseOn: '2027-03-01',
    });
    const inactivate = () =>
      call(
        admin.cookie,
        'PATCH',
        `/admin/rooms/${room.id}`,
        roomBody({ name: room.name, slug: room.slug, status: 'inactive' }),
      );

    const blocked = await inactivate();
    await db
      .update(subscriptions)
      .set({ status: 'ended' })
      .where(eq(subscriptions.id, subscription.id));
    const allowed = await inactivate();

    expect([blocked.status, blocked.error?.details]).toEqual([
      409,
      { bookings: [], subscriptions: [{ id: subscription.id }] },
    ]);
    expect([allowed.status, (allowed.body as { status: string }).status]).toEqual([
      200,
      'inactive',
    ]);
  });
});

describe('room photo uploads (GES-105, GES-106, GES-108)', () => {
  it('stores each WebP variant with an immutable cache header and registers the photo (201)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);

    const photo = await addPhoto(admin.cookie, room.id);

    const key = `rooms/${room.id}/${photo.storageKey.split('/')[2] ?? ''}`;
    expect(photo.storageKey).toBe(key);
    for (const variant of ['large', 'small']) {
      expect(storage.objects.get(`room-photos/${key}-${variant}.webp`)).toMatchObject({
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
    const [row] = await db.select().from(roomPhotos).where(eq(roomPhotos.id, photo.id));
    expect(row).toMatchObject({ storageKey: key, alt: 'Sala com maca e luz natural', width: 1600 });
    const [entry] = await audits('room_photo.create');
    expect(entry).toMatchObject({
      entityId: photo.id,
      after: { roomId: room.id, storageKey: key },
    });
  });

  it('answers 415 for a non-WebP upload and 413 above 5 MiB', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const id = randomUUID();

    const png = await upload(admin.cookie, room.id, id, 'large', PNG, 'image/png');
    const disguised = await upload(admin.cookie, room.id, id, 'large', PNG);
    const huge = await upload(admin.cookie, room.id, id, 'large', webp(5 * 1024 * 1024 + 1));

    expect([png.status, disguised.status, huge.status]).toEqual([415, 415, 413]);
    expect(storage.objects.size).toBe(0);
  });

  it('answers 422 to a registration with a missing variant and inserts nothing', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const uploadId = randomUUID();
    await upload(admin.cookie, room.id, uploadId, 'large', webp());

    const res = await call(admin.cookie, 'POST', `/admin/rooms/${room.id}/photos`, {
      uploadId,
      alt: 'Recepção',
      width: 1600,
      height: 1067,
    });

    expect([res.status, res.error?.code, res.error?.details?.[0]?.path]).toEqual([
      422,
      'VALIDATION_FAILED',
      'uploadId',
    ]);
    expect(await db.select().from(roomPhotos)).toHaveLength(0);
  });

  it('answers 422 to the 13th photo, on upload and on registration', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const pending = randomUUID();
    await upload(admin.cookie, room.id, pending, 'large', webp());
    await upload(admin.cookie, room.id, pending, 'small', webp());
    await db.insert(roomPhotos).values(
      Array.from({ length: 12 }, (_, i) => ({
        roomId: room.id,
        storageKey: `rooms/${room.id}/${randomUUID()}`,
        alt: `Foto ${String(i + 1)}`,
        width: 1600,
        height: 1067,
        displayOrder: i,
      })),
    );

    const uploadRes = await upload(admin.cookie, room.id, randomUUID(), 'large', webp());
    const register = await call(admin.cookie, 'POST', `/admin/rooms/${room.id}/photos`, {
      uploadId: pending,
      alt: 'Décima terceira',
      width: 1600,
      height: 1067,
    });

    expect([uploadRes.status, register.status]).toEqual([422, 422]);
    expect(await db.select().from(roomPhotos)).toHaveLength(12);
  });
});

describe('room photo gallery (GES-107, GES-108)', () => {
  it('keeps a single cover when the cover switches, and edits the alt text', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const first = await addPhoto(admin.cookie, room.id, 'Primeira');
    const second = await addPhoto(admin.cookie, room.id, 'Segunda');

    await call(admin.cookie, 'PATCH', `/admin/rooms/${room.id}/photos/${first.id}`, {
      isCover: true,
    });
    const switched = await call(
      admin.cookie,
      'PATCH',
      `/admin/rooms/${room.id}/photos/${second.id}`,
      { isCover: true, alt: 'Segunda foto, vista da maca' },
    );

    expect(switched.status).toBe(200);
    expect(switched.body).toMatchObject({ isCover: true, alt: 'Segunda foto, vista da maca' });
    const covers = await db
      .select({ id: roomPhotos.id })
      .from(roomPhotos)
      .where(eq(roomPhotos.isCover, true));
    expect(covers).toEqual([{ id: second.id }]);
    expect(await audits('room_photo.update')).toHaveLength(2);
  });

  it('reorders the gallery from the full id list; a partial list is 422', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const a = await addPhoto(admin.cookie, room.id, 'A');
    const b = await addPhoto(admin.cookie, room.id, 'B');
    const c = await addPhoto(admin.cookie, room.id, 'C');

    const partial = await call(admin.cookie, 'PUT', `/admin/rooms/${room.id}/photos/order`, {
      ids: [c.id, a.id],
    });
    const ordered = await call(admin.cookie, 'PUT', `/admin/rooms/${room.id}/photos/order`, {
      ids: [c.id, a.id, b.id],
    });
    const list = await call(admin.cookie, 'GET', '/admin/rooms');

    expect([partial.status, ordered.status]).toEqual([422, 204]);
    const listed = (list.body as { items: { id: string; photos: { alt: string }[] }[] }).items;
    expect(listed.find((r) => r.id === room.id)?.photos.map((p) => p.alt)).toEqual(['C', 'A', 'B']);
    expect(await audits('room_photo.reorder')).toHaveLength(1);
  });

  it('deletes a photo (204) and both objects after the commit, with audit room_photo.delete', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const photo = await addPhoto(admin.cookie, room.id);

    const res = await call(admin.cookie, 'DELETE', `/admin/rooms/${room.id}/photos/${photo.id}`);

    expect(res.status).toBe(204);
    expect(await db.select().from(roomPhotos)).toHaveLength(0);
    expect(storage.objects.has(`room-photos/${photo.storageKey}-large.webp`)).toBe(false);
    expect(storage.objects.has(`room-photos/${photo.storageKey}-small.webp`)).toBe(false);
    const [entry] = await audits('room_photo.delete');
    expect(entry).toMatchObject({ entityId: photo.id, before: { storageKey: photo.storageKey } });
  });

  it('the public rooms endpoints expose /media/<key>-large.webp URLs', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const room = await seededRoom(db);
    const photo = await addPhoto(admin.cookie, room.id, 'Vista geral');
    await call(admin.cookie, 'PATCH', `/admin/rooms/${room.id}/photos/${photo.id}`, {
      isCover: true,
    });

    const detail = await call(undefined, 'GET', `/public/rooms/${room.slug}`);
    const list = await call(undefined, 'GET', '/public/rooms');

    const url = `/media/${photo.storageKey}-large.webp`;
    expect((detail.body as { photos: unknown[] }).photos).toEqual([
      { url, alt: 'Vista geral', width: 1600, height: 1067 },
    ]);
    const summary = (list.body as { items: { id: string; cover: { url: string } | null }[] }).items;
    expect(summary.find((r) => r.id === room.id)?.cover?.url).toBe(url);
  });
});

describe('rooms admin access', () => {
  it('reception gets 403 on the rooms admin routes', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const room = await seededRoom(db);

    const results = [
      await call(reception.cookie, 'GET', '/admin/rooms'),
      await call(reception.cookie, 'POST', '/admin/rooms', roomBody()),
      await call(reception.cookie, 'PATCH', `/admin/rooms/${room.id}`, roomBody()),
      await upload(reception.cookie, room.id, randomUUID(), 'large', webp()),
    ];

    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
  });

  it('rooms_list answers through MCP', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
    const admin = await createStaff(db, 'admin', NOW);
    const { token } = (
      await call(admin.cookie, 'POST', '/admin/integrations/mcp/tokens', {
        name: 'Assistente',
        scope: 'read',
      })
    ).body as { token: string };
    const client = await connectMcp(buildApp(), token);

    const result = await client.callTool({ name: 'rooms_list', arguments: {} });
    await client.close();

    const items = (result.structuredContent as { items: { slug: string }[] }).items;
    expect(items.map((r) => r.slug)).toContain('principal');
  });
});
