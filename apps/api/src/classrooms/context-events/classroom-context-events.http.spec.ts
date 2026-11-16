import 'reflect-metadata';
import type { Server, ServerResponse } from 'node:http';
import {
  Module,
  NotFoundException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessModule } from '../../access/access.module';
import { AccessVerificationService } from '../../access/access-verification.service';
import { AuthModule } from '../../auth/auth.module';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { ClassroomContextEventsModule } from './classroom-context-events.module';
import { ClassroomContextEventsService } from './classroom-context-events.service';

const classroomId = '00000000-0000-4000-8000-000000000001';
const foreignId = '00000000-0000-4000-8000-000000000002';
const identity = { userId: 'verified-user', sessionId: 'verified-session' };
const sessions = { verifyAuthorizationHeader: vi.fn(), verifySession: vi.fn() };
const access = { verifyClassroomAccess: vi.fn() };
const frame = `event: classroom.context-invalidated\ndata: ${JSON.stringify({ classroomId })}\n\n`;

@Module({
  providers: [
    { provide: SessionVerifier, useValue: sessions },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [SessionVerifier],
})
class TestAuthModule {}
@Module({
  providers: [{ provide: AccessVerificationService, useValue: access }],
  exports: [AccessVerificationService],
})
class TestAccessModule {}

describe('classroom context events HTTP', () => {
  let app: INestApplication;
  let base: string;
  let broker: ClassroomContextEventsService;
  const aborts: AbortController[] = [];
  const get = (
    id = classroomId,
    authorization: string | undefined = 'Bearer synthetic',
    query = '',
  ) => {
    const abort = new AbortController();
    aborts.push(abort);
    return fetch(`${base}/classrooms/${id}/context-events${query}`, {
      headers: authorization ? { Authorization: authorization } : {},
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2000)]),
    });
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [ClassroomContextEventsModule] })
      .overrideModule(AuthModule)
      .useModule(TestAuthModule)
      .overrideModule(AccessModule)
      .useModule(TestAccessModule)
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    broker = app.get(ClassroomContextEventsService);
  });
  beforeEach(() => {
    vi.resetAllMocks();
    sessions.verifyAuthorizationHeader.mockImplementation(async (header: string) => {
      if (header !== 'Bearer synthetic') throw new UnauthorizedException();
      return identity;
    });
    sessions.verifySession.mockResolvedValue(identity);
    access.verifyClassroomAccess.mockImplementation(async (_userId: string, id: string) => {
      if (id !== classroomId) throw new NotFoundException();
      return { classroom: { id }, myRole: 'PARENT' };
    });
  });
  afterEach(() => {
    for (const abort of aborts.splice(0)) abort.abort();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([undefined, 'Bearer expired', 'Bearer revoked', 'malformed'])(
    'denies credential %s before SSE headers',
    async (header) => {
      // Pass empty string for missing credentials because the helper has a default.
      const response = await get(classroomId, header ?? '');
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).not.toContain('text/event-stream');
      expect(access.verifyClassroomAccess).not.toHaveBeenCalled();
    },
  );
  it('does not authenticate a query token', async () => {
    expect((await get(classroomId, '', '?token=synthetic')).status).toBe(401);
  });
  it.each([foreignId, 'malformed'])(
    'denies inaccessible or malformed classroom %s before streaming',
    async (id) => {
      const response = await get(id);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).not.toContain('text/event-stream');
    },
  );
  it('keeps a permitted parent connected after the minimal initial refetch hint', async () => {
    const response = await get(
      classroomId,
      'Bearer synthetic',
      '?userId=foreign&sessionId=foreign',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame);
    expect(access.verifyClassroomAccess).toHaveBeenCalledWith(identity.userId, classroomId, {
      requiredRole: 'ANY',
    });
    broker.invalidateSession('foreign', 'foreign');
    broker.invalidateClassroom(foreignId);
    broker.invalidateClassroom(classroomId);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame);
    expect((await reader.read()).done).toBe(true);
  });
  it('closes a matching verified session with a generic hint', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read();
    broker.invalidateSession(identity.userId, identity.sessionId);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame);
    expect((await reader.read()).done).toBe(true);
  });
  it('keeps HTTP uncommitted until asynchronous access authorization resolves', async () => {
    let resolve!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    access.verifyClassroomAccess.mockImplementationOnce(() => {
      entered();
      return new Promise<void>((done) => {
        resolve = done;
      });
    });
    let committed = false;
    const pending = get().then((response) => {
      committed = true;
      return response;
    });
    await started;
    expect(committed).toBe(false);
    // A change during setup cannot be lost: registration always sends a REST refetch hint.
    broker.invalidateClassroom(classroomId);
    resolve();
    const response = await pending;
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame);
  });
  it('unsubscribes at the actual HTTP disconnect boundary', async () => {
    let outgoing!: ServerResponse;
    const closed = new Promise<void>((resolve) => {
      (app.getHttpServer() as Server).once('request', (_request, response) => {
        outgoing = response;
        response.once('close', resolve);
      });
    });
    const response = await get();
    expect(response.status).toBe(200);
    await response.body!.getReader().read();
    aborts.at(-1)!.abort();
    await closed;
    const write = vi.spyOn(outgoing, 'write');
    broker.invalidateClassroom(classroomId);
    broker.invalidateSession(identity.userId);
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
  it('fails closed on an access backend error without SSE headers', async () => {
    access.verifyClassroomAccess.mockRejectedValueOnce(new Error('synthetic backend failure'));
    const response = await get();
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).not.toContain('text/event-stream');
  });
});
