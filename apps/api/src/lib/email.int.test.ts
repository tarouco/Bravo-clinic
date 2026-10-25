import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from '../db/client';
import { emailOutbox } from '../db/schema';
import { parseEnv } from '../env';
import { passwordResetTemplate } from '../emails/templates/password-reset';
import { verifyEmailTemplate } from '../emails/templates/verify-email';
import { dispatchEmails, queueEmail } from './email';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const envWithKey = parseEnv({ ...process.env, RESEND_API_KEY: 're_test_key' });
const envWithoutKey = parseEnv({ ...process.env, RESEND_API_KEY: undefined });

const message = {
  to: 'ana@bravoclinic.test',
  template: 'auth.verify_email',
  subject: 'Confirme seu e-mail na Bravô Clinic',
  html: '<p>Olá</p>',
  text: 'Olá',
};

async function queueOne(): Promise<string> {
  return withTransaction(db, (tx) => queueEmail(tx, message));
}

async function rowOf(id: string) {
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
  if (row === undefined) throw new Error('outbox row missing');
  return row;
}

describe('queueEmail (FND-77)', () => {
  it('writes a pending row with recipient, template, subject, html and text on commit', async () => {
    const id = await queueOne();

    expect(await rowOf(id)).toMatchObject({
      toAddress: 'ana@bravoclinic.test',
      template: 'auth.verify_email',
      subject: 'Confirme seu e-mail na Bravô Clinic',
      html: '<p>Olá</p>',
      textBody: 'Olá',
      status: 'pending',
      attempts: 0,
    });
  });

  it('writes nothing when the transaction rolls back', async () => {
    await expect(
      withTransaction(db, async (tx) => {
        await queueEmail(tx, message);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });
});

describe('dispatchEmails', () => {
  it('sends through Resend and records sent + provider id (FND-78)', async () => {
    const id = await queueOne();
    const fetchStub = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ id: 'em_1' })));

    await dispatchEmails(db, [id], {
      env: envWithKey,
      fetch: fetchStub,
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      from: envWithKey.EMAIL_FROM,
      to: ['ana@bravoclinic.test'],
      subject: 'Confirme seu e-mail na Bravô Clinic',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const row = await rowOf(id);
    expect(row.status).toBe('sent');
    expect(row.providerMessageId).toBe('em_1');
    expect(row.sentAt).not.toBeNull();
  });

  it('marks not_sent and never calls fetch when RESEND_API_KEY is absent (FND-79)', async () => {
    const id = await queueOne();
    const fetchStub = vi.fn<typeof fetch>();

    await dispatchEmails(db, [id], {
      env: envWithoutKey,
      fetch: fetchStub,
    });

    expect(fetchStub).not.toHaveBeenCalled();
    expect((await rowOf(id)).status).toBe('not_sent');
  });

  it('marks failed with attempts 1 and a last_error when fetch rejects, without throwing (FND-80)', async () => {
    const id = await queueOne();
    const fetchStub = vi.fn<typeof fetch>(() => Promise.reject(new Error('network down')));

    await expect(
      dispatchEmails(db, [id], { env: envWithKey, fetch: fetchStub }),
    ).resolves.toBeUndefined();

    const row = await rowOf(id);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('network down');
  });

  it('marks failed when the provider answers 500, without throwing (FND-80)', async () => {
    const id = await queueOne();
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('upstream broke', { status: 500 })),
    );

    await expect(
      dispatchEmails(db, [id], { env: envWithKey, fetch: fetchStub }),
    ).resolves.toBeUndefined();

    const row = await rowOf(id);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('500');
    expect(row.lastError).not.toBe('');
  });
});

describe('auth templates', () => {
  it('verify template has the pt-BR subject and the link in html and text', () => {
    const link = 'https://app.bravoclinic.test/verificar-email?token=abc';

    const rendered = verifyEmailTemplate({ name: 'Ana', link });

    expect(rendered.subject).toBe('Confirme seu e-mail na Bravô Clinic');
    expect(rendered.html).toContain(link);
    expect(rendered.text).toContain(link);
  });

  it('password reset template has its subject and the link', () => {
    const link = 'https://app.bravoclinic.test/redefinir-senha?token=abc';

    const rendered = passwordResetTemplate({ name: 'Ana', link });

    expect(rendered.subject).toBe('Redefina sua senha na Bravô Clinic');
    expect(rendered.html).toContain(link);
  });
});
