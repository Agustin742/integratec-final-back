import type { INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { ApiConfig } from '../config/api-config';
import { buildOpenApiDocument } from './openapi-document';

export const OPENAPI_JSON_ROUTE = '/docs/openapi.json';
export const DOCS_UI_ROUTE = '/docs';

/**
 * Serves the OpenAPI JSON and the Scalar reference UI, but ONLY outside
 * production. In production neither route is registered, so both fall through
 * to the regular 404 error envelope and the API surface is not advertised.
 * The committed `apps/api/openapi.json` is the contract artifact for consumers.
 */
export function mountApiDocs(app: INestApplication, config: Pick<ApiConfig, 'nodeEnv'>): void {
  if (config.nodeEnv === 'production') {
    return;
  }
  const document = buildOpenApiDocument(app);
  const http = app.getHttpAdapter();
  http.get(OPENAPI_JSON_ROUTE, (_req: unknown, res: { json: (body: unknown) => void }) =>
    res.json(document),
  );
  http.get(DOCS_UI_ROUTE, apiReference({ url: OPENAPI_JSON_ROUTE }));
}
