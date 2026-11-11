import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { requireTestDatabaseUrl } from '../../test/require-test-db';
import { createDb, withTransaction } from '../db/client';
import { emailOutbox } from '../db/schema';
import { parseEnv } from '../env';
import { mfaCodeTemplate } from '../emails/templates/mfa-code';
import { passwordResetTemplate } from '../emails/templates/password-reset';
import { verifyEmailTemplate } from '../emails/templates/verify-email';
import { dispatchEmails, emailProvider, queueEmail } from './email';

const { pool, db } = createDb(requireTestDatabaseUrl(process.env));

afterAll(async () => {
  await pool.end();
});

const noProvider = { SENDKIT_API_KEY: undefined, RESEND_API_KEY: undefined };
const envWithKey = parseEnv({ ...process.env, ...noProvider, RESEND_API_KEY: 're_test_key' });
const envWithoutKey = parseEnv({ ...process.env, ...noProvider });
const envWithSendkit = parseEnv({ ...process.env, ...noProvider, SENDKIT_API_KEY: 'sk_test_key' });

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

  it('sends through SendKit when SENDKIT_API_KEY is set and records sent + provider id (AD-046)', async () => {
    const id = await withTransaction(db, (tx) =>
      queueEmail(tx, {
        ...message,
        attachments: [
          { filename: 'reserva.ics', contentType: 'text/calendar', contentBase64: 'QkVHSU4=' },
        ],
      }),
    );
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ id: 'sk_em_1' }, { status: 202 })),
    );

    await dispatchEmails(db, [id], { env: envWithSendkit, fetch: fetchStub });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe('https://api.sendkit.dev/emails');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_key');
    expect(JSON.parse(init?.body as string)).toEqual({
      from: `Bravô Clinic <${envWithSendkit.EMAIL_FROM}>`,
      to: 'ana@bravoclinic.test',
      subject: 'Confirme seu e-mail na Bravô Clinic',
      html: '<p>Olá</p>',
      text: 'Olá',
      attachments: [
        { filename: 'reserva.ics', content: 'QkVHSU4=', content_type: 'text/calendar' },
      ],
    });
    const row = await rowOf(id);
    expect(row.status).toBe('sent');
    expect(row.providerMessageId).toBe('sk_em_1');
    expect(row.sentAt).not.toBeNull();
  });

  it('marks failed with the SendKit error when it refuses the message, e.g. an unverified domain (AD-046)', async () => {
    const id = await queueOne();
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json(
          { name: 'validation_error', message: 'The domain is not verified.' },
          { status: 422 },
        ),
      ),
    );

    await dispatchEmails(db, [id], { env: envWithSendkit, fetch: fetchStub });

    const row = await rowOf(id);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('SendKit responded 422');
    expect(row.lastError).toContain('The domain is not verified.');
  });

  it('prefers SendKit over Resend when both keys are set, and has no provider without keys (AD-046)', () => {
    const both = parseEnv({
      ...process.env,
      SENDKIT_API_KEY: 'sk_test_key',
      RESEND_API_KEY: 're_test_key',
    });

    expect(emailProvider(both)).toEqual({ name: 'sendkit', apiKey: 'sk_test_key' });
    expect(emailProvider(envWithKey)).toEqual({ name: 'resend', apiKey: 're_test_key' });
    expect(emailProvider(envWithoutKey)).toBeNull();
  });

  it('marks not_sent and never calls fetch when no provider key is set (FND-79)', async () => {
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

  it('aborts a hung provider call after 10 000 ms and marks the row failed (FND-80)', async () => {
    const id = await queueOne();
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetchStub = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation timed out.', 'TimeoutError'));
          });
        }),
    );

    try {
      const dispatched = dispatchEmails(db, [id], { env: envWithKey, fetch: fetchStub });
      await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));
      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      expect(fetchStub.mock.calls[0]?.[1]?.signal).toBe(controller.signal);

      controller.abort();
      await expect(dispatched).resolves.toBeUndefined();
    } finally {
      timeoutSpy.mockRestore();
    }

    const row = await rowOf(id);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('timed out');
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

  it('two-factor code template shows the code and its lifetime, with no link or button (FND-138)', () => {
    const rendered = mfaCodeTemplate({ name: 'Ana <b>', code: '042917', minutes: 10 });

    expect(rendered.subject).toBe('Seu código de verificação na Bravô Clinic');
    expect(rendered.html).toContain('>042917</p>');
    expect(rendered.html).toContain('Olá, Ana &lt;b&gt;!');
    expect(rendered.html).toContain('vale por 10 minutos');
    expect(rendered.html).not.toContain('<a ');
    expect(rendered.html).not.toContain('copie e cole este link');
    expect(rendered.text.split('\n')).toContain('042917');
    expect(rendered.text).not.toContain('undefined');
  });
});
