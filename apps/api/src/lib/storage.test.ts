import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireJson } from '../middleware/require-json';
import type { AppEnv } from '../types';
import { AppError, onError } from './errors';
import { createS3Storage, memoryStorage, readBinaryBody } from './storage';

const s3 = vi.hoisted(() => ({
  configs: [] as unknown[],
  send: vi.fn(),
  presign: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      constructor(config: unknown) {
        s3.configs.push(config);
      }
      send = s3.send;
    },
    PutObjectCommand: class extends Command {},
    HeadObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {},
    GetObjectCommand: class extends Command {},
    ListObjectsV2Command: class extends Command {},
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: s3.presign }));

const MiB = 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function withPrefix(prefix: number[], size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(prefix);
  return bytes;
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
const EXE = [0x4d, 0x5a, 0x90, 0x00];

/** A route that reads the upload and answers its size and media type. */
function uploadApp() {
  const app = new Hono<AppEnv>();
  app.put('/upload', async (c) => {
    const { bytes, contentType } = await readBinaryBody(c, { allowed: ALLOWED });
    return c.json({ size: bytes.byteLength, contentType });
  });
  app.onError(onError);
  return app;
}

async function upload(body: Uint8Array, headers: Record<string, string>) {
  const res = await uploadApp().request('/upload', { method: 'PUT', body, headers });
  return {
    status: res.status,
    body: (await res.json()) as { size?: number; error?: { code: string; message: string } },
  };
}

/** A body that reports no length up front, so only the streamed byte count can catch it. */
function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.byteLength; offset += MiB) {
        controller.enqueue(bytes.slice(offset, offset + MiB));
      }
      controller.close();
    },
  });
}

describe('readBinaryBody (GES-17, GES-106)', () => {
  it.each([
    ['application/pdf', PDF],
    ['image/jpeg', JPEG],
    ['image/png', PNG],
    ['image/webp', WEBP],
  ])('accepts a %s file whose magic bytes match', async (type, magic) => {
    const result = await upload(withPrefix(magic), { 'Content-Type': type });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ size: 64, contentType: type });
  });

  it('rejects an .exe labelled application/pdf with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const result = await upload(withPrefix(EXE), { 'Content-Type': 'application/pdf' });

    expect(result.status).toBe(415);
    expect(result.body.error).toEqual({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Formato não suportado',
      requestId: undefined,
    });
  });

  it('rejects a media type outside the allowed list with 415', async () => {
    const gif = withPrefix([0x47, 0x49, 0x46, 0x38]);
    const result = await upload(gif, { 'Content-Type': 'image/gif' });

    expect(result.status).toBe(415);
    expect(result.body.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('accepts exactly 5 MiB and rejects 5 MiB + 1 byte with 413 PAYLOAD_TOO_LARGE', async () => {
    const exact = await upload(withPrefix(PDF, 5 * MiB), { 'Content-Type': 'application/pdf' });
    const over = await upload(withPrefix(PDF, 5 * MiB + 1), {
      'Content-Type': 'application/pdf',
    });

    expect(exact.status).toBe(200);
    expect(exact.body.size).toBe(5 * MiB);
    expect(over.status).toBe(413);
    expect(over.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Arquivo maior que 5 MB',
    });
  });

  it('rejects by Content-Length before reading, and by streamed size without one', async () => {
    const declared = await upload(withPrefix(PDF), {
      'Content-Type': 'application/pdf',
      'Content-Length': String(5 * MiB + 1),
    });
    const streamed = await uploadApp().request('/upload', {
      method: 'PUT',
      body: stream(withPrefix(PDF, 5 * MiB + 1)),
      headers: { 'Content-Type': 'application/pdf' },
      duplex: 'half',
    });

    expect(declared.status).toBe(413);
    expect(streamed.status).toBe(413);
  });
});

describe('requireJson exemption for binary uploads (AD-026)', () => {
  function guarded() {
    const app = new Hono<AppEnv>();
    app.use('*', requireJson());
    app.put('*', (c) => c.json({ ok: true }));
    app.onError(onError);
    return app;
  }

  it('lets raw bodies through on the expense attachment and room photo upload routes', async () => {
    const app = guarded();
    const attachment = await app.request('/admin/finance/expenses/e1/attachment', {
      method: 'PUT',
      body: withPrefix(PDF),
      headers: { 'Content-Type': 'application/pdf' },
    });
    const photo = await app.request('/admin/rooms/r1/photo-uploads/u1/large', {
      method: 'PUT',
      body: withPrefix(WEBP),
      headers: { 'Content-Type': 'image/webp' },
    });

    expect(attachment.status).toBe(200);
    expect(photo.status).toBe(200);
  });

  it('still requires JSON on every other mutating route', async () => {
    const app = guarded();
    const other = await app.request('/admin/finance/expenses/e1', {
      method: 'PUT',
      body: withPrefix(PDF),
      headers: { 'Content-Type': 'application/pdf' },
    });

    expect(other.status).toBe(415);
  });
});

