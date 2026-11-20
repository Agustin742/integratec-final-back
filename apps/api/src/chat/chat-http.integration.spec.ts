import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { NOTIFICATION_REQUESTED_EVENT } from '../notifications/notification-recorder.service';
import { REALTIME_CHAT_MESSAGE_HIDDEN_EVENT } from '../platform/realtime/realtime-events';
import { PrismaService } from '../prisma/prisma.service';

const databaseUrl = loadIsolatedTestDatabaseUrl();
let app: INestApplication;
let prisma: PrismaService;
let teacher: string, student: string, owner: string, admin: string, parent: string;
let stranger: string, removed: string, classroom: string, foreign: string;
const path = (id = classroom) => `/classrooms/${id}/messages`;
const history = (actor = teacher, query: object = {}, id = classroom) =>
  request(app.getHttpServer())
    .get(path(id))
    .set('Authorization', `Bearer chat-http:${actor}`)
    .query(query);
const send = (actor: string, body: object = { body: 'Hello' }, id = classroom) =>
  request(app.getHttpServer())
    .post(path(id))
    .set('Authorization', `Bearer chat-http:${actor}`)
    .send(body);
const moderate = (actor: string | null, messageId: string, id = classroom) => {
  const req = request(app.getHttpServer()).delete(`/classrooms/${id}/messages/${messageId}`);
  return actor === null ? req : req.set('Authorization', `Bearer chat-http:${actor}`);
};
const rowAudit = (id: string) =>
  prisma.message.findUnique({
    where: { id },
    select: { hiddenAt: true, hiddenById: true },
  });

beforeAll(async () => {
  // Only session verification is synthetic. The real global guard, application module
  // graph, validation/filter, authorization service, Prisma and recorder are exercised.
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
  })
    .overrideProvider(SessionVerifier)
    .useValue({
      verifyAuthorizationHeader: async (header?: string) => {
        if (!header?.startsWith('Bearer chat-http:')) throw new UnauthorizedException();
        return { userId: header.slice('Bearer chat-http:'.length), sessionId: randomUUID() };
      },
    })
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { logSink: () => undefined });
  await app.init();
  // Keep one listener alive while rejection checks issue before/after history requests.
  await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
});
beforeEach(async () => {
  [teacher, student, owner, admin, parent, stranger, removed, classroom, foreign] = Array.from(
    { length: 9 },
    () => randomUUID(),
  );
  await prisma.user.createMany({
    data: [teacher, student, owner, admin, parent, stranger, removed].map((id) => ({
      id,
      email: `chat-http-${id}@example.invalid`,
      displayName: id === teacher ? 'Teacher' : 'Synthetic user',
      passwordHash: 'synthetic-unused-hash',
      registrationPath: 'SCHOOL' as const,
    })),
  });
  const school = await prisma.school.create({
    data: { name: 'Synthetic chat school', slug: randomUUID() },
  });
  await prisma.schoolMember.createMany({
    data: [
      { schoolId: school.id, userId: owner, role: 'OWNER' },
      { schoolId: school.id, userId: admin, role: 'ADMIN' },
      { schoolId: school.id, userId: teacher, role: 'TEACHER' },
    ],
  });
  await prisma.classroom.create({
    data: { id: classroom, name: 'HTTP chat', schoolId: school.id },
  });
  await prisma.classroom.create({
    data: { id: foreign, name: 'Foreign chat', independentTeacherId: stranger },
  });
  await prisma.classroomMembership.createMany({
    data: [
      { classroomId: classroom, userId: student, role: 'STUDENT' },
      { classroomId: classroom, userId: teacher, role: 'TEACHER' },
      {
        classroomId: classroom,
        userId: removed,
        role: 'STUDENT',
        state: 'INACTIVE',
        deletedAt: new Date(),
      },
    ],
  });
  await prisma.parentLink.create({
    data: { parentId: parent, childId: student, classroomId: classroom },
  });
});
afterAll(async () => {
  await app?.close();
});

