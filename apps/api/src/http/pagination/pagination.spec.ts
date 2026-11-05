import { Controller, Get, Query, type INestApplication } from '@nestjs/common';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../openapi/openapi-document';
import { configureHttp } from '../configure-http';
import { RequestValidationException } from '../validation';
import { ApiPaginatedResponse } from './api-paginated-response';
import { paginated, toSkipTake } from './paginated';
import { PaginationQueryDto } from './pagination-query.dto';
import { parseSort } from './sort';

@ApiSchema({ name: 'SampleItem' })
class SampleItemDto {
  @ApiProperty({ example: 'item-1' })
  id!: string;

  @ApiProperty({ example: 'Synthetic item' })
  name!: string;
}

const ITEMS: SampleItemDto[] = Array.from({ length: 45 }, (_, i) => ({
  id: `item-${i + 1}`,
  name: `Synthetic item ${i + 1}`,
}));

const SORT_OPTIONS = {
  allowed: ['name', 'createdAt'],
  default: { field: 'createdAt', direction: 'desc' },
} as const;

// Test-only controller: shows how an endpoint combines the three building blocks.
@Controller('sample-items')
class SampleItemsController {
  @Get()
  @ApiPaginatedResponse(SampleItemDto)
  list(@Query() query: PaginationQueryDto) {
    const sort = parseSort(query.sort, SORT_OPTIONS);
    const { skip, take } = toSkipTake(query);
    return { ...paginated(ITEMS.slice(skip, skip + take), ITEMS.length, query), sort };
  }
}

describe('pagination conventions', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SampleItemsController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttp(app, { logSink: () => undefined });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (query: string) => request(app.getHttpServer()).get(`/sample-items${query}`);

  describe('query validation', () => {
    it('applies defaults page=1, pageSize=20 and the endpoint default sort', async () => {
      const res = await get('').expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 45 });
      expect(res.body.items).toHaveLength(20);
      expect(res.body.sort).toEqual({ field: 'createdAt', direction: 'desc' });
    });

    it('coerces string query values to numbers', async () => {
      const res = await get('?page=3&pageSize=20').expect(200);
      expect(res.body).toMatchObject({ page: 3, pageSize: 20, total: 45 });
      expect(res.body.items.map((i: SampleItemDto) => i.id)).toEqual([
        'item-41',
        'item-42',
        'item-43',
        'item-44',
        'item-45',
      ]);
    });

    it.each([
      ['page=0', 'page'],
      ['page=-1', 'page'],
      ['page=1.5', 'page'],
      ['page=abc', 'page'],
      ['page=10001', 'page'],
      ['page=9007199254740993', 'page'],
      ['pageSize=0', 'pageSize'],
      ['pageSize=101', 'pageSize'],
      ['pageSize=2.5', 'pageSize'],
    ])('rejects %s with a VALIDATION_FAILED detail on %s', async (query, field) => {
      const res = await get(`?${query}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([{ field, messages: expect.any(Array) }]);
    });

    it('accepts the boundary pageSize values 1 and 100', async () => {
      await get('?pageSize=1').expect(200);
      await get('?pageSize=100').expect(200);
    });

    it('rejects unknown query parameters', async () => {
      const res = await get('?page=1&colour=red').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([{ field: 'colour', messages: expect.any(Array) }]);
    });
  });

  describe('sort', () => {
    it('parses ascending and descending sort', async () => {
      const asc = await get('?sort=name').expect(200);
      expect(asc.body.sort).toEqual({ field: 'name', direction: 'asc' });
      const desc = await get('?sort=-name').expect(200);
      expect(desc.body.sort).toEqual({ field: 'name', direction: 'desc' });
    });

    it('rejects a field outside the allow-list with a detail on `sort`', async () => {
      const res = await get('?sort=password').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([
        { field: 'sort', messages: [expect.stringContaining('name, createdAt')] },
      ]);
    });
  });

  describe('Swagger helper', () => {
    it('documents the query parameters and the { items, page, pageSize, total } response', () => {
      const doc = buildOpenApiDocument(app);
      const operation = doc.paths['/sample-items']?.get;

      const params = (operation?.parameters ?? []) as { name: string; in: string }[];
      expect(params.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(
        expect.arrayContaining(['page', 'pageSize', 'sort']),
      );

      const schema = (
        operation?.responses?.['200'] as unknown as {
          content: { 'application/json': { schema: Record<string, unknown> } };
        }
      ).content['application/json'].schema;
      expect(schema).toMatchObject({
        type: 'object',
        required: ['items', 'page', 'pageSize', 'total'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/SampleItem' } },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          total: { type: 'integer', minimum: 0 },
        },
      });
      expect(doc.components?.schemas?.SampleItem).toBeDefined();
    });
  });
});

describe('parseSort', () => {
  it('returns the default when sort is absent', () => {
    expect(parseSort(undefined, SORT_OPTIONS)).toEqual({ field: 'createdAt', direction: 'desc' });
  });

  it('parses "field" as ascending and "-field" as descending', () => {
    expect(parseSort('name', SORT_OPTIONS)).toEqual({ field: 'name', direction: 'asc' });
    expect(parseSort('-createdAt', SORT_OPTIONS)).toEqual({
      field: 'createdAt',
      direction: 'desc',
    });
  });

  it('throws a RequestValidationException for an unknown field', () => {
    expect(() => parseSort('-secret', SORT_OPTIONS)).toThrow(RequestValidationException);
    try {
      parseSort('-secret', SORT_OPTIONS);
    } catch (error) {
      expect((error as RequestValidationException).details).toEqual([
        {
          field: 'sort',
          messages: ['sort must be one of: name, createdAt (prefix "-" for descending)'],
        },
      ]);
    }
  });
});

describe('toSkipTake', () => {
  it.each([
    [
      { page: 1, pageSize: 20 },
      { skip: 0, take: 20 },
    ],
    [
      { page: 2, pageSize: 20 },
      { skip: 20, take: 20 },
    ],
    [
      { page: 5, pageSize: 10 },
      { skip: 40, take: 10 },
    ],
  ])('maps %j to %j', (query, expected) => {
    expect(toSkipTake(query)).toEqual(expected);
  });
});

describe('paginated', () => {
  it('builds { items, page, pageSize, total }', () => {
    expect(paginated(['a', 'b'], 7, { page: 2, pageSize: 2 })).toEqual({
      items: ['a', 'b'],
      page: 2,
      pageSize: 2,
      total: 7,
    });
  });
});
