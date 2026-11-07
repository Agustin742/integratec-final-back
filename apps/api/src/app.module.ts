import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import type { ApiConfig } from './config/api-config';
import { ApiConfigModule } from './config/config.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  controllers: [HealthController],
})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiConfigModule.forRoot(config), PrismaModule, AuthModule, UsersModule],
    };
  }
}
