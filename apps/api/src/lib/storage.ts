import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppEnv } from '../types';
import { payloadTooLarge, storageUnavailable, unsupportedMediaType } from './errors';
import { logger } from './logger';

// Object storage (AD-026, gestao design "Object storage library"): one place for S3 access and
// binary upload validation. Neon Object Storage speaks S3 with path-style addressing only.

export type BucketName = 'room-photos' | 'expense-attachments';

export interface Storage {
  put(
    bucket: BucketName,
    key: string,
    body: Uint8Array,
    opts: { contentType: string; cacheControl?: string },
  ): Promise<void>;
  /** Size of the object, or null when it does not exist. */
  head(bucket: BucketName, key: string): Promise<{ size: number } | null>;
  delete(bucket: BucketName, key: string): Promise<void>;
  /** Presigned GET URL valid for `expiresInSeconds`; `downloadName` sets the attachment name. */
  presignGet(
    bucket: BucketName,
    key: string,
    expiresInSeconds: number,
    downloadName?: string,
  ): Promise<string>;
  /** Sum of object sizes, counting at most `maxObjects` objects. */
  totalBytes(bucket: BucketName, maxObjects?: number): Promise<number>;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_OBJECTS = 10_000;

type StorageEnv = Pick<
  Env,
  'AWS_ACCESS_KEY_ID' | 'AWS_SECRET_ACCESS_KEY' | 'AWS_ENDPOINT_URL_S3' | 'AWS_REGION'
>;

function logFailure(operation: string, bucket: BucketName, error: unknown): void {
  logger.error('object storage call failed', {
    operation,
    bucket,
    error: { name: (error as Error).name, message: (error as Error).message },
  });
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/** `attachment; filename="..."` with an ASCII fallback and the RFC 5987 UTF-8 name. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Storage on the branch's S3 endpoint; without the injected `AWS_*` vars every call is a 503. */
export function createS3Storage(env: StorageEnv): Storage {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION } = env;
  let client: S3Client | undefined;
  const s3 = (): S3Client => {
    if (
      AWS_ACCESS_KEY_ID === undefined ||
      AWS_SECRET_ACCESS_KEY === undefined ||
      AWS_ENDPOINT_URL_S3 === undefined
    ) {
      throw storageUnavailable();
    }
    client ??= new S3Client({
      forcePathStyle: true,
      endpoint: AWS_ENDPOINT_URL_S3,
      region: AWS_REGION ?? 'us-east-1',
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
    });
    return client;
  };
  /** Runs an S3 call; any provider failure becomes 503 `STORAGE_UNAVAILABLE`. */
  const call = async <T>(operation: string, bucket: BucketName, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (error) {
      logFailure(operation, bucket, error);
      throw storageUnavailable();
    }
  };

  return {
    async put(bucket, key, body, opts) {
      const client = s3();
      await call('put', bucket, () =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: opts.contentType,
            ...(opts.cacheControl !== undefined && { CacheControl: opts.cacheControl }),
          }),
        ),
      );
    },
    async head(bucket, key) {
      const client = s3();
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: res.ContentLength ?? 0 };
      } catch (error) {
        if (isNotFound(error)) return null;
        logFailure('head', bucket, error);
        throw storageUnavailable();
      }
    },
    async delete(bucket, key) {
      const client = s3();
      await call('delete', bucket, () =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      );
    },
    async presignGet(bucket, key, expiresInSeconds, downloadName) {
      const client = s3();
      return call('presign', bucket, () =>
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(downloadName !== undefined && {
              ResponseContentDisposition: contentDisposition(downloadName),
            }),
          }),
          { expiresIn: expiresInSeconds },
        ),
      );
    },
    async totalBytes(bucket, maxObjects = DEFAULT_MAX_OBJECTS) {
      const client = s3();
      let total = 0;
      let counted = 0;
      let token: string | undefined;
      do {
        const page = await call('list', bucket, () =>
          client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              ContinuationToken: token,
              MaxKeys: Math.min(1000, maxObjects - counted),
            }),
          ),
        );
        for (const object of page.Contents ?? []) {
          if (counted >= maxObjects) break;
          total += object.Size ?? 0;
          counted += 1;
        }
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined && counted < maxObjects);
      return total;
    },
  };
}

/** In-memory storage with the same contract, for tests and local development. */
export function memoryStorage(): Storage & {
  objects: Map<string, { body: Uint8Array; contentType: string; cacheControl?: string }>;
} {
  const objects = new Map<
    string,
    { body: Uint8Array; contentType: string; cacheControl?: string }
  >();
  const id = (bucket: BucketName, key: string) => `${bucket}/${key}`;
  return {
    objects,
    put(bucket, key, body, opts) {
      objects.set(id(bucket, key), {
        body: body.slice(),
        contentType: opts.contentType,
        ...(opts.cacheControl !== undefined && { cacheControl: opts.cacheControl }),
      });
      return Promise.resolve();
    },
    head(bucket, key) {
      const object = objects.get(id(bucket, key));
      return Promise.resolve(object === undefined ? null : { size: object.body.byteLength });
    },
    delete(bucket, key) {
      objects.delete(id(bucket, key));
      return Promise.resolve();
    },
    presignGet(bucket, key, expiresInSeconds, downloadName) {
      const params = new URLSearchParams({ expires: String(expiresInSeconds) });
      if (downloadName !== undefined) params.set('name', downloadName);
      return Promise.resolve(`https://storage.invalid/${bucket}/${key}?${params.toString()}`);
    },
    totalBytes(bucket, maxObjects = DEFAULT_MAX_OBJECTS) {
      const sizes = [...objects.entries()]
        .filter(([name]) => name.startsWith(`${bucket}/`))
        .slice(0, maxObjects)
        .map(([, object]) => object.body.byteLength);
      return Promise.resolve(sizes.reduce((sum, size) => sum + size, 0));
    },
  };
}

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  // %PDF-
  'application/pdf': (b) =>
    b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  // RIFF....WEBP
  'image/webp': (b) =>
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
};

/** True when `bytes` start with the signature of `contentType`. */
export function matchesMagicBytes(contentType: string, bytes: Uint8Array): boolean {
  return MAGIC[contentType]?.(bytes) === true;
}

/**
 * Reads a raw upload body (AD-026, GES-17, GES-106): the media type must be in `allowed` and match
 * the file's magic bytes (415 `UNSUPPORTED_MEDIA_TYPE`), and the body must not exceed `maxBytes`
 * by `Content-Length` or by the bytes actually streamed (413 `PAYLOAD_TOO_LARGE`).
 */
export async function readBinaryBody(
  c: Context<AppEnv>,
  opts: { maxBytes?: number; allowed: string[] },
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  const contentType = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!opts.allowed.includes(contentType)) throw unsupportedMediaType();
  const declared = Number(c.req.header('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge(maxBytes);

  const chunks: Uint8Array[] = [];
  let size = 0;
  const body = c.req.raw.body;
  if (body !== null) {
    const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!matchesMagicBytes(contentType, bytes)) throw unsupportedMediaType();
  return { bytes, contentType };
}
