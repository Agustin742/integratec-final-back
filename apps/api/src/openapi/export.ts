import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { format, resolveConfig } from 'prettier';
import { AppModule } from '../app.module';
import type { ApiConfig } from '../config/api-config';
import { buildOpenApiDocument } from './openapi-document';

/** Committed contract artifact (Decision D8). */
export const OPENAPI_FILE_PATH = resolve(__dirname, '../../openapi.json');

/**
 * Placeholder configuration used only to instantiate the module graph. The
 * export never listens on a port, connects to a database or reads the
 * environment, so none of these values is real. It deliberately bypasses
 * `loadApiConfig`: real configuration validation is left untouched.
 */
const EXPORT_CONFIG: ApiConfig = {
  nodeEnv: 'development',
  port: 0,
  databaseUrl: 'postgresql://openapi-export.invalid:5432/none',
  accessTokenTtlSeconds: 1,
  refreshTokenTtlSeconds: 1,
  invitationTtlSeconds: 1,
  internalServiceSecret: 'openapi-export-placeholder-not-a-secret',
  allowedOrigins: ['http://localhost'],
};

/** Returns the OpenAPI document as repository-formatted JSON ending with a newline. */
export async function renderOpenApiJson(): Promise<string> {
  const app = await NestFactory.create(AppModule.forRoot(EXPORT_CONFIG), { logger: false });
  try {
    const json = JSON.stringify(buildOpenApiDocument(app));
    // Format with the repo's Prettier config so `pnpm format:check` accepts the file.
    const options = (await resolveConfig(OPENAPI_FILE_PATH)) ?? {};
    return await format(json, { ...options, filepath: OPENAPI_FILE_PATH });
  } finally {
    await app.close();
  }
}
