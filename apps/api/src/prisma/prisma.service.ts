import { Injectable, OnModuleInit, OnModuleDestroy, Optional, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { API_CONFIG } from '../config/config.module';
import type { ApiConfig } from '../config/api-config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Optional() @Inject(API_CONFIG) config?: ApiConfig) {
    super(
      config
        ? {
            datasources: {
              db: { url: config.databaseUrl },
            },
          }
        : undefined,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
