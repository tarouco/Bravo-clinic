import { afterAll, describe, expect, it } from 'vitest';
import { createUser } from '../../test/factories';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from '../db/client';
import { auditLog } from '../db/schema';
import { audit, originFromPath, type RequestContext } from './audit';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

describe('audit (FND-75)', () => {
  it('writes one row with every field of the input and the request context on commit', async () => {
    const actor = await createUser(db, { role: 'admin' });
    const ctx: RequestContext = {
      actorUserId: actor.id,
      actorRole: 'admin',
      origin: 'admin',
      ip: '203.0.113.7',
      requestId: '01JREQUESTID0000000000000A',
    };

    await withTransaction(db, (tx) =>
      audit(tx, ctx, {
        action: 'settings.update',
        entityType: 'setting',
        entityId: 'payment.deposit_percent',
        justification: 'Ajuste comercial',
        before: { value: 50 },
        after: { value: 40 },
      }),
    );

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: actor.id,
      actorRole: 'admin',
      origin: 'admin',
      action: 'settings.update',
      entityType: 'setting',
      entityId: 'payment.deposit_percent',
      justification: 'Ajuste comercial',
      before: { value: 50 },
      after: { value: 40 },
      ip: '203.0.113.7',
      requestId: '01JREQUESTID0000000000000A',
    });
  });

  it('leaves no row when the transaction rolls back', async () => {
    const ctx: RequestContext = {
      actorUserId: null,
      actorRole: null,
      origin: 'system',
      ip: null,
      requestId: null,
    };

    await expect(
      withTransaction(db, async (tx) => {
        await audit(tx, ctx, { action: 'user.update', entityType: 'user' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it('stores before/after redacted: password_hash never reaches the log', async () => {
    const ctx: RequestContext = {
      actorUserId: null,
      actorRole: null,
      origin: 'app',
      ip: null,
      requestId: null,
    };

    await withTransaction(db, (tx) =>
      audit(tx, ctx, {
        action: 'auth.password_reset',
        entityType: 'user',
        before: { password_hash: 'x', name: 'Ana' },
        after: { password_hash: 'y', name: 'Ana' },
      }),
    );

    const [row] = await db.select().from(auditLog);
    expect(row?.before).toEqual({ password_hash: '[redacted]', name: 'Ana' });
    expect(row?.after).toEqual({ password_hash: '[redacted]', name: 'Ana' });
  });
});

describe('originFromPath', () => {
  it('maps /admin to admin, /app to app and /public to web', () => {
    expect(originFromPath('/admin/session')).toBe('admin');
    expect(originFromPath('/app/me')).toBe('app');
    expect(originFromPath('/public/auth/login')).toBe('web');
  });
});
