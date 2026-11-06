import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ErrorBodyDto, ErrorDetailDto, ErrorEnvelopeDto } from '../http/error-envelope.dto';

/**
 * Single source of the API version: apps/api/package.json. Read with a path
 * relative to this file, which resolves in ts-node, vitest and the compiled output
 * (`dist/openapi` -> `../../package.json`) alike; importing the JSON would need
 * `resolveJsonModule` and would change the `dist` layout.
 */
const { version: API_VERSION } = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
) as { version: string };

/**
 * Builds the OpenAPI document of `app`. The running app (docs routes) and the
 * `openapi:export` script both call this, so served and committed documents
 * cannot diverge. The error envelope schemas are registered as reusable
 * components even before an endpoint references them.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const options = new DocumentBuilder()
    .setTitle('Aula Virtual API')
    .setDescription(
      'REST API of Aula Virtual. Every error uses the shared ErrorEnvelope schema; ' +
        'clients branch on error.code.',
    )
    .setVersion(API_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, options, {
    extraModels: [ErrorEnvelopeDto, ErrorBodyDto, ErrorDetailDto],
  });
}
