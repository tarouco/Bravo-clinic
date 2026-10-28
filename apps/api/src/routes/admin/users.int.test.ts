import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant } from '../../../test/booking-helpers';
import { createUser, loginAs } from '../../../test/factories';
import { forbiddenFetch, send, testEnv, tokenFromEmail } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, authTokens, emailOutbox, sessions, userTotp, users } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { sha256Hex } from '../../lib/crypto';

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
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, { cookie, ...(body !== undefined && { body }) });

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));
const sessionStatus = async (cookie: string) =>
  (await call(cookie, 'GET', '/admin/session')).status;
const appStatus = async (cookie: string) => (await call(cookie, 'GET', '/app/me')).status;

describe('GET /admin/users (GES-110)', () => {
  it('lists staff accounts with role, status, 2FA flag and last login; tenants are left out', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const disabled = await createUser(db, { role: 'reception', name: 'Bia Recepção' });
    await db
      .update(users)
      .set({ status: 'disabled', lastLoginAt: new Date('2027-02-01T12:00:00Z') })
      .where(eq(users.id, disabled.id));
    await createTenant(db, { now: NOW });

    const res = await call(admin.cookie, 'GET', '/admin/users');

    expect(res.status).toBe(200);
    expect((res.body as { items: unknown[] }).items).toEqual([
      {
        id: disabled.id,
        name: 'Bia Recepção',
        email: disabled.email,
        role: 'reception',
        status: 'disabled',
        totpConfirmed: false,
        lastLoginAt: '2027-02-01T12:00:00.000Z',
      },
      {
        id: admin.user.id,
        name: 'Equipe admin',
        email: admin.user.email,
        role: 'admin',
        status: 'active',
        totpConfirmed: true,
        lastLoginAt: null,
      },
    ]);
  });
});

