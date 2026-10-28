import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStaff } from '../../../test/booking-helpers';
import { forbiddenFetch, send, testEnv } from '../../../test/http';
import { requireTestDatabaseUrl } from '../../../test/require-test-db';
import { createApp } from '../../app';
import { createDb, withTransaction } from '../../db/client';
import { emailOutbox } from '../../db/schema';
import { runSeed } from '../../db/seed';
import { memoryStorage, type Storage } from '../../lib/storage';
import { saveSetting } from '../../modules/settings/settings.repo';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

// 2027-03-10 12:00 in São Paulo.
const NOW = new Date('2027-03-10T15:00:00.000Z');

beforeEach(async () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runSeed(db);
});

const buildApp = (storage: Storage) =>
  createApp({ db, now: () => NOW, fetch: forbiddenFetch, env: testEnv(), storage });

async function filledStorage() {
  const storage = memoryStorage();
  await storage.put('room-photos', 'rooms/a/1-large.webp', new Uint8Array(3000), {
    contentType: 'image/webp',
  });
  await storage.put('room-photos', 'rooms/a/1-small.webp', new Uint8Array(1000), {
    contentType: 'image/webp',
  });
  await storage.put('expense-attachments', 'expenses/e/1', new Uint8Array(500), {
    contentType: 'application/pdf',
  });
  return storage;
}

async function sentEmails() {
  const mail = (sentAt: string) => ({
    toAddress: 'a@x.test',
    template: 'system.test',
    subject: 'S',
    html: '',
    textBody: '',
    status: 'sent',
    sentAt: new Date(sentAt),
  });
  await db.insert(emailOutbox).values([
    mail('2027-03-10T14:00:00Z'), // today (11:00 BRT)
    mail('2027-03-10T02:30:00Z'), // 23:30 BRT on 09/03: this month, not today
    mail('2027-03-01T03:30:00Z'), // 00:30 BRT on 01/03: this month
    mail('2027-03-01T02:30:00Z'), // 23:30 BRT on 28/02: last month
    { ...mail('2027-03-10T13:00:00Z'), status: 'failed', sentAt: null },
  ]);
}

describe('GET /admin/usage (GES-137)', () => {
  it('reports database size, the 10 largest tables, bucket bytes and e-mails against the limits', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await sentEmails();

    const res = await send(buildApp(await filledStorage()), 'GET', '/admin/usage', {
      cookie: admin.cookie,
    });

    expect(res.status).toBe(200);
    const body = res.body as {
      db: { bytes: number; limitBytes: number; percent: number; warning: boolean };
      storage: Record<string, unknown>;
      emails: Record<string, unknown>;
      largestTables: { name: string; totalBytes: number; estimatedRows: number }[];
    };
    expect(body.db.bytes).toBeGreaterThan(0);
    expect(body.db).toEqual({
      bytes: body.db.bytes,
      limitBytes: 536_870_912,
      percent: Math.round((body.db.bytes / 536_870_912) * 1000) / 10,
      warning: body.db.bytes / 536_870_912 >= 0.8,
    });
    expect(body.storage).toEqual({
      buckets: { 'room-photos': 4000, 'expense-attachments': 500 },
      bytes: 4500,
      limitBytes: 1_073_741_824,
      percent: 0,
      warning: false,
    });
    expect(body.emails).toEqual({
      month: 3,
      monthLimit: 3000,
      today: 1,
      dayLimit: 100,
      warning: false,
    });
    expect(body.largestTables).toHaveLength(10);
    const sizes = body.largestTables.map((t) => t.totalBytes);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(body.largestTables.every((t) => t.name.length > 0 && t.estimatedRows >= 0)).toBe(true);
  });
});

describe('usage warnings (GES-138)', () => {
  it('flags warning: true at 80 % or more of a limit set below the current usage', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    await sentEmails();
    await withTransaction(db, (tx) =>
      saveSetting(
        tx,
        'usage.limits',
        { dbBytes: 1024, storageBytes: 5000, emailsPerMonth: 3000, emailsPerDay: 1 },
        null,
      ),
    );

    const res = await send(buildApp(await filledStorage()), 'GET', '/admin/usage', {
      cookie: admin.cookie,
    });

    const body = res.body as {
      db: { percent: number; warning: boolean };
      storage: { percent: number; warning: boolean };
      emails: { warning: boolean };
    };
    expect(body.db.percent).toBeGreaterThan(100);
    expect(body.db.warning).toBe(true);
    // 4500 of 5000 bytes = 90 %.
    expect([body.storage.percent, body.storage.warning]).toEqual([90, true]);
    // 1 of 1 e-mail today.
    expect(body.emails.warning).toBe(true);
  });
});

describe('usage with storage down (GES-139)', () => {
  it('answers storage.buckets null with storageError and still the other figures', async () => {
    const admin = await createStaff(db, 'admin', NOW);
    const broken: Storage = {
      ...memoryStorage(),
      totalBytes: () => Promise.reject(new Error('ListObjectsV2 failed')),
    };

    const res = await send(buildApp(broken), 'GET', '/admin/usage', { cookie: admin.cookie });

    expect(res.status).toBe(200);
    const body = res.body as {
      db: { bytes: number };
      storage: Record<string, unknown>;
      largestTables: unknown[];
    };
    expect(body.storage).toEqual({
      buckets: null,
      bytes: null,
      limitBytes: 1_073_741_824,
      percent: null,
      warning: false,
      storageError: 'Não foi possível consultar o armazenamento de arquivos.',
    });
    expect(body.db.bytes).toBeGreaterThan(0);
    expect(body.largestTables).toHaveLength(10);
  });

  it('is admin only: reception gets 403', async () => {
    const reception = await createStaff(db, 'reception', NOW);

    const res = await send(buildApp(memoryStorage()), 'GET', '/admin/usage', {
      cookie: reception.cookie,
    });

    expect([res.status, res.error?.code]).toEqual([403, 'FORBIDDEN']);
  });
});
