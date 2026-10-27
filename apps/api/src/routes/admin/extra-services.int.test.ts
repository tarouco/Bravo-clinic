import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff } from '../../../test/booking-helpers';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, extraServices } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-02T15:00:00.000Z');

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = () => createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() });
const call = (cookie: string | undefined, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, {
    ...(cookie !== undefined && { cookie }),
    ...(body !== undefined && { body }),
  });

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

const onlineHourly = {
  name: 'Filmagem online',
  description: 'Cinegrafista durante a reserva',
  referencePriceCents: 8000,
  unit: 'hour',
  saleMode: 'online',
  status: 'active',
  displayOrder: 1,
};

describe('admin extra services (GES-84, GES-85)', () => {
  it('creates (201) and edits (200) a service with audit extra_service.create / update', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const created = await call(admin.cookie, 'POST', '/admin/extra-services', onlineHourly);
    expect(created.status).toBe(201);
    const service = created.body as { id: string };
    expect(created.body).toEqual({ id: service.id, ...onlineHourly });

    const edited = await call(admin.cookie, 'PATCH', `/admin/extra-services/${service.id}`, {
      ...onlineHourly,
      referencePriceCents: 9000,
      status: 'inactive',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ referencePriceCents: 9000, status: 'inactive' });

    const [row] = await db.select().from(extraServices).where(eq(extraServices.id, service.id));
    expect(row).toMatchObject({
      referencePriceCents: 9000,
      status: 'inactive',
      saleMode: 'online',
    });
    const [create] = await audits('extra_service.create');
    expect(create).toMatchObject({
      entityType: 'extra_service',
      entityId: service.id,
      actorUserId: admin.user.id,
      after: { name: 'Filmagem online', referencePriceCents: 8000, saleMode: 'online' },
    });
    const [update] = await audits('extra_service.update');
    expect(update).toMatchObject({
      entityId: service.id,
      before: { referencePriceCents: 8000, status: 'active' },
      after: { referencePriceCents: 9000, status: 'inactive' },
    });
  });

  it('answers 422 on referencePriceCents for an online service without price, on create and edit', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const noPrice = { ...onlineHourly, referencePriceCents: null };

    const create = await call(admin.cookie, 'POST', '/admin/extra-services', noPrice);
    const [seeded] = await db.select().from(extraServices).limit(1);
    const edit = await call(admin.cookie, 'PATCH', `/admin/extra-services/${seeded!.id}`, noPrice);

    for (const res of [create, edit]) {
      expect(res.status).toBe(422);
      expect(res.error?.code).toBe('VALIDATION_FAILED');
      expect(res.error?.details).toEqual([
        { path: 'referencePriceCents', message: 'Informe o preço para vender online' },
      ]);
    }
    expect(await audits('extra_service.create')).toHaveLength(0);
    expect(await audits('extra_service.update')).toHaveLength(0);
  });

  it('lists every service, inactive included, in display order; 404 on an unknown id', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await db.insert(extraServices).values({ ...onlineHourly, status: 'inactive', displayOrder: 0 });

    const list = await call(admin.cookie, 'GET', '/admin/extra-services');
    const missing = await call(
      admin.cookie,
      'PATCH',
      '/admin/extra-services/00000000-0000-4000-8000-000000000000',
      onlineHourly,
    );

    const items = (list.body as { items: { name: string; status: string }[] }).items;
    expect(items.map((i) => [i.name, i.status])).toEqual([
      ['Filmagem online', 'inactive'],
      ['Pacote de filmagem', 'active'],
      ['Videomaker', 'active'],
      ['Marketing digital', 'active'],
    ]);
    expect(missing.status).toBe(404);
  });

  it('is admin only: reception gets 403 on list, create and edit', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const [seeded] = await db.select().from(extraServices).limit(1);

    const results = await Promise.all([
      call(reception.cookie, 'GET', '/admin/extra-services'),
      call(reception.cookie, 'POST', '/admin/extra-services', onlineHourly),
      call(reception.cookie, 'PATCH', `/admin/extra-services/${seeded!.id}`, onlineHourly),
    ]);
    expect(results.map((r) => [r.status, r.error?.code])).toEqual([
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
    ]);
  });
});

describe('GET /public/extra-services (GES-86)', () => {
  it('returns active services only, in display order, with the public fields', async () => {
    await db.insert(extraServices).values([
      { ...onlineHourly, displayOrder: 5 },
      { ...onlineHourly, name: 'Desativado', status: 'inactive', displayOrder: 0 },
    ]);

    const res = await call(undefined, 'GET', '/public/extra-services');

    expect(res.status).toBe(200);
    const items = (res.body as { items: Record<string, unknown>[] }).items;
    expect(items.map((i) => i['name'])).toEqual([
      'Pacote de filmagem',
      'Videomaker',
      'Marketing digital',
      'Filmagem online',
    ]);
    expect(items[0]).toEqual({
      id: expect.any(String) as string,
      name: 'Pacote de filmagem',
      description: expect.any(String) as string,
      referencePriceCents: 8000,
      unit: 'hour',
      saleMode: 'quote',
    });
    expect(items[3]).toMatchObject({ referencePriceCents: 8000, unit: 'hour', saleMode: 'online' });
  });
});
