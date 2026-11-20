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
let teacher: string, student: string, other: string, parent: string, removed: string;
let stranger: string, roomA: string, roomB: string, roomEmpty: string, foreign: string;
let tick = 0;

const auth = (actor: string) => ({ Authorization: `Bearer chat-inbox:${actor}` });
const inbox = (actor: string) => request(app.getHttpServer()).get('/chats').set(auth(actor));
const mark = (actor: string, messageId: unknown, id = roomA) =>
  request(app.getHttpServer())
    .put(`/classrooms/${id}/messages/read-marker`)
    .set(auth(actor))
    .send({ messageId });
// Deterministic, strictly increasing instants so ordering never depends on the wall clock.
const post = async (authorId: string, classroomId: string, body = 'hi', hidden = false) =>
  prisma.message.create({
    data: {
      classroomId,
      authorId,
      body,
      createdAt: new Date(Date.UTC(2026, 10, 20, 12, 0, 0) + ++tick * 1000),
      ...(hidden ? { hiddenAt: new Date(), hiddenById: teacher } : {}),
    },
  });
const summary = async (actor: string, classroomId: string) =>
  (await inbox(actor).expect(200)).body.items.find(
    (item: { classroomId: string }) => item.classroomId === classroomId,
  );
const markerCount = () =>
  prisma.chatReadMarker.count({
    where: { classroomId: { in: [roomA, roomB, roomEmpty, foreign] } },
  });
const marker = (actor: string, classroomId = roomA) =>
  prisma.chatReadMarker.findUnique({
    where: { userId_classroomId: { userId: actor, classroomId } },
  });

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
  })
    .overrideProvider(SessionVerifier)
    .useValue({
      verifyAuthorizationHeader: async (header?: string) => {
        if (!header?.startsWith('Bearer chat-inbox:')) throw new UnauthorizedException();
        return { userId: header.slice('Bearer chat-inbox:'.length), sessionId: randomUUID() };
      },
    })
    .compile();
  app = module.createNestApplication();
  configureHttp(app, { logSink: () => undefined });
  await app.init();
  await app.listen(0, '127.0.0.1');
  prisma = app.get(PrismaService);
});
beforeEach(async () => {
  [teacher, student, other, parent, removed, stranger, roomA, roomB, roomEmpty, foreign] =
    Array.from({ length: 10 }, () => randomUUID());
  await prisma.user.createMany({
    data: [teacher, student, other, parent, removed, stranger].map((id) => ({
      id,
      email: `chat-inbox-${id}@example.invalid`,
      displayName: id === teacher ? 'Teacher' : id === other ? 'Other student' : 'Synthetic user',
      passwordHash: 'synthetic-unused-hash',
      registrationPath: 'INDEPENDENT_TEACHER' as const,
    })),
  });
  // Independent classrooms: the teacher owns A, B and the empty one; stranger owns `foreign`.
  await prisma.classroom.createMany({
    data: [
      { id: roomA, name: 'Alpha', independentTeacherId: teacher },
      { id: roomB, name: 'Beta', independentTeacherId: teacher },
      { id: roomEmpty, name: 'Gamma empty', independentTeacherId: teacher },
      { id: foreign, name: 'Foreign', independentTeacherId: stranger },
    ],
  });
  await prisma.classroomMembership.createMany({
    data: [
      { classroomId: roomA, userId: student, role: 'STUDENT' },
      { classroomId: roomB, userId: student, role: 'STUDENT' },
      { classroomId: roomEmpty, userId: student, role: 'STUDENT' },
      { classroomId: roomA, userId: other, role: 'STUDENT' },
      { classroomId: roomB, userId: other, role: 'STUDENT' },
      {
        classroomId: foreign,
        userId: removed,
        role: 'STUDENT',
        state: 'INACTIVE',
        deletedAt: new Date(),
      },
    ],
  });
  await prisma.parentLink.create({
    data: { parentId: parent, childId: student, classroomId: roomA },
  });
});
afterAll(async () => {
  await app?.close();
});

