import {
  catalogSchema,
  clinicSchema,
  policiesPublicSchema,
  roomDetailSchema,
  roomListSchema,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory } from '../../../test/factories';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { bookingCategories, roomPhotos, rooms, settings } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { createRegistry } from '../../extensions/registry';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await runSeed(db);
});

const buildApp = (registry = createRegistry()) =>
  createApp({
    db,
    now: () => new Date('2026-10-20T12:00:00Z'),
    fetch: forbiddenFetch,
    env: testEnv(),
    registry,
  });

const get = (path: string, registry?: ReturnType<typeof createRegistry>) =>
  send(buildApp(registry), 'GET', `/public/${path}`);

describe('GET /public/rooms and /public/rooms/:slug (NUC-74, NUC-75)', () => {
  it('lists the 3 active rooms by display order with fromPriceCents 8000 and no cover', async () => {
    const res = await get('rooms');

    expect(res.status).toBe(200);
    const parsed = roomListSchema.parse(res.body);
    expect(parsed.items.map((r) => [r.slug, r.fromPriceCents, r.cover])).toEqual([
      ['principal', 8000, null],
      ['secundaria', 8000, null],
      ['terceira', 8000, null],
    ]);
    expect(parsed.items[0]?.idealFor).toEqual(['Médico', 'Estética', 'Gravação de vídeos']);
  });

  it('omits an inactive room from the list and answers 404 NOT_FOUND on its detail', async () => {
    await db.update(rooms).set({ status: 'inactive' }).where(eq(rooms.slug, 'terceira'));

    const list = roomListSchema.parse((await get('rooms')).body);
    const detail = await get('rooms/terceira');
    const unknown = await get('rooms/nao-existe');

    expect(list.items.map((r) => r.slug)).toEqual(['principal', 'secundaria']);
    expect([detail.status, detail.error?.code]).toEqual([404, 'NOT_FOUND']);
    expect([unknown.status, unknown.error?.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('returns the room detail with photos and cover through the RoomMediaPort, null without a port URL', async () => {
    const [room] = await db.select().from(rooms).where(eq(rooms.slug, 'principal'));
    await db.insert(roomPhotos).values([
      {
        roomId: room?.id ?? '',
        storageKey: 'principal/a',
        alt: 'Maca',
        isCover: false,
        displayOrder: 2,
      },
      {
        roomId: room?.id ?? '',
        storageKey: 'principal/b',
        alt: 'Entrada',
        isCover: true,
        displayOrder: 1,
        width: 1600,
        height: 900,
      },
    ]);
    const registry = createRegistry({ roomMedia: { photoUrl: (key) => `/media/${key}.webp` } });

    const withMedia = roomDetailSchema.parse((await get('rooms/principal', registry)).body);
    const withoutMedia = roomDetailSchema.parse((await get('rooms/principal')).body);

    expect(withMedia.cover).toEqual({
      url: '/media/principal/b.webp',
      alt: 'Entrada',
      width: 1600,
      height: 900,
    });
    expect(withMedia.photos.map((p) => p.url)).toEqual([
      '/media/principal/b.webp',
      '/media/principal/a.webp',
    ]);
    expect([withoutMedia.cover, withoutMedia.photos]).toEqual([null, []]);
  });
});

describe('GET /public/catalog (NUC-76)', () => {
  it('returns the 4 factory hourly categories, the V_ref flag and pricesReviewed false', async () => {
    const parsed = catalogSchema.parse((await get('catalog')).body);

    expect(
      parsed.hourly.map((c) => [
        c.name,
        c.weekdayRateCents,
        c.weekendRateCents,
        c.minDurationMinutes,
        c.isReference,
      ]),
    ).toEqual([
      ['1 hora', 9700, 12000, 60, true],
      ['2 horas ou mais', 8000, 9900, 120, false],
      ['1 hora — noite', 12000, 12000, 60, false],
      ['2 horas ou mais — noite', 9900, 9900, 120, false],
    ]);
    expect(parsed.blocks).toEqual([]);
    expect(parsed.pricesReviewed).toBe(false);
  });

  it('excludes inactive and admin_only categories and reports the average hourly value of blocks', async () => {
    await db
      .update(bookingCategories)
      .set({ status: 'inactive' })
      .where(eq(bookingCategories.name, '1 hora — noite'));
    await createCategory(db, {
      type: 'block',
      name: 'Manhã',
      startMinute: 420,
      endMinute: 720,
      fixedPriceCents: 28000,
    });
    await createCategory(db, {
      type: 'block',
      name: 'Interno',
      visibility: 'admin_only',
      fixedPriceCents: 1000,
    });
    await createCategory(db, {
      type: 'block',
      name: 'Inativo',
      status: 'inactive',
      fixedPriceCents: 1000,
    });

    const parsed = catalogSchema.parse((await get('catalog')).body);

    expect(parsed.hourly.map((c) => c.name)).not.toContain('1 hora — noite');
    expect(parsed.blocks.map((b) => [b.name, b.fixedPriceCents, b.averageHourlyCents])).toEqual([
      ['Manhã', 28000, 5600],
    ]);
  });
});

describe('GET /public/clinic and /public/policies (NUC-84, NUC-85)', () => {
  it('returns the address, contact settings and the 8 business-hours rows', async () => {
    await db
      .update(settings)
      .set({ value: '+5547999990000' })
      .where(eq(settings.key, 'clinic.whatsapp_e164'));

    const parsed = clinicSchema.parse((await get('clinic')).body);

    expect(parsed.addressLine).toBe('Praia Brava, Itajaí – SC');
    expect(parsed.whatsappE164).toBe('+5547999990000');
    expect(parsed.businessHours.map((h) => [h.dayType, h.openMinute, h.closeMinute])).toEqual([
      ['mon', 420, 1440],
      ['tue', 420, 1440],
      ['wed', 420, 1440],
      ['thu', 420, 1440],
      ['fri', 420, 1440],
      ['sat', 540, 1440],
      ['sun', 540, 1440],
      ['holiday', 540, 1440],
    ]);
  });

  it('returns policy version 1, the frozen values and the four rendered sections', async () => {
    const parsed = policiesPublicSchema.parse((await get('policies')).body);

    expect(parsed.version).toBe(1);
    expect(parsed.values['payment.deposit_percent']).toBe(50);
    expect(parsed.sections.map((s) => s.title)).toEqual([
      'Sinal e saldo',
      'Reagendamento',
      'Cancelamento',
      'No-show',
    ]);
    expect(parsed.sections[0]?.paragraphs.join(' ')).toContain('sinal de 50%');
  });
});