async function counts() {
  const messages = await prisma.message.findMany({
    where: { classroomId: classroom },
    select: { id: true },
  });
  return [
    messages.length,
    await prisma.mention.count({ where: { sourceId: { in: messages.map((row) => row.id) } } }),
    await prisma.outboxEvent.count({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { path: ['classroomId'], equals: classroom },
      },
    }),
  ];
}
function error(response: request.Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body).toEqual({
    error: expect.objectContaining({
      code,
      message: expect.any(String),
      correlationId: response.headers['x-request-id'],
    }),
  });
  expect(response.body.error.correlationId).toBeTruthy();
}
async function reject(call: PromiseLike<request.Response>, status: number, code: string) {
  const before = await counts();
  const publicBefore = (await history().expect(200)).body;
  const response = await call;
  error(response, status, code);
  expect(await counts()).toEqual(before);
  expect((await history().expect(200)).body).toEqual(publicBefore);
  return response;
}

describe('POST /classrooms/:id/messages public contract', () => {
  it.each(['student', 'teacher', 'owner', 'admin'])(
    'allows %s through real persisted authorization',
    async (role) => {
      const actor = { student, teacher, owner, admin }[role]!;
      const response = await send(actor, { body: '  Hello @Teacher @Teacher @unknown  ' }).expect(
        201,
      );
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[\da-f-]{36}$/),
        classroomId: classroom,
        authorId: actor,
        body: 'Hello @Teacher @Teacher @unknown',
        mentionedUserIds: [teacher],
        createdAt: expect.any(String),
      });
      expect(new Date(response.body.createdAt).toISOString()).toBe(response.body.createdAt);
      expect(await counts()).toEqual([1, 1, 1]);
    },
  );
  it('rejects missing credentials, parents, unrelated/removed users and foreign/invalid ids', async () => {
    await reject(
      request(app.getHttpServer()).post(path()).send({ body: 'Hello' }),
      401,
      'UNAUTHENTICATED',
    );
    await reject(send(parent), 403, 'FORBIDDEN');
    for (const actor of [stranger, removed]) await reject(send(actor), 404, 'NOT_FOUND');
    for (const id of [foreign, randomUUID(), 'not-a-uuid'])
      await reject(send(student, { body: 'Hello' }, id), 404, 'NOT_FOUND');
    await send(student).expect(201);
  });
  it.each([
    {},
    { body: null },
    { body: 42 },
    { body: 'Hello', extra: true },
    { body: 'Hello', authorId: randomUUID() },
    { body: 'Hello', createdAt: '2000-01-01T00:00:00Z' },
    { body: 'Hello', classroomId: randomUUID() },
    { body: 'Hello', parentLinkId: randomUUID() },
  ])(
    'rejects malformed DTO or client-owned metadata %# without changing state',
    async (payload) => {
      const response = await reject(send(student, payload), 400, 'VALIDATION_FAILED');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: expect.any(String), messages: expect.any(Array) }),
        ]),
      );
      for (let i = 0; i < 5; i++) await send(student).expect(201);
      expect(await counts()).toEqual([5, 0, 0]);
      expect((await history(student).expect(200)).body.total).toBe(5);
      await reject(send(student), 429, 'TOO_MANY_REQUESTS');
    },
  );
  it('maps service body validation to structured public errors', async () => {
    for (const body of [' \n ', 'a\0b', 'x'.repeat(2001)]) {
      const response = await reject(send(student, { body }), 400, 'VALIDATION_FAILED');
      expect(response.body.error.details).toEqual([expect.objectContaining({ field: 'body' })]);
    }
    await send(student, { body: ` ${'x'.repeat(2000)} ` }).expect(201);
  });
  it('reflects persisted mute while allowing staff without exposing controls', async () => {
    await prisma.classroom.update({ where: { id: classroom }, data: { chatMuted: true } });
    await reject(send(student, { body: '@Teacher' }), 403, 'FORBIDDEN');
    for (const actor of [teacher, owner, admin]) await send(actor).expect(201);
    await prisma.classroom.update({ where: { id: classroom }, data: { chatMuted: false } });
    await send(student).expect(201);
  });
  it('never admits more than five concurrent HTTP sends and rejects the rest with the 429 envelope', async () => {
    const responses = await Promise.all(
      Array.from({ length: 7 }, () => send(student, { body: '@Teacher' })),
    );
    // Concurrent sends for one pair are rejected, not queued: the admitted count is
    // timing-dependent, but the first lock holder always succeeds.
    const admitted = responses.filter((response) => response.status === 201).length;
    expect(admitted).toBeGreaterThanOrEqual(1);
    expect(admitted).toBeLessThanOrEqual(5);
    const rejected = responses.filter((response) => response.status !== 201);
    expect(rejected).toHaveLength(7 - admitted);
    for (const response of rejected) error(response, 429, 'TOO_MANY_REQUESTS');
    // Rejections persist no row, mention or outbox event and consume no quota.
    expect(await counts()).toEqual([admitted, admitted, admitted]);
    for (let i = admitted; i < 5; i++) await send(student, { body: '@Teacher' }).expect(201);
    await reject(send(student, { body: '@Teacher' }), 429, 'TOO_MANY_REQUESTS');
  });
});

