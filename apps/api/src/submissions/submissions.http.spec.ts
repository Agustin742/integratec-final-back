import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { configureHttp } from '../http/configure-http';
import { pdfBytes, pngBytes } from '../testing/file-fixtures';
import { SUBMISSION_MAX_FILE_BYTES, SUBMISSION_MAX_FILES } from './submission-file-policy';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

const actorId = '22222222-2222-4222-8222-222222222222';
const activityId = '66666666-6666-4666-8666-666666666666';
const url = `/activities/${activityId}/submissions`;
const submission = {
  id: '77777777-7777-4777-8777-777777777777',
  activityId,
  submittedAt: '2026-11-13T12:00:00.000Z',
  isLate: false,
  status: 'submitted',
  files: [],
};

// The controller is a transport adapter: the service (rules, storage, persistence) is stubbed.
const service = { submit: vi.fn() };

describe('submissions HTTP transport (multipart, status codes, error envelope)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SubmissionsController],
      providers: [
        { provide: SubmissionsService, useValue: service },
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (header !== 'Bearer http-test') throw new UnauthorizedException();
              return { userId: actorId, sessionId: randomUUID() };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    service.submit.mockReset();
    service.submit.mockResolvedValue({ submission, created: true });
  });

  const post = () =>
    request(app.getHttpServer()).post(url).set('Authorization', 'Bearer http-test');

  it('hands the actor, activity, header and raw file bytes to the service and answers 201', async () => {
    const res = await post()
      .set('Idempotency-Key', 'key-1')
      .attach('files', Buffer.from(pdfBytes()), { filename: 'a.pdf', contentType: 'text/plain' })
      .attach('files', Buffer.from(pngBytes()), { filename: 'b.png' })
      .expect(201);
    expect(res.body).toEqual(submission);
    expect(service.submit).toHaveBeenCalledTimes(1);
    const [actor, activity, key, files] = service.submit.mock.calls[0];
    expect([actor, activity, key]).toEqual([actorId, activityId, 'key-1']);
    expect(files.map((f: { originalName: string }) => f.originalName)).toEqual(['a.pdf', 'b.png']);
    expect(files[0].declaredContentType).toBe('text/plain');
    expect(Buffer.from(files[0].bytes)).toEqual(Buffer.from(pdfBytes()));
  });

  it('answers 200 for an idempotent replay', async () => {
    service.submit.mockResolvedValue({ submission, created: false });
    await post()
      .set('Idempotency-Key', 'key-1')
      .attach('files', Buffer.from(pdfBytes()), { filename: 'a.pdf' })
      .expect(200);
  });

  it('passes an absent Idempotency-Key and absent files to the service for validation', async () => {
    await post().field('note', 'x').expect(201);
    const [, , key, files] = service.submit.mock.calls[0];
    expect(key).toBeUndefined();
    expect(files).toEqual([]);
  });

  it('requires authentication', async () => {
    const res = await request(app.getHttpServer()).post(url).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(service.submit).not.toHaveBeenCalled();
  });

  it('aborts a file over the size limit with 413 in the error envelope, before the handler', async () => {
    const tooBig = Buffer.alloc(SUBMISSION_MAX_FILE_BYTES + 1, 0x25);
    const res = await post()
      .set('Idempotency-Key', 'key-1')
      .attach('files', tooBig, { filename: 'big.pdf' })
      .expect(413);
    expect(res.body.error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(res.body.error.correlationId).toEqual(expect.any(String));
    expect(service.submit).not.toHaveBeenCalled();
  });

  it('accepts a file of exactly the size limit', async () => {
    const exact = Buffer.alloc(SUBMISSION_MAX_FILE_BYTES, 0x25);
    await post()
      .set('Idempotency-Key', 'key-1')
      .attach('files', exact, { filename: 'exact.pdf' })
      .expect(201);
    expect(service.submit.mock.calls[0][3][0].bytes.byteLength).toBe(SUBMISSION_MAX_FILE_BYTES);
  });

  it('rejects more files than the limit with 400 in the error envelope, before the handler', async () => {
    const req = post().set('Idempotency-Key', 'key-1');
    for (let i = 0; i <= SUBMISSION_MAX_FILES; i++) {
      req.attach('files', Buffer.from(pdfBytes()), { filename: `f${i}.pdf` });
    }
    const res = await req.expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(service.submit).not.toHaveBeenCalled();
  });

  it('rejects files sent under another field name with 400', async () => {
    const res = await post()
      .set('Idempotency-Key', 'key-1')
      .attach('attachments', Buffer.from(pdfBytes()), { filename: 'a.pdf' })
      .expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(service.submit).not.toHaveBeenCalled();
  });

  it('documents the multipart body and the Idempotency-Key header in OpenAPI', () => {
    const config = new DocumentBuilder().setTitle('t').setVersion('1').build();
    const doc = SwaggerModule.createDocument(app, config);
    const operation = doc.paths['/activities/{activityId}/submissions'].post!;
    const requestBody = operation.requestBody as {
      content: Record<string, { schema: Record<string, unknown> }>;
    };
    expect(Object.keys(requestBody.content)).toEqual(['multipart/form-data']);
    expect(JSON.stringify(doc.components?.schemas)).toContain('binary');
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: true }),
    );
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '201', '400', '401', '403', '404', '409', '413']),
    );
  });
});
