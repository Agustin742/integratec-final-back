# REST API conventions

Developer guide to the REST contract baseline implemented in `apps/api` (issue #15). Every endpoint inherits these behaviors; new endpoints should use the pieces below instead of reimplementing them. The binding requirements live in [API contracts](../rules/api-contracts.md) and [Error handling and feedback](../rules/error-handling-and-feedback.md); this page describes what the code does today. All examples use synthetic data.

- [Error envelope](#error-envelope)
- [Validation](#validation)
- [Correlation id and request log](#correlation-id-and-request-log)
- [Pagination and sorting](#pagination-and-sorting)
- [OpenAPI document and API reference](#openapi-document-and-api-reference)
- [Contract-first workflow](#contract-first-workflow)
- [Adding a new endpoint](#adding-a-new-endpoint)

## Error envelope

Every failing request returns the same body (`apps/api/src/http/error-envelope.ts`, filter in `all-exceptions.filter.ts`):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is invalid. Check the details and try again.",
    "details": [{ "field": "name", "messages": ["name must be a string"] }],
    "correlationId": "3f6c2d9e-0000-4000-8000-000000000000"
  }
}
```

`details` is present only for `VALIDATION_FAILED`. `correlationId` equals the `x-request-id` response header.

| `code`                | HTTP status | When                                                                                  |
| --------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`   | 400         | Request DTO validation failed or `sort` is not allowed (carries `details`)            |
| `BAD_REQUEST`         | 400         | Other client errors, such as malformed JSON; an unmapped 4xx keeps its own status     |
| `UNAUTHENTICATED`     | 401         | Missing or invalid credentials                                                        |
| `FORBIDDEN`           | 403         | Authenticated but not allowed                                                         |
| `NOT_FOUND`           | 404         | Resource or route does not exist (also what production returns for `/docs`)           |
| `CONFLICT`            | 409         | Request conflicts with current state                                                  |
| `TOO_MANY_REQUESTS`   | 429         | Rate limited                                                                          |
| `SERVICE_UNAVAILABLE` | 503         | Intentional, expected unavailability (logged as a warning)                            |
| `INTERNAL_ERROR`      | 500         | Any unhandled error (logged as an error with the stack, server side only)             |

Rules for clients and authors:

- **Clients branch on `code`, never on `message`.** Messages are fixed text per code, may be reworded, and are not a contract. Existing codes must not change meaning.
- Exception messages, causes and stacks never reach the client. They go to the server log only.
- To fail from a handler, throw a Nest `HttpException` (for example `NotFoundException`); the filter maps its status to a code.
- If the response headers were already sent, the filter cannot send an envelope; it logs a warning and destroys the connection so a truncated body is not presented as complete.

## Validation

`configureHttp` installs a global `ValidationPipe` (`apps/api/src/http/validation.ts`) with `whitelist`, `forbidNonWhitelisted` and `transform` enabled:

- Properties not declared in the DTO are **rejected** (they are not silently dropped).
- Query and path values are transformed to the DTO's types (for example numbers).
- Failures become `400 VALIDATION_FAILED`, with one `details` entry per invalid field: `field` is the dotted path (`address.city` for nested objects) and `messages` lists every violated constraint.

Every request DTO property therefore needs at least one class-validator decorator, or it counts as unknown.

## Correlation id and request log

`apps/api/src/http/request-context.middleware.ts` runs first on every request.

- **`x-request-id`**: a client may send it; it is reused only if it matches `[A-Za-z0-9._:-]{1,128}`, otherwise the server generates a UUID. It is always returned in the response header and in `error.correlationId`. Quote it when reporting a problem.
- **Request log**: one JSON line on stdout when the response finishes:

  ```json
  {"level":"info","event":"http_request","method":"GET","path":"/classrooms","status":200,"durationMs":12.4,"correlationId":"3f6c2d9e-0000-4000-8000-000000000000"}
  ```

  It contains only method, path (query string removed, truncated to 200 characters), status, duration and correlation id. It **never** contains request or response bodies, headers, cookies or query values. If the client disconnects before the response finishes, the line is logged once with `status` 499 and `"aborted": true`.

See [Observability and privacy](../rules/observability-and-privacy.md) before adding anything to logs.

## Pagination and sorting

List endpoints share `apps/api/src/http/pagination/`.

**Query** (`PaginationQueryDto`; extend it for endpoint-specific filters):

| Parameter  | Default | Limits           | Meaning                                      |
| ---------- | ------- | ---------------- | -------------------------------------------- |
| `page`     | `1`     | integer 1-10000  | 1-based page number                          |
| `pageSize` | `20`    | integer 1-100    | Items per page                               |
| `sort`     | per endpoint | allow-list  | `field` ascending or `-field` descending     |

Out-of-range values are `400 VALIDATION_FAILED`. The page cap exists so a huge `page` is a validation error, not a database driver error.

**Response** (`Paginated<T>`, built with `paginated(items, total, query)`): `{ "items": [...], "page": 1, "pageSize": 20, "total": 42 }`, where `total` counts all pages. Use `toSkipTake(query)` to get the `skip`/`take` pair for the repository.

**Sorting**: each endpoint defines its own allow-list and default and calls `parseSort(query.sort, { allowed: ['createdAt', 'name'], default: { field: 'createdAt', direction: 'desc' } })`. An unknown field throws `400 VALIDATION_FAILED` with a detail on `sort`. The result is plain `{ field, direction }`; the repository maps it to its own `ORDER BY`.

**Stable tiebreaker (required)**: every list query must append a unique tiebreaker, usually `id`, after the requested sort so rows do not shift or repeat between pages.

**Why offset now**: classroom-scale lists are small and offset is the simplest option for the frontend and the API reference's "try it" feature. Cursor pagination can be added later for feeds such as chat without changing the shape of existing endpoints.

## OpenAPI document and API reference

The document is built by one function, `buildOpenApiDocument` (`apps/api/src/openapi/openapi-document.ts`), used by both the running app and the export script, so the served and committed documents cannot diverge. Its version comes from `apps/api/package.json`. The error envelope schemas (`ErrorEnvelopeDto`, `ErrorBodyDto`, `ErrorDetailDto`) are always registered as components.

**Interactive reference**: with the API running outside production, open `/docs` (Scalar UI) or `/docs/openapi.json` (raw document). When `NODE_ENV=production` neither route is registered and both return the normal `404` envelope; the API surface is not advertised. Consumers use the committed file instead.

**Committed contract** ([D8](./technical-justification.md#d8-committed-rest-and-realtime-contract-artifacts)): `apps/api/openapi.json` is tracked in Git.

```bash
# Regenerate after any change to controllers, DTOs or decorators
pnpm openapi:export
```

The command instantiates the module graph with placeholder configuration; it needs no `.env`, port or database. Commit the regenerated file with the code change.

**CI staleness check**: the [`checks` job](../.github/workflows/ci.yml) runs `pnpm openapi:export` and fails with "openapi.json is stale" if `git diff` shows a change. To fix it, run `pnpm openapi:export` locally and commit the result.

**Line endings**: [`.gitattributes`](../.gitattributes) forces `eol=lf` for `apps/api/openapi.json` so the check gives the same result on every operating system. Do not convert it to CRLF. The export output is already formatted with the repository's Prettier config, so `pnpm format:check` accepts it.

## Contract-first workflow

Decision [D9](./technical-justification.md#d9-contract-first-stubs-and-mocking), required by [API contracts](../rules/api-contracts.md): publish each endpoint's DTOs and OpenAPI entry before or together with its implementation. A stub returning `501` is allowed. The frontend builds mocks from the committed `openapi.json`, so merging the contract first unblocks it. Mocks that follow the contract are not evidence of backend integration.

## Adding a new endpoint

1. Write request and response DTOs with class-validator decorators (requests) and `@ApiProperty` (responses). Reuse `PaginationQueryDto` for lists.
2. Add the controller method with `@ApiOperation`, `@ApiOkResponse` (or `ApiPaginatedResponse(ItemDto)` for lists) and the expected failure responses using `ErrorEnvelopeDto`. Start with a `501` stub if the logic is not ready.
3. Throw Nest `HttpException`s for failures; do not build error bodies by hand.
4. For lists, call `parseSort` with an allow-list and add a tiebreaker to the query.
5. Run `pnpm openapi:export` and commit `apps/api/openapi.json` with the change.

```ts
@Get()
@ApiOperation({ summary: 'List example items' })
@ApiPaginatedResponse(ExampleItemDto)
async list(@Query() query: ExampleListQueryDto): Promise<Paginated<ExampleItemDto>> {
  const sort = parseSort(query.sort, {
    allowed: ['name', 'createdAt'],
    default: { field: 'createdAt', direction: 'desc' },
  });
  const { items, total } = await this.examples.list({ ...toSkipTake(query), sort });
  return paginated(items, total, query);
}
```

The repository orders by `sort` and then by `id`. The snippet is illustrative: names such as `ExampleItemDto` and `this.examples` are placeholders, not existing code.