describe('POST /admin/users (GES-111)', () => {
  it('invites a new e-mail: passwordless user, 72 h set-password token, staff.invite e-mail, audit', async () => {
    const admin = await createStaff(db, 'admin', NOW);

    const res = await call(admin.cookie, 'POST', '/admin/users', {
      name: 'Carla Nunes',
      email: 'Carla.Nunes@BravoClinic.test',
      role: 'reception',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Carla Nunes',
      email: 'carla.nunes@bravoclinic.test',
      role: 'reception',
      status: 'active',
      totpConfirmed: false,
    });
    const id = (res.body as { id: string }).id;
    const [user] = await db.select().from(users).where(eq(users.id, id));
    expect(user).toMatchObject({ role: 'reception', passwordHash: null });
    const [mail] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.template, 'staff.invite'));
    expect(mail?.toAddress).toBe('carla.nunes@bravoclinic.test');
    const token = tokenFromEmail(mail?.textBody ?? '');
    const [stored] = await db
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, sha256Hex(token)));
    expect(stored).toMatchObject({ userId: id, purpose: 'password_reset', usedAt: null });
    expect(stored?.expiresAt.getTime()).toBe(NOW.getTime() + 72 * 3600 * 1000);
    const [entry] = await audits('user.invite');
    expect(entry).toMatchObject({
      entityId: id,
      actorUserId: admin.user.id,
      after: { email: 'carla.nunes@bravoclinic.test', role: 'reception' },
    });
  });

  it('promotes a tenant in place (role_change, sessions revoked) and answers 409 for a staff e-mail', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const reception = await createStaff(db, 'reception', NOW);
    const tenant = await createTenant(db, { now: NOW });

    const promoted = await call(admin.cookie, 'POST', '/admin/users', {
      name: 'Qualquer',
      email: tenant.user.email,
      role: 'admin',
    });
    const staffEmail = await call(admin.cookie, 'POST', '/admin/users', {
      name: 'Repetida',
      email: reception.user.email,
      role: 'admin',
    });

    expect(promoted.status).toBe(201);
    expect(promoted.body).toMatchObject({ id: tenant.user.id, role: 'admin' });
    const [row] = await db.select().from(users).where(eq(users.id, tenant.user.id));
    expect(row?.role).toBe('admin');
    expect(await appStatus(tenant.cookie)).toBe(401);
    const [entry] = await audits('user.role_change');
    expect(entry).toMatchObject({
      entityId: tenant.user.id,
      before: { role: 'tenant' },
      after: { role: 'admin' },
    });
    expect([staffEmail.status, staffEmail.error?.code]).toEqual([409, 'CONFLICT']);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe('PATCH /admin/users/:id (GES-112, GES-113)', () => {
  it('a role change revokes the target sessions (next request 401) with audit before/after', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const target = await createStaff(db, 'reception', NOW);
    expect(await sessionStatus(target.cookie)).toBe(200);

    const res = await call(admin.cookie, 'PATCH', `/admin/users/${target.user.id}`, {
      role: 'admin',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.user.id, role: 'admin', status: 'active' });
    expect(await sessionStatus(target.cookie)).toBe(401);
    const [entry] = await audits('user.role_change');
    expect(entry).toMatchObject({
      entityId: target.user.id,
      actorUserId: admin.user.id,
      before: { role: 'reception' },
      after: { role: 'admin' },
    });
  });

  it('disabling revokes the sessions and blocks a new login session; enabling is audited', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const target = await createStaff(db, 'reception', NOW);

    const disabled = await call(admin.cookie, 'PATCH', `/admin/users/${target.user.id}`, {
      status: 'disabled',
    });
    const afterDisable = await sessionStatus(target.cookie);
    const fresh = await loginAs(db, target.user, { mfaVerified: true, now: NOW });
    const freshStatus = await sessionStatus(fresh);
    const enabled = await call(admin.cookie, 'PATCH', `/admin/users/${target.user.id}`, {
      status: 'active',
    });

    expect([disabled.status, afterDisable, freshStatus, enabled.status]).toEqual([
      200, 401, 401, 200,
    ]);
    const open = await db.select().from(sessions).where(eq(sessions.userId, target.user.id));
    expect(open.every((s) => s.revokedAt !== null)).toBe(true);
    expect((await audits('user.disable'))[0]).toMatchObject({
      before: { status: 'active' },
      after: { status: 'disabled' },
    });
    expect((await audits('user.enable'))[0]).toMatchObject({
      before: { status: 'disabled' },
      after: { status: 'active' },
    });
  });

  it('answers 422 POLICY_VIOLATION when an admin targets their own account', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await createStaff(db, 'admin', NOW);

    const demote = await call(admin.cookie, 'PATCH', `/admin/users/${admin.user.id}`, {
      role: 'reception',
    });
    const disable = await call(admin.cookie, 'PATCH', `/admin/users/${admin.user.id}`, {
      status: 'disabled',
    });

    expect([demote.status, demote.error?.code]).toEqual([422, 'POLICY_VIOLATION']);
    expect([disable.status, disable.error?.code]).toEqual([422, 'POLICY_VIOLATION']);
    const [row] = await db.select().from(users).where(eq(users.id, admin.user.id));
    expect([row?.role, row?.status]).toEqual(['admin', 'active']);
  });

  it('answers 409 LAST_ADMIN to a change that would leave no active admin', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    // A disabled admin does not count.
    const other = await createUser(db, { role: 'admin' });
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, other.id));

    const res = await call(admin.cookie, 'PATCH', `/admin/users/${admin.user.id}`, {
      role: 'reception',
    });

    expect([res.status, res.error?.code]).toEqual([409, 'LAST_ADMIN']);
    expect(res.error?.message).toBe('É preciso manter ao menos um administrador ativo');
    const [row] = await db.select().from(users).where(eq(users.id, admin.user.id));
    expect(row?.role).toBe('admin');
    expect(await sessionStatus(admin.cookie)).toBe(200);
  });
});

describe('POST /admin/users/:id/totp-reset (GES-114)', () => {
  it('deletes the target TOTP, revokes their sessions and audits the justification', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const target = await createStaff(db, 'reception', NOW);

    const missing = await call(admin.cookie, 'POST', `/admin/users/${target.user.id}/totp-reset`, {
      justification: 'oi',
    });
    const res = await call(admin.cookie, 'POST', `/admin/users/${target.user.id}/totp-reset`, {
      justification: 'Celular perdido, pedido por telefone',
    });

    expect([missing.status, missing.error?.details?.[0]?.path]).toEqual([422, 'justification']);
    expect(res.status).toBe(204);
    expect(await db.select().from(userTotp).where(eq(userTotp.userId, target.user.id))).toEqual([]);
    expect(await sessionStatus(target.cookie)).toBe(401);
    const [entry] = await audits('user.totp_reset');
    expect(entry).toMatchObject({
      entityId: target.user.id,
      justification: 'Celular perdido, pedido por telefone',
    });
  });
});

