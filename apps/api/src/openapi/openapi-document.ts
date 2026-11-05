import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ErrorBody, ErrorDetail, ErrorEnvelope } from '../http/error-envelope.dto';

/** Keep in sync with apps/api/package.json (a test enforces it). */
export const API_VERSION = '0.1.0';

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
    .build();
  return SwaggerModule.createDocument(app, options, {
    extraModels: [ErrorEnvelope, ErrorBody, ErrorDetail],
  });
}