describe('GET /classrooms/:id/messages public history', () => {
  it('defaults to latest first, breaks ties by descending id, and paginates consistently', async () => {
    const ids = Array.from({ length: 3 }, () => randomUUID())
      .sort()
      .reverse();
    const tiedAt = new Date(Date.now() - 60_000);
    await prisma.message.createMany({
      data: ids.map((id) => ({
        id,
        classroomId: classroom,
        authorId: student,
        body: id,
        createdAt: tiedAt,
      })),
    });
    const latest = (await send(student, { body: 'Newest @Teacher' }).expect(201)).body;
    const response = (await history(student).expect(200)).body;
    expect(response).toMatchObject({ page: 1, pageSize: 20, total: 4 });
    expect(response.items.map((row: { id: string }) => row.id)).toEqual([latest.id, ...ids]);
    expect(response.items[0]).toEqual({ ...latest, hiddenAt: null, hiddenById: null });
    const first = (await history(student, { page: 1, pageSize: 2 }).expect(200)).body;
    const second = (await history(student, { page: 2, pageSize: 2 }).expect(200)).body;
    expect([...first.items, ...second.items]).toEqual(response.items);
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 4 });
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 4 });
    expect((await history(student, { page: 3, pageSize: 2 }).expect(200)).body).toEqual({
      items: [],
      total: 4,
      page: 3,
      pageSize: 2,
    });
    expect((await history(student, { page: 10000, pageSize: 100 }).expect(200)).body.items).toEqual(
      [],
    );
  });

  it('omits hidden rows/mentions for students; staff retain audit and parent contexts never leak', async () => {
    const visible = (await send(student, { body: 'Visible @Teacher' }).expect(201)).body;
    const hiddenAt = new Date('2026-11-18T12:00:00Z');
    const hidden = await prisma.message.create({
      data: {
        classroomId: classroom,
        authorId: student,
        body: 'Hidden secret',
        hiddenAt,
        hiddenById: teacher,
      },
    });
    await prisma.mention.create({
      data: { sourceType: 'message', sourceId: hidden.id, mentionedUserId: teacher },
    });
    const link = await prisma.parentLink.findFirstOrThrow({
      where: { parentId: parent, classroomId: classroom },
    });
    await prisma.message.create({
      data: { parentLinkId: link.id, authorId: parent, body: 'Private parent context' },
    });
    for (const actor of [teacher, owner, admin]) {
      const staff = (await history(actor).expect(200)).body;
      expect(staff.total).toBe(2);
      expect(staff.items.find((row: { id: string }) => row.id === hidden.id)).toEqual({
        id: hidden.id,
        classroomId: classroom,
        authorId: student,
        body: hidden.body,
        createdAt: hidden.createdAt.toISOString(),
        mentionedUserIds: [teacher],
        hiddenAt: hiddenAt.toISOString(),
        hiddenById: teacher,
      });
    }
    expect((await history(student).expect(200)).body).toEqual({
      items: [{ ...visible, hiddenAt: null, hiddenById: null }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('denies missing credentials, parents, removed users and cross-classroom identifiers', async () => {
    await send(student, { body: 'Retained @Teacher' }).expect(201);
    await reject(request(app.getHttpServer()).get(path()), 401, 'UNAUTHENTICATED');
    await reject(history(parent), 403, 'FORBIDDEN');
    for (const actor of [stranger, removed]) await reject(history(actor), 404, 'NOT_FOUND');
    for (const actor of [student, teacher, owner, admin])
      await reject(history(actor, {}, foreign), 404, 'NOT_FOUND');
    for (const id of [randomUUID(), 'not-a-uuid'])
      await reject(history(student, {}, id), 404, 'NOT_FOUND');
  });

  it.each([
    { page: 0 },
    { page: 10001 },
    { page: 1.5 },
    { page: 'oops' },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: 1.5 },
    { sort: '-createdAt' },
    { extra: true },
  ])('rejects invalid or unsupported query %# without changing history', async (query) => {
    await send(student, { body: 'Existing @Teacher' }).expect(201);
    const response = await reject(history(student, query), 400, 'VALIDATION_FAILED');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: expect.any(String), messages: expect.any(Array) }),
      ]),
    );
  });

  it('returns coherent counts/items/mentions while HTTP sends commit concurrently', async () => {
    // Distinct authors: same-author concurrent sends are rejected (429), not queued.
    const authors = Array.from({ length: 5 }, () => randomUUID());
    await prisma.user.createMany({
      data: authors.map((id) => ({
        id,
        email: `chat-http-${id}@example.invalid`,
        displayName: 'Synthetic user',
        passwordHash: 'synthetic-unused-hash',
        registrationPath: 'SCHOOL' as const,
      })),
    });
    await prisma.classroomMembership.createMany({
      data: authors.map((userId) => ({ classroomId: classroom, userId, role: 'STUDENT' as const })),
    });
    const writes = authors.map((author) => send(author, { body: '@Teacher' }).expect(201));
    const reads = Array.from({ length: 10 }, () => history(student, { pageSize: 100 }).expect(200));
    const responses = await Promise.all([...writes, ...reads]);
    for (const response of responses.slice(writes.length)) {
      expect(response.body.total).toBe(response.body.items.length);
      for (const item of response.body.items) expect(item.mentionedUserIds).toEqual([teacher]);
    }
    expect((await history(student).expect(200)).body.total).toBe(5);
  });

  it('retains author and mentions after removal while revoking the author read access', async () => {
    const message = (await send(student, { body: 'Retained @Teacher' }).expect(201)).body;
    await prisma.classroomMembership.update({
      where: { classroomId_userId: { classroomId: classroom, userId: student } },
      data: { state: 'INACTIVE', deletedAt: new Date() },
    });
    await reject(history(student), 404, 'NOT_FOUND');
    expect((await history().expect(200)).body.items).toEqual([
      { ...message, hiddenAt: null, hiddenById: null },
    ]);
  });
});

