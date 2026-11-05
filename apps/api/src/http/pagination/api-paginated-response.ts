import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination-query.dto';

/**
 * Documents a 200 response shaped `{ items: ItemDto[], page, pageSize, total }`.
 * The envelope is inlined (not a generic class) because Swagger cannot name
 * generics; only the item schema is a reusable component.
 */
export function ApiPaginatedResponse<T extends Type<unknown>>(itemDto: T) {
  return applyDecorators(
    ApiExtraModels(itemDto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'page', 'pageSize', 'total'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(itemDto) } },
          page: { type: 'integer', minimum: 1, example: 1 },
          pageSize: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PAGE_SIZE,
            example: DEFAULT_PAGE_SIZE,
          },
          total: {
            type: 'integer',
            minimum: 0,
            example: 42,
            description: 'Item count across all pages.',
          },
        },
      },
    }),
  );
}
