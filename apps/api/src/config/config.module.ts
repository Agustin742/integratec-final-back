import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from './api-config';

/** Injection token for the validated {@link ApiConfig}. */
export const API_CONFIG = Symbol('API_CONFIG');

@Global()
@Module({})
export class ApiConfigModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: ApiConfigModule,
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}