describe('createS3Storage (AD-026)', () => {
  const env = {
    AWS_ACCESS_KEY_ID: 'key-id',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_ENDPOINT_URL_S3: 'https://storage.example',
    AWS_REGION: 'us-east-2',
  };

  beforeEach(() => {
    // Provider failures are logged as JSON lines; keep the test output clean.
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    s3.configs.length = 0;
    s3.send.mockReset();
    s3.presign.mockReset();
  });

  it('builds the client with forcePathStyle and the injected endpoint, region and keys', async () => {
    s3.send.mockResolvedValue({});
    await createS3Storage(env).put('room-photos', 'rooms/r1/u1-large.webp', withPrefix(WEBP), {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    expect(s3.configs).toEqual([
      {
        forcePathStyle: true,
        endpoint: 'https://storage.example',
        region: 'us-east-2',
        credentials: { accessKeyId: 'key-id', secretAccessKey: 'secret' },
      },
    ]);
    const [command] = s3.send.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(command.input).toMatchObject({
      Bucket: 'room-photos',
      Key: 'rooms/r1/u1-large.webp',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('presigns a GET with the requested expiry and download name', async () => {
    s3.presign.mockResolvedValue('https://storage.example/signed');
    const url = await createS3Storage(env).presignGet(
      'expense-attachments',
      'expenses/e1/f1',
      300,
      'nota.pdf',
    );

    expect(url).toBe('https://storage.example/signed');
    const [, command, options] = s3.presign.mock.calls[0] as [
      unknown,
      { input: Record<string, unknown> },
      { expiresIn: number },
    ];
    expect(options).toEqual({ expiresIn: 300 });
    expect(command.input).toMatchObject({
      Bucket: 'expense-attachments',
      Key: 'expenses/e1/f1',
      ResponseContentDisposition: `attachment; filename="nota.pdf"; filename*=UTF-8''nota.pdf`,
    });
  });

  it('answers null for a missing object and 503 STORAGE_UNAVAILABLE for a provider failure', async () => {
    const storage = createS3Storage(env);
    s3.send.mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NotFound' }));
    s3.send.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    expect(await storage.head('room-photos', 'missing')).toBeNull();
    await expect(storage.head('room-photos', 'other')).rejects.toMatchObject({
      status: 503,
      code: 'STORAGE_UNAVAILABLE',
    });
  });

  it('fails every call with 503 when the AWS_* variables are absent', async () => {
    const storage = createS3Storage({});

    const error = await storage
      .put('room-photos', 'k', withPrefix(WEBP), { contentType: 'image/webp' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 503, code: 'STORAGE_UNAVAILABLE' });
    expect(s3.configs).toHaveLength(0);
  });

  it('sums object sizes across pages up to maxObjects', async () => {
    s3.send
      .mockResolvedValueOnce({
        Contents: [{ Size: 100 }, { Size: 200 }],
        IsTruncated: true,
        NextContinuationToken: 't1',
      })
      .mockResolvedValueOnce({ Contents: [{ Size: 300 }, { Size: 400 }], IsTruncated: false });

    expect(await createS3Storage(env).totalBytes('room-photos')).toBe(1000);
    s3.send.mockResolvedValueOnce({
      Contents: [{ Size: 100 }, { Size: 200 }, { Size: 300 }],
      IsTruncated: true,
      NextContinuationToken: 't2',
    });
    expect(await createS3Storage(env).totalBytes('room-photos', 2)).toBe(300);
  });
});

describe('memoryStorage', () => {
  it('puts, heads, deletes and totals objects per bucket', async () => {
    const storage = memoryStorage();
    await storage.put('room-photos', 'a', new Uint8Array(10), { contentType: 'image/webp' });
    await storage.put('room-photos', 'b', new Uint8Array(5), { contentType: 'image/webp' });
    await storage.put('expense-attachments', 'a', new Uint8Array(7), {
      contentType: 'application/pdf',
    });

    expect(await storage.head('room-photos', 'a')).toEqual({ size: 10 });
    expect(await storage.head('room-photos', 'missing')).toBeNull();
    expect(await storage.totalBytes('room-photos')).toBe(15);
    expect(await storage.totalBytes('expense-attachments')).toBe(7);

    await storage.delete('room-photos', 'a');
    expect(await storage.head('room-photos', 'a')).toBeNull();
    expect(await storage.totalBytes('room-photos')).toBe(5);
    expect(await storage.presignGet('expense-attachments', 'a', 300)).toContain('expires=300');
  });
});
