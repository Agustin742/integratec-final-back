import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import { EMAIL_PORT, type EmailPort } from './email.port';
import { InMemoryEmailAdapter } from './in-memory-email.adapter';
import { SmtpEmailAdapter } from './smtp-email.adapter';

@Module({
  providers: [
    InMemoryEmailAdapter,
    SmtpEmailAdapter,
    {
      provide: EMAIL_PORT,
      useFactory: (
        config: ApiConfig,
        inMemory: InMemoryEmailAdapter,
        smtp: SmtpEmailAdapter,
      ): EmailPort => {
        if (config.emailProvider === 'smtp') {
          return smtp;
        }
        if (config.emailProvider === 'memory') {
          return inMemory;
        }
        throw new Error(`Unsupported email provider: ${config.emailProvider}`);
      },
      inject: [API_CONFIG, InMemoryEmailAdapter, SmtpEmailAdapter],
    },
  ],
  exports: [EMAIL_PORT, InMemoryEmailAdapter, SmtpEmailAdapter],
})
export class EmailModule {}