describe('GET /chats', () => {
  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/chats').expect(401);
  });

  it('lists every classroom with latest visible message and unread count, newest first', async () => {
    await post(other, roomA, 'older in A');
    const lastA = await post(other, roomA, 'newest in A');
    await post(teacher, roomB, 'in B from teacher');
    const lastB = await post(other, roomB, 'newest in B');

    const response = await inbox(student).expect(200);

    expect(response.body.items.map((item: { classroomId: string }) => item.classroomId)).toEqual([
      roomB,
      roomA,
      roomEmpty,
    ]);
    expect(response.body.items[0]).toEqual({
      classroomId: roomB,
      classroomName: 'Beta',
      lastMessage: {
        id: lastB.id,
        authorId: other,
        authorDisplayName: 'Other student',
        bodyPreview: 'newest in B',
        createdAt: lastB.createdAt.toISOString(),
      },
      unreadCount: 2,
    });
    expect(response.body.items[1].lastMessage.id).toBe(lastA.id);
    expect(response.body.items[1].unreadCount).toBe(2);
    expect(response.body.items[2]).toEqual({
      classroomId: roomEmpty,
      classroomName: 'Gamma empty',
      lastMessage: null,
      unreadCount: 0,
    });
  });

  it('includes staff classrooms, and excludes parents, removed members and foreign classrooms', async () => {
    await post(student, roomA);
    expect((await inbox(teacher).expect(200)).body.items).toHaveLength(3);
    expect(await summary(teacher, roomA)).toMatchObject({ unreadCount: 1 });
    expect((await inbox(parent).expect(200)).body.items).toEqual([]);
    expect((await inbox(removed).expect(200)).body.items).toEqual([]);
    expect(await summary(student, foreign)).toBeUndefined();
  });

  it('never counts own messages and skips hidden ones in preview and count', async () => {
    await post(other, roomA, 'visible');
    await post(other, roomA, 'secret', true);
    await post(student, roomA, 'my own message');

    const item = await summary(student, roomA);

    expect(item.unreadCount).toBe(1);
    expect(item.lastMessage.bodyPreview).toBe('my own message');
    const teacherView = await summary(teacher, roomA);
    expect(teacherView.unreadCount).toBe(2);
    expect(teacherView.lastMessage.bodyPreview).toBe('my own message');
  });

  it('skips a hidden latest message in the preview', async () => {
    await post(other, roomA, 'visible');
    await post(other, roomA, 'secret', true);

    const item = await summary(student, roomA);

    expect(item.lastMessage.bodyPreview).toBe('visible');
    expect(item.unreadCount).toBe(1);
  });

  it('truncates long previews to 120 characters', async () => {
    await post(other, roomA, 'x'.repeat(500));
    const item = await summary(student, roomA);
    expect(Array.from(item.lastMessage.bodyPreview)).toHaveLength(120);
  });
});

describe('PUT /classrooms/:id/messages/read-marker', () => {
  it('moves the marker to the latest message: unread 0, then 1 after a new message from another user', async () => {
    await post(other, roomA, 'one');
    const latest = await post(other, roomA, 'two');
    expect((await summary(student, roomA)).unreadCount).toBe(2);

    await mark(student, latest.id).expect(204);

    expect((await summary(student, roomA)).unreadCount).toBe(0);
    expect(await marker(student)).toMatchObject({
      lastReadMessageId: latest.id,
      lastReadAt: latest.createdAt,
    });
    await post(other, roomA, 'three');
    expect((await summary(student, roomA)).unreadCount).toBe(1);
    await post(student, roomA, 'my reply');
    expect((await summary(student, roomA)).unreadCount).toBe(1);
  });

  it('is idempotent and never moves backwards', async () => {
    const first = await post(other, roomA, 'one');
    const second = await post(other, roomA, 'two');
    await mark(student, second.id).expect(204);
    await mark(student, second.id).expect(204);
    await mark(student, first.id).expect(204);

    expect((await marker(student))!.lastReadMessageId).toBe(second.id);
    expect((await summary(student, roomA)).unreadCount).toBe(0);
    expect(await prisma.chatReadMarker.count({ where: { userId: student } })).toBe(1);
  });

  it('breaks createdAt ties by id and only moves forward', async () => {
    const at = new Date(Date.UTC(2026, 10, 21));
    const [a, b] = await Promise.all(
      [other, other].map((authorId) =>
        prisma.message.create({
          data: { classroomId: roomA, authorId, body: 'tie', createdAt: at },
        }),
      ),
    );
    const [low, high] = [a!.id, b!.id].sort();
    await mark(student, high).expect(204);
    await mark(student, low).expect(204);
    expect((await marker(student))!.lastReadMessageId).toBe(high);
    expect((await summary(student, roomA)).unreadCount).toBe(0);
  });

  it('keeps markers per user', async () => {
    const msg = await post(other, roomA);
    await mark(student, msg.id).expect(204);
    expect((await summary(teacher, roomA)).unreadCount).toBe(1);
  });

  it('rejects a message from another classroom, unknown, hidden or malformed ids', async () => {
    const inB = await post(other, roomB);
    const hidden = await post(other, roomA, 'hidden', true);
    await mark(student, inB.id).expect(404);
    await mark(student, randomUUID()).expect(404);
    await mark(student, hidden.id).expect(404);
    await mark(student, 'not-a-uuid').expect(400);
    await mark(student, undefined).expect(400);
    expect(await markerCount()).toBe(0);
  });

  it('rejects unknown body fields', async () => {
    const msg = await post(other, roomA);
    await request(app.getHttpServer())
      .put(`/classrooms/${roomA}/messages/read-marker`)
      .set(auth(student))
      .send({ messageId: msg.id, userId: teacher })
      .expect(400);
  });

  it('denies parents and hides classrooms from strangers and removed members', async () => {
    const msg = await post(other, roomA);
    await mark(parent, msg.id).expect(403);
    await mark(stranger, msg.id).expect(404);
    await mark(removed, msg.id, foreign).expect(404);
    await mark(student, msg.id, randomUUID()).expect(404);
    await request(app.getHttpServer())
      .put(`/classrooms/${roomA}/messages/read-marker`)
      .send({ messageId: msg.id })
      .expect(401);
    expect(await markerCount()).toBe(0);
  });
});