describe('DELETE /classrooms/:id/messages/:messageId moderation', () => {
  it('hides with fresh server audit while students lose and staff retain the row', async () => {
    const message = (await send(student, { body: 'Rule break @Teacher' }).expect(201)).body;
    const response = await moderate(teacher, message.id);
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const row = await rowAudit(message.id);
    expect(row!.hiddenById).toBe(teacher);
    // Server clock, not any client-provided instant: within a small wall-clock window.
    expect(Math.abs(row!.hiddenAt!.getTime() - Date.now())).toBeLessThan(2_000);
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: {
        type: REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
        payload: { path: ['messageId'], equals: message.id },
      },
    });
    expect(event.payload).toEqual({
      classroomId: classroom,
      messageId: message.id,
      hiddenAt: row!.hiddenAt!.toISOString(),
    });
    expect((await history(student).expect(200)).body).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    expect((await history(teacher).expect(200)).body).toEqual({
      items: [
        {
          id: message.id,
          classroomId: classroom,
          authorId: student,
          body: 'Rule break @Teacher',
          mentionedUserIds: [teacher],
          createdAt: message.createdAt,
          hiddenAt: row!.hiddenAt!.toISOString(),
          hiddenById: teacher,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it.each(['owner', 'admin'])('lets school %s hide without classroom membership', async (role) => {
    const actor = role === 'owner' ? owner : admin;
    const message = (await send(student).expect(201)).body;
    const response = await moderate(actor, message.id);
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await rowAudit(message.id)).toEqual({
      hiddenById: actor,
      hiddenAt: expect.any(Date),
    });
  });

  it('keeps the original audit on repeat moderation', async () => {
    const message = (await send(student).expect(201)).body;
    await moderate(teacher, message.id).expect(204);
    const first = await rowAudit(message.id);
    expect(first!.hiddenAt).not.toBeNull();
    await moderate(teacher, message.id).expect(204);
    await moderate(admin, message.id).expect(204);
    expect(await rowAudit(message.id)).toEqual(first);
  });

  it('records one moderation event when staff hide the same message concurrently', async () => {
    const message = (await send(student).expect(201)).body;
    const responses = await Promise.all([
      moderate(teacher, message.id),
      moderate(admin, message.id),
    ]);

    expect(responses.map((response) => response.status)).toEqual([204, 204]);
    const events = await prisma.outboxEvent.findMany({
      where: {
        type: REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
        payload: { path: ['messageId'], equals: message.id },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ classroomId: classroom, messageId: message.id });
  });

  it('denies students and parents without touching the row or visible history', async () => {
    const message = (await send(student, { body: 'Still visible @Teacher' }).expect(201)).body;
    const studentBefore = (await history(student).expect(200)).body;
    const staffBefore = (await history(teacher).expect(200)).body;
    const rowBefore = await rowAudit(message.id);
    for (const actor of [student, parent]) {
      await reject(moderate(actor, message.id), 403, 'FORBIDDEN');
    }
    expect((await history(student).expect(200)).body).toEqual(studentBefore);
    expect((await history(teacher).expect(200)).body).toEqual(staffBefore);
    expect(await rowAudit(message.id)).toEqual(rowBefore);
  });

  it('rejects missing credentials, outsiders, foreign paths and unknown messages', async () => {
    const message = (await send(student).expect(201)).body;
    await reject(moderate(null, message.id), 401, 'UNAUTHENTICATED');
    for (const actor of [stranger, removed])
      await reject(moderate(actor, message.id), 404, 'NOT_FOUND');
    for (const actor of [student, teacher])
      for (const id of [foreign, randomUUID(), 'not-a-uuid'])
        await reject(moderate(actor, message.id, id), 404, 'NOT_FOUND');
    for (const messageId of [randomUUID(), 'not-a-uuid'])
      await reject(moderate(teacher, messageId), 404, 'NOT_FOUND');
  });

  it('keeps foreign-classroom messages unreachable through this classroom path', async () => {
    const outside = (await send(stranger, { body: 'Other room' }, foreign).expect(201)).body;
    await reject(moderate(teacher, outside.id), 404, 'NOT_FOUND');
    expect(await rowAudit(outside.id)).toEqual({ hiddenAt: null, hiddenById: null });
  });

  it('neither consumes nor consults the send rate limit', async () => {
    let messageId = '';
    for (let i = 0; i < 5; i++) messageId = (await send(student).expect(201)).body.id;
    await moderate(teacher, messageId).expect(204);
    await reject(send(student), 429, 'TOO_MANY_REQUESTS');
    for (let i = 0; i < 5; i++) await send(teacher).expect(201);
    await reject(send(teacher), 429, 'TOO_MANY_REQUESTS');
  });
});
