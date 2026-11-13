import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../../config/api-config';
import { ApiConfigModule } from '../../config/config.module';
import {
  InvalidStorageKeyError,
  STORAGE_PORT,
  StorageObjectNotFoundError,
  type StoragePort,
} from './storage.port';
import { StorageModule } from './storage.module';

// Same approach as outbox.spec.ts: connection settings come from the environment
// (CI sets them) and default to the local MinIO started by docker-compose.yml.
function env(name: string, fallback: string): string {
  const vars = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return vars?.[name] ?? fallback;
}

const config: ApiConfig = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://storage-spec.invalid:5432/none',
  accessTokenTtlSeconds: 1,
  refreshTokenTtlSeconds: 1,
  refreshReuseGraceSeconds: 1,
  passwordResetTtlSeconds: 1,
  passwordResetUrlBase: 'http://localhost/reset',
  invitationTtlSeconds: 1,
  outboxPollIntervalSeconds: 1,
  outboxMaxAttempts: 1,
  realtimeInternalUrl: 'http://localhost:2567',
  internalServiceSecret: 'storage-spec-placeholder-not-a-secret',
  jwtSecret: 'storage-jwt-placeholder-not-a-secret-000000',
  invitationTokenKey: Buffer.alloc(32, 1),
  allowedOrigins: ['http://localhost'],
  s3Bucket: env('S3_BUCKET', 'aula-virtual-dev'),
  s3Region: env('S3_REGION', 'sa-east-1'),
  s3Endpoint: env('S3_ENDPOINT', 'http://localhost:9000'),
  s3ForcePathStyle: true,
  s3Credentials: {
    accessKeyId: env('S3_ACCESS_KEY_ID', 'minioadmin'),
    secretAccessKey: env('S3_SECRET_ACCESS_KEY', 'minioadmin'),
  },
  storageSignedUrlTtlSeconds: 60,
  authDataRetentionSeconds: 2592000,
  authCleanupIntervalSeconds: 86400,
  authCleanupBatchSize: 1000,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('object storage (integration, local MinIO)', () => {
  let moduleRef: TestingModule;
  let storage: StoragePort;
  // Unique per run so parallel runs and leftovers never collide.
  const prefix = `storage-spec/${randomUUID()}`;
  const created: string[] = [];
  const keyFor = (name: string) => {
    const key = `${prefix}/${name}`;
    created.push(key);
    return key;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), StorageModule],
    }).compile();
    storage = moduleRef.get<StoragePort>(STORAGE_PORT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.all(created.map((key) => storage.delete(key)));
    await moduleRef.close();
  });

  it('serves the stored bytes and content type through a signed download URL', async () => {
    const key = keyFor('hello.txt');
    const body = Buffer.from('synthetic classroom material', 'utf8');
    await storage.put(key, body, { contentType: 'text/plain' });

    const url = await storage.getSignedDownloadUrl(key);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);
  });

  it('refuses an expired signed URL', async () => {
    const key = keyFor('short-lived.txt');
    await storage.put(key, Buffer.from('short lived'), { contentType: 'text/plain' });

    const url = await storage.getSignedDownloadUrl(key, { expiresInSeconds: 1 });
    expect((await fetch(url)).status).toBe(200);

    await sleep(2200);
    expect((await fetch(url)).status).toBe(403);
  });

  it('rejects an out-of-range signed URL lifetime', async () => {
    const key = keyFor('ttl.txt');
    for (const expiresInSeconds of [0, -1, 1.5, 3601]) {
      await expect(storage.getSignedDownloadUrl(key, { expiresInSeconds })).rejects.toBeInstanceOf(
        RangeError,
      );
    }
  });

  it('returns the stored object with its content type', async () => {
    const key = keyFor('round-trip.bin');
    const body = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    await storage.put(key, body, { contentType: 'application/octet-stream' });

    const object = await storage.get(key);

    expect(Buffer.from(object.body).equals(Buffer.from(body))).toBe(true);
    expect(object.contentType).toBe('application/octet-stream');
  });

  it('overwrites an existing key', async () => {
    const key = keyFor('overwrite.txt');
    await storage.put(key, Buffer.from('first'), { contentType: 'text/plain' });
    await storage.put(key, Buffer.from('second'), { contentType: 'text/plain' });

    expect(Buffer.from((await storage.get(key)).body).toString('utf8')).toBe('second');
  });

  it('reports a typed not-found for a missing key', async () => {
    await expect(storage.get(`${prefix}/missing.txt`)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('deletes an object and tolerates deleting it again', async () => {
    const key = keyFor('to-delete.txt');
    await storage.put(key, Buffer.from('bye'), { contentType: 'text/plain' });

    await storage.delete(key);

    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it.each([
    ['empty', ''],
    ['leading slash', '/classroom/file.pdf'],
    ['parent segment', 'classroom/../other/file.pdf'],
    ['leading parent segment', '../file.pdf'],
    ['trailing parent segment', 'classroom/..'],
    ['backslash', 'classroom\\file.pdf'],
    ['empty segment', 'classroom//file.pdf'],
    ['control character', 'classroom/file\u0000.pdf'],
    ['too long', 'a'.repeat(1025)],
  ])('rejects an unsafe key (%s) on every operation', async (_label, key) => {
    await expect(storage.put(key, Buffer.from('x'), { contentType: 'text/plain' })).rejects.toThrow(
      InvalidStorageKeyError,
    );
    await expect(storage.get(key)).rejects.toThrow(InvalidStorageKeyError);
    await expect(storage.delete(key)).rejects.toThrow(InvalidStorageKeyError);
    await expect(storage.getSignedDownloadUrl(key)).rejects.toThrow(InvalidStorageKeyError);
  });

  it('accepts dots and spaces inside a segment', async () => {
    const key = keyFor('v1.2/my file..name.txt');
    await expect(
      storage.put(key, Buffer.from('ok'), { contentType: 'text/plain' }),
    ).resolves.toBeUndefined();
  });

  it('logs operations without the object key, contents or signed URL', async () => {
    const logs: unknown[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(message);
    });
    const key = keyFor('log-check.txt');
    await storage.put(key, Buffer.from('secret contents'), { contentType: 'text/plain' });
    const url = await storage.getSignedDownloadUrl(key);
    await storage.get(key);
    await storage.delete(key);

    const output = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(output).not.toContain(key);
    expect(output).not.toContain('secret contents');
    expect(output).not.toContain('X-Amz-Signature');
    expect(output).not.toContain(url);
  });
});