describe('GET /admin/audit (GES-115)', () => {
  async function seedAudit() {
    const admin = await createStaff(db, 'admin', NOW);
    const other = await createUser(db, { role: 'admin', name: 'Outra Admin' });
    const row = (
      at: string,
      action: string,
      origin: string,
      actor: string | null,
      extra: Partial<typeof auditLog.$inferInsert> = {},
    ) => ({
      at: new Date(at),
      action,
      origin,
      actorUserId: actor,
      actorRole: actor === null ? null : 'admin',
      entityType: 'booking',
      entityId: 'b-1',
      ...extra,
    });
    await db.insert(auditLog).values([
      row('2027-02-01T12:00:00Z', 'booking.cancel', 'admin', admin.user.id),
      row('2027-02-10T12:00:00Z', 'mcp.booking_get', 'mcp', admin.user.id),
      row('2027-02-15T12:00:00Z', 'booking.confirm_manual', 'admin', other.id, {
        justification: 'Pagou em dinheiro',
        before: { status: 'awaiting_payment' },
        after: { status: 'confirmed' },
      }),
      row('2027-02-20T12:00:00Z', 'expense.create', 'job', null, {
        entityType: 'expense',
        entityId: 'e-1',
      }),
    ]);
    return { admin, other };
  }

  const actions = (res: { body: unknown }) =>
    (res.body as { items: { action: string }[] }).items.map((i) => i.action);

  it('filters by actor, origin, action prefix, entity and date range, newest first', async () => {
    const { admin, other } = await seedAudit();
    const get = (query: string) => call(admin.cookie, 'GET', `/admin/audit?${query}`);

    const byActor = await get(`actorId=${other.id}`);
    const byOrigin = await get('origin=mcp');
    const byPrefix = await get('actionPrefix=booking.');
    const byEntity = await get('entityType=expense&entityId=e-1');
    const byRange = await get('from=2027-02-10&to=2027-02-15');

    expect(byActor.body).toEqual({
      items: [
        {
          id: expect.any(Number) as number,
          at: '2027-02-15T12:00:00.000Z',
          actorUserId: other.id,
          actorName: 'Outra Admin',
          actorRole: 'admin',
          origin: 'admin',
          action: 'booking.confirm_manual',
          entityType: 'booking',
          entityId: 'b-1',
          justification: 'Pagou em dinheiro',
          before: { status: 'awaiting_payment' },
          after: { status: 'confirmed' },
        },
      ],
      nextCursor: null,
    });
    expect(actions(byOrigin)).toEqual(['mcp.booking_get']);
    expect(actions(byPrefix)).toEqual(['booking.confirm_manual', 'booking.cancel']);
    expect(actions(byEntity)).toEqual(['expense.create']);
    expect(actions(byRange)).toEqual(['booking.confirm_manual', 'mcp.booking_get']);
  });

  it('pages newest first with a cursor, at most 100 rows per page', async () => {
    const { admin } = await seedAudit();

    const first = await call(admin.cookie, 'GET', '/admin/audit?actionPrefix=b&limit=1');
    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const second = await call(
      admin.cookie,
      'GET',
      `/admin/audit?actionPrefix=b&limit=1&cursor=${cursor}`,
    );
    const tooMany = await call(admin.cookie, 'GET', '/admin/audit?limit=101');

    expect(actions(first)).toEqual(['booking.confirm_manual']);
    expect(actions(second)).toEqual(['booking.cancel']);
    expect((second.body as { nextCursor: null }).nextCursor).toBeNull();
    expect([tooMany.status, tooMany.error?.details?.[0]?.path]).toEqual([422, 'limit']);
  });

  it('keeps rows of one transaction (same instant) across pages', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    // Microseconds, as `now()` writes them: a millisecond cursor would skip the tied rows.
    const at = sql`'2027-02-01 12:00:00.123456+00'::timestamptz`;
    await db.insert(auditLog).values(
      ['a.1', 'a.2', 'a.3'].map((action) => ({
        at,
        action,
        origin: 'admin',
        entityType: 'x',
      })),
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `/admin/audit?actionPrefix=a.&limit=1${cursor === null ? '' : `&cursor=${cursor}`}`;
      const res = await call(admin.cookie, 'GET', query);
      seen.push(...actions(res));
      cursor = (res.body as { nextCursor: string | null }).nextCursor;
    } while (cursor !== null);

    expect(seen).toEqual(['a.3', 'a.2', 'a.1']);
  });
});

describe('Usuários and audit access', () => {
  it('reception gets 403 on the users and audit routes', async () => {
    const reception = await createStaff(db, 'reception', NOW);

    const results = [
      await call(reception.cookie, 'GET', '/admin/users'),
      await call(reception.cookie, 'POST', '/admin/users', {
        name: 'Nova',
        email: 'nova@bravoclinic.test',
        role: 'admin',
      }),
      await call(reception.cookie, 'PATCH', `/admin/users/${reception.user.id}`, {
        role: 'admin',
      }),
      await call(reception.cookie, 'GET', '/admin/audit'),
    ];

    expect(results.map((r) => [r.status, r.error?.code])).toEqual([
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
    ]);
  });
});
