import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff, createTenant } from '../../../test/booking-helpers';
import { APP_ORIGIN, forbiddenFetch, send, testEnv } from '../../../test/http';
import { connectMcp, toolErrorOf } from '../../../test/mcp-client';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { auditLog, expenseCategories, expenses } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { memoryStorage } from '../../lib/storage';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const NOW = new Date('2027-03-10T15:00:00.000Z');
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let storage = memoryStorage();
let categoryId = '';

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
  storage = memoryStorage();
  const [first] = await db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.displayOrder));
  categoryId = first?.id ?? '';
});

const buildApp = () =>
  createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv(), storage });
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  send(buildApp(), method, path, { cookie, ...(body !== undefined && { body }) });

const upload = (cookie: string, id: string, bytes: Uint8Array, type: string, name?: string) =>
  buildApp().request(`/admin/finance/expenses/${id}/attachment`, {
    method: 'PUT',
    headers: {
      'Content-Type': type,
      Origin: APP_ORIGIN,
      Cookie: cookie,
      ...(name !== undefined && { 'X-File-Name': encodeURIComponent(name) }),
    },
    body: bytes,
  });

const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

const expenseBody = (overrides: Record<string, unknown> = {}) => ({
  date: '2027-03-05',
  categoryId,
  description: 'Conta de energia',
  amountCents: 45_990,
  recurrence: 'monthly',
  ...overrides,
});

async function newExpense(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await call(cookie, 'POST', '/admin/finance/expenses', expenseBody(overrides));
  expect(res.status).toBe(201);
  return res.body as { id: string; categoryName: string };
}

