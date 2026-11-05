import { Module } from '@nestjs/common';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE_PORT } from './storage.port';

/**
 * Binds {@link STORAGE_PORT} to the S3 adapter. Import it in the module that
 * needs object storage; relies on the global `ApiConfigModule`.
 */
@Module({
  providers: [S3StorageAdapter, { provide: STORAGE_PORT, useExisting: S3StorageAdapter }],
  exports: [STORAGE_PORT],
})
export class StorageModule {}
