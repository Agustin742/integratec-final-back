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
  const response = await call;
  error(response, status, code);
  expect(await counts()).toEqual(before);
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
      await send(student).expect(201);
      expect(await counts()).toEqual([1, 0, 0]);
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
