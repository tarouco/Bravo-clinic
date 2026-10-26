import { meSchema } from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { cpf, createTenant } from '../../../test/booking-helpers';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { users } from '../../db/schema';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const patch = (cookie: string, body: unknown) =>
  send(createApp({ db, env: testEnv(), fetch: forbiddenFetch }), 'PATCH', '/app/me', {
    cookie,
    body,
  });

describe('PATCH /app/me (NUC-192)', () => {
  it('updates name, phone, profession and registry and returns the extended me payload', async () => {
    const { user, cookie } = await createTenant(db, { document: false });

    const res = await patch(cookie, {
      name: 'Ana Souza',
      phone: '(47) 99999-1234',
      profession: 'Psicóloga',
      professionalRegistry: 'CRP 12/34567',
    });

    expect(res.status).toBe(200);
    expect(meSchema.parse(res.body)).toMatchObject({
      id: user.id,
      name: 'Ana Souza',
      phone: '+5547999991234',
      profession: 'Psicóloga',
      professionalRegistry: 'CRP 12/34567',
      document: null,
      docType: null,
    });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ name: 'Ana Souza', phone: '+5547999991234' });
  });

  it('saves the document when the user has none and derives docType', async () => {
    const { user, cookie } = await createTenant(db, { document: false });

    const res = await patch(cookie, { document: '529.982.247-25' });

    expect(res.status).toBe(200);
    expect(meSchema.parse(res.body)).toMatchObject({ document: '52998224725', docType: 'cpf' });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({ docType: 'cpf', docNumber: '52998224725' });
  });

  it('answers 422 when the user already has a document and leaves it unchanged', async () => {
    const { user, cookie } = await createTenant(db);
    const [before] = await db.select().from(users).where(eq(users.id, user.id));

    const res = await patch(cookie, { document: cpf(900) });

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
    const [after] = await db.select().from(users).where(eq(users.id, user.id));
    expect(after?.docNumber).toBe(before?.docNumber);
  });

  it('answers 409 DOCUMENT_TAKEN when the document belongs to another user', async () => {
    const owner = await createTenant(db);
    const [ownerRow] = await db.select().from(users).where(eq(users.id, owner.user.id));
    const { cookie } = await createTenant(db, { document: false });

    const res = await patch(cookie, { document: ownerRow?.docNumber });

    expect(res.status).toBe(409);
    expect(res.error?.code).toBe('DOCUMENT_TAKEN');
  });

  it('answers 422 for an invalid document and for an unknown field', async () => {
    const { cookie } = await createTenant(db, { document: false });

    const invalid = await patch(cookie, { document: '111.111.111-11' });
    const unknown = await patch(cookie, { role: 'admin' });

    expect(invalid.status).toBe(422);
    expect(unknown.status).toBe(422);
  });
});
