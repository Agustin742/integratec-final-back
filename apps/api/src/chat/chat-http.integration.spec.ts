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
      where: { payload: { path: ['classroomId'], equals: classroom } },
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
  it('admits five concurrent HTTP sends and returns the 429 envelope without partial writes', async () => {
    const responses = await Promise.all(
      Array.from({ length: 7 }, () => send(student, { body: '@Teacher' })),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(5);
    const rejected = responses.filter((response) => response.status !== 201);
    expect(rejected).toHaveLength(2);
    for (const response of rejected) error(response, 429, 'TOO_MANY_REQUESTS');
    expect(await counts()).toEqual([5, 5, 5]);
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
    const writes = Array.from({ length: 5 }, () => send(student, { body: '@Teacher' }).expect(201));
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