describe('expenses (GES-11..GES-13)', () => {
  it('creates an expense (201) with the web shape and audit expense.create', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const [category] = await db
      .select()
      .from(expenseCategories)
      .where(eq(expenseCategories.id, categoryId));

    const res = await call(admin.cookie, 'POST', '/admin/finance/expenses', expenseBody());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String) as string,
      date: '2027-03-05',
      categoryId,
      categoryName: category?.name,
      description: 'Conta de energia',
      amountCents: 45_990,
      recurrence: 'monthly',
      recurrenceParentId: null,
      attachmentName: null,
      attachmentContentType: null,
    });
    const [entry] = await audits('expense.create');
    expect(entry).toMatchObject({
      entityType: 'expense',
      entityId: (res.body as { id: string }).id,
      actorUserId: admin.user.id,
      after: { amountCents: 45_990, description: 'Conta de energia', recurrence: 'monthly' },
    });
  });

  it('answers 422 on categoryId for an inactive or unknown category (GES-12)', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await db
      .update(expenseCategories)
      .set({ active: false })
      .where(eq(expenseCategories.id, categoryId));

    const inactive = await call(admin.cookie, 'POST', '/admin/finance/expenses', expenseBody());
    const unknown = await call(
      admin.cookie,
      'POST',
      '/admin/finance/expenses',
      expenseBody({ categoryId: '00000000-0000-4000-8000-000000000000' }),
    );
    const invalid = await call(
      admin.cookie,
      'POST',
      '/admin/finance/expenses',
      expenseBody({ amountCents: 0, description: '' }),
    );

    for (const res of [inactive, unknown]) {
      expect(res.status).toBe(422);
      expect(res.error?.code).toBe('VALIDATION_FAILED');
      expect(res.error?.details?.[0]?.path).toBe('categoryId');
    }
    expect(invalid.status).toBe(422);
    expect(invalid.error?.details?.map((d) => d.path).sort()).toEqual([
      'amountCents',
      'description',
    ]);
    expect(await db.select().from(expenses)).toHaveLength(0);
  });

  it('edits with before/after audit and keeps the recurrence when the edit leaves it out', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const created = await newExpense(admin.cookie);

    const res = await call(admin.cookie, 'PATCH', `/admin/finance/expenses/${created.id}`, {
      amountCents: 47_000,
      description: 'Energia (março)',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      amountCents: 47_000,
      description: 'Energia (março)',
      recurrence: 'monthly',
    });
    const [entry] = await audits('expense.update');
    expect(entry).toMatchObject({
      entityId: created.id,
      before: { amountCents: 45_990, description: 'Conta de energia' },
      after: { amountCents: 47_000, description: 'Energia (março)', recurrence: 'monthly' },
    });
  });

  it('soft-deletes with audit; deleted rows leave the list and answer 404 afterwards', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const kept = await newExpense(admin.cookie, { description: 'Internet' });
    const gone = await newExpense(admin.cookie);

    const res = await call(admin.cookie, 'DELETE', `/admin/finance/expenses/${gone.id}`);
    const again = await call(admin.cookie, 'DELETE', `/admin/finance/expenses/${gone.id}`);
    const edit = await call(admin.cookie, 'PATCH', `/admin/finance/expenses/${gone.id}`, {
      amountCents: 1,
    });
    const listed = await call(
      admin.cookie,
      'GET',
      '/admin/finance/expenses?from=2027-03-01&to=2027-03-31',
    );

    expect(res.status).toBe(204);
    expect(again.status).toBe(404);
    expect(edit.status).toBe(404);
    const [row] = await db.select().from(expenses).where(eq(expenses.id, gone.id));
    expect(row?.deletedAt?.toISOString()).toBe(NOW.toISOString());
    expect((listed.body as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([kept.id]);
    const [entry] = await audits('expense.delete');
    expect(entry).toMatchObject({
      entityId: gone.id,
      before: { description: 'Conta de energia', amountCents: 45_990 },
      after: { deletedAt: NOW.toISOString() },
    });
  });

  it('lists newest first with range and category filters and an opaque cursor', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const [, other] = await db
      .select()
      .from(expenseCategories)
      .orderBy(asc(expenseCategories.displayOrder));
    await db.insert(expenses).values(
      Array.from({ length: 51 }, (_, i) => ({
        date: `2027-02-${String((i % 28) + 1).padStart(2, '0')}`,
        categoryId,
        description: `Despesa ${String(i)}`,
        amountCents: 100 + i,
      })),
    );
    await db.insert(expenses).values([
      { date: '2027-02-10', categoryId: other?.id ?? '', description: 'Outra', amountCents: 9 },
      { date: '2027-01-31', categoryId, description: 'Fora', amountCents: 9 },
    ]);
    const base = `/admin/finance/expenses?from=2027-02-01&to=2027-02-28&categoryId=${categoryId}`;

    const first = await call(admin.cookie, 'GET', base);
    const firstBody = first.body as { items: { date: string }[]; nextCursor: string };
    const second = await call(admin.cookie, 'GET', `${base}&cursor=${firstBody.nextCursor}`);
    const secondBody = second.body as { items: { date: string }[]; nextCursor: string | null };
    const byCategory = await call(
      admin.cookie,
      'GET',
      `/admin/finance/expenses?from=2027-02-01&to=2027-02-28&categoryId=${other?.id ?? ''}`,
    );

    expect(firstBody.items).toHaveLength(50);
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
    const dates = [...firstBody.items, ...secondBody.items].map((i) => i.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates[0]).toBe('2027-02-28');
    expect(
      (byCategory.body as { items: { description: string }[] }).items.map((i) => i.description),
    ).toEqual(['Outra']);
  });
});

