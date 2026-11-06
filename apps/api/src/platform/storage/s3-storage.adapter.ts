import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { MAX_SIGNED_URL_TTL_SECONDS, type ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import {
  StorageObjectNotFoundError,
  assertSafeStorageKey,
  type SignedDownloadUrlOptions,
  type StoragePort,
  type StoragePutOptions,
  type StoredObject,
} from './storage.port';

/**
 * S3 adapter (AWS S3 in production, MinIO locally). Without configured keys the
 * SDK default provider chain is used, which resolves the EC2 instance role.
 * Logs only the operation and sizes: never keys, contents or signed URLs
 * (the signature in a URL is a credential).
 */
@Injectable()
export class S3StorageAdapter implements StoragePort, OnModuleDestroy {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultTtlSeconds: number;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.bucket = config.s3Bucket;
    this.defaultTtlSeconds = config.storageSignedUrlTtlSeconds;
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: config.s3Credentials,
    });
  }

  async put(key: string, body: Uint8Array, options: StoragePutOptions): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
      }),
    );
    this.logger.log({ operation: 'storage.put', adapter: 's3', sizeBytes: body.byteLength });
  }

  async get(key: string): Promise<StoredObject> {
    assertSafeStorageKey(key);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await response.Body?.transformToByteArray();
      if (!body) throw new Error('Storage response had no body');
      this.logger.log({ operation: 'storage.get', adapter: 's3', sizeBytes: body.byteLength });
      return { body, contentType: response.ContentType };
    } catch (error) {
      if (error instanceof NoSuchKey) throw new StorageObjectNotFoundError();
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log({ operation: 'storage.delete', adapter: 's3' });
  }

  async getSignedDownloadUrl(key: string, options?: SignedDownloadUrlOptions): Promise<string> {
    assertSafeStorageKey(key);
    const expiresIn = options?.expiresInSeconds ?? this.defaultTtlSeconds;
    if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_SIGNED_URL_TTL_SECONDS) {
      throw new RangeError(
        `Signed URL lifetime must be an integer between 1 and ${MAX_SIGNED_URL_TTL_SECONDS} seconds`,
      );
    }
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
    this.logger.log({
      operation: 'storage.signDownloadUrl',
      adapter: 's3',
      expiresInSeconds: expiresIn,
    });
    return url;
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
