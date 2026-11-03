import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from './config/api-config';
import { ApiConfigModule } from './config/config.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiConfigModule.forRoot(config)],
    };
  }
}