describe('expense attachments (GES-16..GES-18)', () => {
  it('stores the file in the private bucket with its name and content type', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const created = await newExpense(admin.cookie);

    const res = await upload(admin.cookie, created.id, PDF, 'application/pdf', 'nota fiscal.pdf');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: created.id,
      attachmentName: 'nota fiscal.pdf',
      attachmentContentType: 'application/pdf',
    });
    const [row] = await db.select().from(expenses).where(eq(expenses.id, created.id));
    expect(row?.attachmentKey).toMatch(new RegExp(`^expenses/${created.id}/[0-9a-f-]{36}$`));
    const object = storage.objects.get(`expense-attachments/${row?.attachmentKey ?? ''}`);
    expect(object?.contentType).toBe('application/pdf');
    expect([...(object?.body ?? [])]).toEqual([...PDF]);
    const [entry] = await audits('expense.attachment_upload');
    expect(entry).toMatchObject({
      entityId: created.id,
      after: { attachmentName: 'nota fiscal.pdf' },
    });
  });

  it('replacing the file deletes the previous object after commit', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const created = await newExpense(admin.cookie);
    await upload(admin.cookie, created.id, PDF, 'application/pdf', 'a.pdf');
    const [first] = await db.select().from(expenses).where(eq(expenses.id, created.id));

    const res = await upload(admin.cookie, created.id, PNG, 'image/png');

    expect(res.status).toBe(200);
    const [second] = await db.select().from(expenses).where(eq(expenses.id, created.id));
    expect(second?.attachmentKey).not.toBe(first?.attachmentKey);
    expect(second).toMatchObject({
      attachmentName: 'comprovante.png',
      attachmentContentType: 'image/png',
    });
    expect([...storage.objects.keys()]).toEqual([
      `expense-attachments/${second?.attachmentKey ?? ''}`,
    ]);
  });

  it('answers 413 over 5 MiB and 415 for another type or mismatched magic bytes', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const created = await newExpense(admin.cookie);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PDF);

    const tooLarge = await upload(admin.cookie, created.id, big, 'application/pdf');
    const wrongType = await upload(admin.cookie, created.id, PDF, 'text/plain');
    const mismatch = await upload(admin.cookie, created.id, PDF, 'image/png');

    expect(tooLarge.status).toBe(413);
    expect(((await tooLarge.json()) as { error: { code: string } }).error.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    for (const res of [wrongType, mismatch]) {
      expect(res.status).toBe(415);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'UNSUPPORTED_MEDIA_TYPE',
      );
    }
    expect(storage.objects.size).toBe(0);
    const [row] = await db.select().from(expenses).where(eq(expenses.id, created.id));
    expect(row?.attachmentKey).toBeNull();
  });

  it('redirects to a 300 s presigned URL, and removes the attachment with DELETE', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const created = await newExpense(admin.cookie);
    const none = await call(
      admin.cookie,
      'GET',
      `/admin/finance/expenses/${created.id}/attachment`,
    );
    await upload(admin.cookie, created.id, PDF, 'application/pdf', 'boleto.pdf');
    const [row] = await db.select().from(expenses).where(eq(expenses.id, created.id));

    const redirect = await buildApp().request(`/admin/finance/expenses/${created.id}/attachment`, {
      headers: { Cookie: admin.cookie },
    });
    const removed = await call(
      admin.cookie,
      'DELETE',
      `/admin/finance/expenses/${created.id}/attachment`,
    );

    expect(none.status).toBe(404);
    expect(redirect.status).toBe(302);
    const location = new URL(redirect.headers.get('Location') ?? '');
    expect(location.pathname).toBe(`/expense-attachments/${row?.attachmentKey ?? ''}`);
    expect(location.searchParams.get('expires')).toBe('300');
    expect(location.searchParams.get('name')).toBe('boleto.pdf');
    expect(removed.status).toBe(204);
    expect(storage.objects.size).toBe(0);
    const [after] = await db.select().from(expenses).where(eq(expenses.id, created.id));
    expect(after).toMatchObject({
      attachmentKey: null,
      attachmentName: null,
      attachmentContentType: null,
    });
  });
});

