import { EventEmitter } from 'node:events';
import {
  type ArgumentsHost,
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Post,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { configureHttp } from './configure-http';
import { createRequestContextMiddleware } from './request-context.middleware';

class AddressDto {
  @IsString()
  @MinLength(3)
  city!: string;
}

class SampleDto {
  @IsEmail()
  email!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

// Test-only controller: synthetic endpoints that exercise the global HTTP behavior.
@Controller('sample')
class SampleController {
  @Post()
  create(@Body() dto: SampleDto) {
    return { quantity: dto.quantity, typeOfQuantity: typeof dto.quantity };
  }

  @Get('crash')
  crash() {
    throw new Error('boom: db password is hunter2');
  }

  @Get('http')
  http(@Query('code') code: string) {
    throw new HttpException('internal detail that should not matter', Number(code), {
      cause: Object.assign(new Error('pool exhausted'), { name: 'DbDown' }),
    });
  }

  @Get('plain')
  plain(@Query('kind') kind: string) {
    // Plain objects (not Error/HttpException) that merely look like HTTP errors.
    if (kind === 'exposed') throw { status: 422, expose: true, message: 'client detail' };
    if (kind === 'statuscode') throw { statusCode: 422, expose: true, message: 'client detail' };
    if (kind === 'exposed5xx') throw { status: 502, expose: true, message: 'upstream detail' };
    throw { status: 418, message: 'secret detail' };
  }
}

const validBody = { email: 'ana@example.com', quantity: 2, address: { city: 'Paris' } };
const saneId = 'req-1234_abc.DEF:xyz';

describe('HTTP baseline', () => {
  let app: INestApplication;
  let lines: string[];

  beforeEach(async () => {
    lines = [];
    const moduleRef = await Test.createTestingModule({
      controllers: [SampleController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttp(app, { logSink: (line) => lines.push(line) });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('validation', () => {
    it('accepts a valid payload and transforms it', async () => {
      const res = await request(server()).post('/sample').send(validBody);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ quantity: 2, typeOfQuantity: 'number' });
    });

    it('returns 400 VALIDATION_FAILED with per-field details, including nested paths', async () => {
      const res = await request(server())
        .post('/sample')
        .send({ email: 'nope', quantity: 99, address: { city: 'x' } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(typeof res.body.error.message).toBe('string');
      const details: { field: string; messages: string[] }[] = res.body.error.details;
      expect(details.map((d) => d.field).sort()).toEqual(['address.city', 'email', 'quantity']);
      for (const detail of details) {
        expect(detail.messages.length).toBeGreaterThan(0);
      }
    });

    it('rejects fields that are not part of the DTO', async () => {
      const res = await request(server())
        .post('/sample')
        .send({ ...validBody, isAdmin: true });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([{ field: 'isAdmin', messages: expect.any(Array) }]);
    });

    it('returns 400 BAD_REQUEST for malformed JSON in the same envelope', async () => {
      const res = await request(server())
        .post('/sample')
        .set('content-type', 'application/json')
        .send('{"email": ');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
      expect(res.body.error.correlationId).toBe(res.headers['x-request-id']);
      expect(JSON.stringify(res.body)).not.toContain('Unexpected');
    });
  });

  describe('error envelope', () => {
    it('returns 404 NOT_FOUND for unknown routes', async () => {
      const res = await request(server()).get('/nope');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.correlationId).toBe(res.headers['x-request-id']);
    });

    it.each([
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
      [409, 'CONFLICT'],
      [429, 'TOO_MANY_REQUESTS'],
    ])('maps a thrown HttpException %i to %s', async (status, code) => {
      const res = await request(server()).get(`/sample/http?code=${status}`);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(res.body.error.details).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('internal detail');
    });

    it.each([
      [400, 'BAD_REQUEST'],
      [413, 'BAD_REQUEST'],
      [422, 'BAD_REQUEST'],
    ])('maps a thrown HttpException %i to %s keeping its status', async (status, code) => {
      const res = await request(server()).get(`/sample/http?code=${status}`);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(JSON.stringify(res.body)).not.toContain('internal detail');
    });

    it('keeps 503 as SERVICE_UNAVAILABLE and logs it as a warning, not an unhandled error', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const res = await request(server()).get('/sample/http?code=503&token=secret-query-value');
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(JSON.stringify(res.body)).not.toContain('internal detail');
        expect(warnSpy).toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        // Server-side diagnostics keep the message and the cause; the client never sees them.
        const logged = warnSpy.mock.calls.flat().join(' | ');
        expect(logged).toContain('internal detail that should not matter');
        expect(logged).toContain('DbDown: pool exhausted');
        expect(logged).not.toContain('secret-query-value');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('collapses any other 5xx HttpException to 500 INTERNAL_ERROR and logs an error', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const res = await request(server()).get('/sample/http?code=502');
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('trusts a plain thrown object with a 4xx status only when it is marked expose', async () => {
      const exposed = await request(server()).get('/sample/plain?kind=exposed');
      expect(exposed.status).toBe(422);
      expect(exposed.body.error.code).toBe('BAD_REQUEST');
    });

    it('falls back to `statusCode` when an exposed object has no `status`', async () => {
      const res = await request(server()).get('/sample/plain?kind=statuscode');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BAD_REQUEST');
      expect(JSON.stringify(res.body)).not.toContain('client detail');
    });

    it('never trusts an exposed object with a 5xx status: it becomes a 500', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const res = await request(server()).get('/sample/plain?kind=exposed5xx');
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(res.body)).not.toContain('upstream detail');
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('treats a plain object with a numeric 4xx status but no expose flag as a 500', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const res = await request(server()).get('/sample/plain?kind=unmarked');
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(res.body)).not.toContain('secret detail');
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('aborts the connection instead of writing the envelope when headers were already sent', () => {
      const filter = new AllExceptionsFilter();
      const response = {
        headersSent: true,
        getHeader: () => 'id-1',
        status: vi.fn(),
        json: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({ method: 'GET', path: '/x' }),
        }),
      } as unknown as ArgumentsHost;
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        filter.catch(new Error('late failure'), host);
      } finally {
        errorSpy.mockRestore();
      }
      expect(response.status).not.toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
      expect(response.end).not.toHaveBeenCalled();
      expect(response.destroy).toHaveBeenCalled();
    });

    it('returns 500 INTERNAL_ERROR with a generic message for unexpected errors', async () => {
      const res = await request(server()).get('/sample/crash');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('hunter2');
      expect(raw).not.toContain('boom');
      expect(raw).not.toContain('.ts');
      expect(res.body.error.details).toBeUndefined();
    });
  });

  describe('correlation id', () => {
    it('propagates a sane incoming x-request-id to header and envelope', async () => {
      const res = await request(server()).get('/nope').set('x-request-id', saneId);
      expect(res.headers['x-request-id']).toBe(saneId);
      expect(res.body.error.correlationId).toBe(saneId);
    });

    it.each([
      ['unsafe characters', 'bad id <script>'],
      ['excessive length', 'a'.repeat(129)],
    ])('generates a UUID when the incoming id has %s', async (_label, value) => {
      const res = await request(server()).get('/nope').set('x-request-id', value);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.error.correlationId).toBe(res.headers['x-request-id']);
    });

    it('generates a UUID when absent, also on successful responses', async () => {
      const res = await request(server()).post('/sample').send(validBody);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('request logging', () => {
    it('emits one JSON line with method, path, status, duration and correlation id', async () => {
      await request(server()).post('/sample').set('x-request-id', saneId).send(validBody);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry).toMatchObject({
        method: 'POST',
        path: '/sample',
        status: 201,
        correlationId: saneId,
      });
      expect(typeof entry.durationMs).toBe('number');
    });

    it('logs a request aborted before the response finished, exactly once', () => {
      const emitter = new EventEmitter() as EventEmitter & Record<string, unknown>;
      const response = Object.assign(emitter, {
        statusCode: 200,
        setHeader: () => undefined,
      });
      const out: string[] = [];
      const middleware = createRequestContextMiddleware((line) => out.push(line));
      middleware(
        { headers: {}, method: 'GET', originalUrl: '/slow?token=abc' } as never,
        response as never,
        () => undefined,
      );
      response.emit('close');
      response.emit('close');
      expect(out).toHaveLength(1);
      expect(JSON.parse(out[0])).toMatchObject({ path: '/slow', status: 499, aborted: true });
      expect(out[0]).not.toContain('abc');
    });

    it('does not log twice when a finished response also closes', async () => {
      await request(server()).get('/nope');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).aborted).toBeUndefined();
    });

    it('never logs bodies, credentials, query values or error messages', async () => {
      await request(server())
        .post('/sample')
        .set('authorization', 'Bearer secret-token-123')
        .set('cookie', 'session=secret-cookie-456')
        .send({ ...validBody, email: 'private@example.com', password: 'p4ssw0rd-789' });
      await request(server()).get('/sample/crash?token=query-secret-321');
      const output = lines.join('\n');
      for (const secret of [
        'secret-token-123',
        'secret-cookie-456',
        'private@example.com',
        'p4ssw0rd-789',
        'query-secret-321',
        'hunter2',
      ]) {
        expect(output).not.toContain(secret);
      }
      expect(lines).toHaveLength(2);
    });
  });
});
