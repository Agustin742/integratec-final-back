import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { configureHttp } from '../http/configure-http';
import { ClassroomRole, PrismaClient, RegistrationPath } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { ClassroomContextRecorder } from '../platform/classroom-context/classroom-context.recorder';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import type { PrismaService } from '../prisma/prisma.service';
import { ClassroomsService } from './classrooms.service';

const databaseUrl = loadIsolatedTestDatabaseUrl();

describe('classroom context transaction integration (isolated PostgreSQL)', () => {
  let prisma: PrismaClient;
  let service: ClassroomsService;
  let writer: OutboxWriter;
  let teacher: string;
  let student: string;
  let parent: string;
  let classroomId: string | undefined;
  let eventIds: string[];
  let failAfterInsert: boolean;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
  });
  beforeEach(async () => {
    teacher = randomUUID();
    student = randomUUID();
    parent = randomUUID();
    classroomId = undefined;
    eventIds = [];
    failAfterInsert = false;
    await prisma.user.createMany({
      data: [teacher, student, parent].map((id) => ({
        id,
        email: `context-${id}@example.invalid`,
        displayName: 'Context fixture',
        passwordHash: 'synthetic-unused-hash',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      })),
    });
    writer = new OutboxWriter();
    const record = writer.record.bind(writer);
    vi.spyOn(writer, 'record').mockImplementation(async (tx, event) => {
      const id = await record(tx, event);
      eventIds.push(id);
      if (failAfterInsert) throw new Error('Synthetic failure after event insert');
      return id;
    });
    service = new ClassroomsService(
      prisma as unknown as PrismaService,
      new AccessVerificationService(prisma as unknown as PrismaService),
      new ClassroomContextRecorder(writer),
    );
    const classroom = await service.create(teacher, { name: `Context ${randomUUID()}` });
    classroomId = classroom.id;
    await prisma.classroomMembership.create({
      data: { classroomId, userId: student, role: ClassroomRole.STUDENT },
    });
    await prisma.parentLink.create({ data: { classroomId, parentId: parent, childId: student } });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.$transaction(async (tx) => {
      await tx.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
      if (classroomId) {
        await tx.parentLink.deleteMany({ where: { classroomId } });
        await tx.desk.deleteMany({ where: { classroomId } });
        await tx.classroomMembership.deleteMany({ where: { classroomId } });
        await tx.classroomPet.deleteMany({ where: { classroomId } });
        await tx.classroom.delete({ where: { id: classroomId } });
      }
      await tx.user.deleteMany({ where: { id: { in: [teacher, student, parent] } } });
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function deliverOwnedEvents() {
    const registry = new OutboxHandlerRegistry();
    const delivered: unknown[] = [];
    registry.register('classroom.context.changed', async (event) => {
      delivered.push(event.payload);
    });
    const result = await new OutboxDispatcher(
      prisma as unknown as PrismaService,
      registry,
    ).dispatchPending(50, new Date(), ['classroom.context.changed'], eventIds);
    return { result, delivered };
  }

  it('commits configuration and one deliverable hint, then denies the parent in adult mode', async () => {
    const id = classroomId!;
    expect((await service.findOne(parent, id)).availablePanels).toEqual(['grades']);
    const updated = await service.update(teacher, id, { adultMode: true });
    expect(updated.adultMode).toBe(true);
    expect(updated).not.toHaveProperty('availablePanels');
    await expect(service.findOne(parent, id)).rejects.toMatchObject({ status: 404 });
    expect(await deliverOwnedEvents()).toEqual({
      result: { delivered: 1, retried: 0, exhausted: 0 },
      delivered: [{ classroomId: id }],
    });
    expect(await deliverOwnedEvents()).toEqual({
      result: { delivered: 0, retried: 0, exhausted: 0 },
      delivered: [],
    });
  });

  it('rolls back both configuration and an already inserted hint on transaction failure', async () => {
    const id = classroomId!;
    const before = await service.findOne(teacher, id);
    failAfterInsert = true;
    await expect(service.update(teacher, id, { adultMode: true })).rejects.toThrow(
      'Synthetic failure after event insert',
    );
    expect(await service.findOne(teacher, id)).toEqual(before);
    expect((await service.findOne(parent, id)).availablePanels).toEqual(['grades']);
    expect(await deliverOwnedEvents()).toEqual({
      result: { delivered: 0, retried: 0, exhausted: 0 },
      delivered: [],
    });
  });

  it('delivers a committed change through the API-root SSE broker and refuses lost parent access', async () => {
    const id = classroomId!;
    const sessionId = randomUUID();
    const identity = { userId: parent, sessionId };
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (header !== 'Bearer context-fixture') throw new UnauthorizedException();
          return identity;
        },
        verifySession: async () => identity,
      })
      .compile();
    const app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    const abort = new AbortController();
    try {
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}/classrooms/${id}`;
      const options = {
        headers: { Authorization: 'Bearer context-fixture' },
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
      };
      const stream = await fetch(`${url}/context-events`, options);
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      const frame = `event: classroom.context-invalidated\ndata: ${JSON.stringify({ classroomId: id })}\n\n`;
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame);
      const detail = await fetch(url, options);
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ availablePanels: ['grades'] });

      await service.update(teacher, id, { adultMode: true });
      const result = await app
        .get(OutboxDispatcher)
        .dispatchPending(50, new Date(), ['classroom.context.changed'], eventIds);
      expect(result).toEqual({ delivered: 1, retried: 0, exhausted: 0 });
      expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame);
      expect((await reader.read()).done).toBe(true);
      const denied = await fetch(url, options);
      expect(denied.status).toBe(404);
      await denied.body?.cancel();
      const reconnect = await fetch(`${url}/context-events`, options);
      expect(reconnect.status).toBe(404);
      expect(reconnect.headers.get('content-type')).not.toContain('text/event-stream');
      await reconnect.body?.cancel();
    } finally {
      abort.abort();
      await app.close();
    }
  }, 10_000);

  it('rejects an unauthorized update without changing context or emitting a hint', async () => {
    const id = classroomId!;
    const before = await service.findOne(teacher, id);
    await expect(service.update(student, id, { adultMode: true })).rejects.toMatchObject({
      status: 403,
    });
    expect(await service.findOne(teacher, id)).toEqual(before);
    expect(eventIds).toEqual([]);
    expect(await deliverOwnedEvents()).toEqual({
      result: { delivered: 0, retried: 0, exhausted: 0 },
      delivered: [],
    });
  });
});
