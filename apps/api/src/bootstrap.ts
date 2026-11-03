import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigValidationError, loadApiConfig, type ApiConfig } from './config/api-config';

export async function bootstrap(config: ApiConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config));
  app.enableCors({ origin: config.allowedOrigins });
  await app.listen(config.port);
  console.log(`NestJS API is running on port ${config.port} (${config.nodeEnv})`);
  return app;
}

/**
 * Validates `env` before creating the application. An invalid configuration is
 * reported on stderr and terminates the process with exit code 1.
 */
export async function start(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  exit: (code: number) => void,
): Promise<INestApplication | undefined> {
  let config: ApiConfig;
  try {
    config = loadApiConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      exit(1);
      return undefined;
    }
    throw error;
  }
  return bootstrap(config);
}
