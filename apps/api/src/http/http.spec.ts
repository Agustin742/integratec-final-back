import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureHttp } from './configure-http';

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
    throw new HttpException('internal detail that should not matter', Number(code));
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
