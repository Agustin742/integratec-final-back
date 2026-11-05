import { Module } from '@nestjs/common';
import { EMAIL_PORT } from './email.port';
import { InMemoryEmailAdapter } from './in-memory-email.adapter';

/** Binds {@link EMAIL_PORT} to the in-memory stub until a provider is chosen. */
@Module({
  providers: [InMemoryEmailAdapter, { provide: EMAIL_PORT, useExisting: InMemoryEmailAdapter }],
  exports: [EMAIL_PORT, InMemoryEmailAdapter],
})
export class EmailModule {}