describe('expense categories (GES-19)', () => {
  it('creates at the end of the order, refuses a case-insensitive duplicate with 409, audits', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const before = (await call(admin.cookie, 'GET', '/admin/finance/expense-categories')).body as {
      items: { name: string; displayOrder: number }[];
    };

    const created = await call(admin.cookie, 'POST', '/admin/finance/expense-categories', {
      name: 'Café e copa',
    });
    const duplicate = await call(admin.cookie, 'POST', '/admin/finance/expense-categories', {
      name: 'CAFÉ E COPA',
    });
    const renameClash = await call(
      admin.cookie,
      'PATCH',
      `/admin/finance/expense-categories/${categoryId}`,
      { name: 'café e copa' },
    );

    expect(before.items).toHaveLength(14);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Café e copa',
      active: true,
      displayOrder: Math.max(...before.items.map((i) => i.displayOrder)) + 1,
    });
    expect([duplicate.status, duplicate.error?.code]).toEqual([409, 'CONFLICT']);
    expect([renameClash.status, renameClash.error?.code]).toEqual([409, 'CONFLICT']);
    const [entry] = await audits('expense_category.create');
    expect(entry).toMatchObject({ after: { name: 'Café e copa' } });
  });

  it('renames, reorders and deactivates with audit; old expenses stay listed', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const expense = await newExpense(admin.cookie);

    const res = await call(
      admin.cookie,
      'PATCH',
      `/admin/finance/expense-categories/${categoryId}`,
      {
        name: 'Energia elétrica',
        displayOrder: 99,
        active: false,
      },
    );
    const categories = (await call(admin.cookie, 'GET', '/admin/finance/expense-categories'))
      .body as {
      items: { id: string; active: boolean }[];
    };
    const listed = (await call(admin.cookie, 'GET', '/admin/finance/expenses')).body as {
      items: { id: string; categoryName: string }[];
    };

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: categoryId,
      name: 'Energia elétrica',
      displayOrder: 99,
      active: false,
    });
    expect(categories.items.at(-1)).toEqual(
      expect.objectContaining({ id: categoryId, active: false }),
    );
    expect(listed.items).toEqual([
      expect.objectContaining({ id: expense.id, categoryName: 'Energia elétrica' }),
    ]);
    const [entry] = await audits('expense_category.update');
    expect(entry).toMatchObject({
      before: { active: true },
      after: { name: 'Energia elétrica', displayOrder: 99, active: false },
    });
  });
});

describe('access and MCP tools', () => {
  it('answers 403 to tenants and reception', async () => {
    const reception = await createStaff(db, 'reception', NOW);
    const tenant = await createTenant(db, { now: NOW });

    const results = [
      await call(reception.cookie, 'GET', '/admin/finance/expenses'),
      await call(reception.cookie, 'POST', '/admin/finance/expenses', expenseBody()),
      await call(reception.cookie, 'GET', '/admin/finance/expense-categories'),
      await call(tenant.cookie, 'GET', '/admin/finance/expenses'),
    ];

    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(await db.select().from(expenses)).toHaveLength(0);
  });

  it('expense_create and expense_delete work through MCP, the delete only with confirm', async () => {
    await withTransaction(db, (tx) => saveSetting(tx, 'mcp.enabled', true, null));
    const admin = await createStaff(db, 'admin', NOW);
    const token = (
      await call(admin.cookie, 'POST', '/admin/integrations/mcp/tokens', {
        name: 'Assistente',
        scope: 'read_write',
      })
    ).body as { token: string };
    const client = await connectMcp(buildApp(), token.token);

    const created = await client.callTool({ name: 'expense_create', arguments: expenseBody() });
    const id = (created.structuredContent as { id: string }).id;
    const unconfirmed = await client.callTool({
      name: 'expense_delete',
      arguments: { expenseId: id },
    });
    const listed = await client.callTool({
      name: 'expenses_list',
      arguments: { from: '2027-03-01', to: '2027-03-31' },
    });
    const deleted = await client.callTool({
      name: 'expense_delete',
      arguments: { expenseId: id, confirm: true },
    });
    await client.close();

    expect(created.isError).toBeFalsy();
    expect(toolErrorOf(unconfirmed).code).toBe('CONFIRMATION_REQUIRED');
    expect((toolErrorOf(unconfirmed).details as { preview: string }).preview).toContain(
      '"Conta de energia"',
    );
    expect(
      (listed.structuredContent as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual([id]);
    expect(deleted.structuredContent).toMatchObject({ deleted: true });
    const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
    expect(row?.deletedAt).not.toBeNull();
    expect((await audits('expense.create'))[0]?.origin).toBe('mcp');
    expect((await audits('expense.delete'))[0]?.origin).toBe('mcp');
  });
});
