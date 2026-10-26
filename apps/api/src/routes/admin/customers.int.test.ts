import {
  customerCreatedSchema,
  customerSearchResultSchema,
  passwordResetConfirmSchema,
} from '@bravo/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpf, createStaff, createTenant } from '../../../test/booking-helpers';
import { forbiddenFetch, send, testEnv, tokenFromEmail } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb } from '../../db/client';
import { auditLog, authTokens, emailOutbox, users } from '../../db/schema';
import { runSeed } from '../../db/seed';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2026-10-20T12:00:00.000Z');

let cookie = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  cookie = (await createStaff(db, 'reception', NOW)).cookie;
});

const call = (method: string, path: string, body?: unknown) =>
  send(createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() }), method, path, {
    cookie,
    ...(body !== undefined && { body }),
  });

const newCustomer = {
  name: 'Marina Costa',
  email: 'marina@exemplo.com',
  phone: '(47) 99999-1234',
  document: '529.982.247-25',
};

describe('GET /admin/customers/search (NUC-169)', () => {
  it('needs at least 2 characters', async () => {
    const res = await call('GET', '/admin/customers/search?q=a');

    expect(res.status).toBe(422);
    expect(res.error?.code).toBe('VALIDATION_FAILED');
  });

  it('matches tenants by name, e-mail and document digits, masking the document', async () => {
    const { user } = await createTenant(db, {
      name: 'Marina Costa',
      email: 'marina@exemplo.com',
    });
    await db
      .update(users)
      .set({ docType: 'cpf', docNumber: '52998224725', phone: '+5547999991234' })
      .where(eq(users.id, user.id));
    await createTenant(db, { name: 'Bruno Lima', email: 'bruno@exemplo.com' });
    await createStaff(db, 'reception', NOW);
    const found = async (q: string) =>
      customerSearchResultSchema
        .parse((await call('GET', `/admin/customers/search?q=${encodeURIComponent(q)}`)).body)
        .items.map((i) => i.email);

    expect(await found('MARINA')).toEqual(['marina@exemplo.com']);
    expect(await found('bruno@')).toEqual(['bruno@exemplo.com']);
    expect(await found('529.982')).toEqual(['marina@exemplo.com']);
    expect(await found('Equipe')).toEqual([]);
    const [item] = customerSearchResultSchema.parse(
      (await call('GET', '/admin/customers/search?q=marina')).body,
    ).items;
    expect(item).toEqual({
      id: user.id,
      name: 'Marina Costa',
      email: 'marina@exemplo.com',
      docMasked: '***.***.***-25',
      phone: '+5547999991234',
    });
  });
});

describe('POST /admin/customers (NUC-169)', () => {
  it('creates a verified tenant without a password and mails a 72 h set-password link', async () => {
    const res = await call('POST', '/admin/customers', newCustomer);

    expect(res.status).toBe(201);
    const created = customerCreatedSchema.parse(res.body);
    expect(created).toMatchObject({ name: 'Marina Costa', email: 'marina@exemplo.com' });
    const [row] = await db.select().from(users).where(eq(users.id, created.id));
    expect(row).toMatchObject({
      role: 'tenant',
      passwordHash: null,
      docType: 'cpf',
      docNumber: '52998224725',
      phone: '+5547999991234',
    });
    expect(row?.emailVerifiedAt?.toISOString()).toBe(NOW.toISOString());
    const [mail] = await db.select().from(emailOutbox);
    expect(mail).toMatchObject({
      template: 'account.set_password',
      toAddress: 'marina@exemplo.com',
    });
    const token = tokenFromEmail(mail?.textBody ?? '');
    const [stored] = await db.select().from(authTokens);
    expect(stored).toMatchObject({ userId: created.id, purpose: 'password_reset' });
    expect(stored?.expiresAt.toISOString()).toBe('2026-10-23T12:00:00.000Z');
    expect(token.length).toBeGreaterThan(20);
    expect((await db.select().from(auditLog)).map((a) => a.action)).toContain('customer.create');
  });

  it('lets the customer set the password with that link', async () => {
    const created = customerCreatedSchema.parse(
      (await call('POST', '/admin/customers', newCustomer)).body,
    );
    const [mail] = await db.select().from(emailOutbox);
    const body = passwordResetConfirmSchema.parse({
      token: tokenFromEmail(mail?.textBody ?? ''),
      password: 'senha-nova-123',
    });

    const confirm = await send(
      createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv() }),
      'POST',
      '/public/auth/password-reset/confirm',
      { body },
    );

    expect(confirm.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, created.id));
    expect(row?.passwordHash).not.toBeNull();
  });

  it('answers 409 EMAIL_TAKEN and DOCUMENT_TAKEN for duplicates and 422 for an invalid document', async () => {
    await call('POST', '/admin/customers', newCustomer);

    const email = await call('POST', '/admin/customers', { ...newCustomer, document: cpf(777) });
    const document = await call('POST', '/admin/customers', {
      ...newCustomer,
      email: 'outra@exemplo.com',
    });
    const invalid = await call('POST', '/admin/customers', {
      ...newCustomer,
      email: 'terceira@exemplo.com',
      document: '111.111.111-11',
    });

    expect(email.status).toBe(409);
    expect(email.error?.code).toBe('EMAIL_TAKEN');
    expect(document.status).toBe(409);
    expect(document.error?.code).toBe('DOCUMENT_TAKEN');
    expect(invalid.status).toBe(422);
    expect(await db.select().from(users).where(eq(users.role, 'tenant'))).toHaveLength(1);
  });
});
