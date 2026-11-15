import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, RegistrationPath } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../../config/testing/isolated-test-database';
import { configureHttp } from '../../http/configure-http';
import { NOTIFICATION_REQUESTED_EVENT } from '../../notifications/notification-recorder.service';
import { OutboxDispatcher } from '../../platform/outbox/outbox.dispatcher';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityForumModule } from './activity-forum.module';
import { futureInstant } from '../../testing/relative-dates';

const databaseUrl = loadIsolatedTestDatabaseUrl();

describe('activity forum PostgreSQL HTTP — communication, data and classrooms-and-roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcher;
  let fixtureReady = false;
  const [teacher, student, otherStudent, parent, stranger] = Array.from({ length: 5 }, () =>
    randomUUID(),
  );
  const users = [teacher, student, otherStudent, parent, stranger];
  const [classroomA, classroomB] = Array.from({ length: 2 }, () => randomUUID());
  const [publishedActivity, draftActivity, foreignActivity, paginationActivity] = Array.from(
    { length: 4 },
    () => randomUUID(),
  );
  const token = (actor: string) => `Bearer forum-test:${actor}`;
  const forum = (
    method: 'get' | 'post',
    path: string,
    actor: string,
    activity: string = publishedActivity,
    classroom: string = classroomA,
  ) => {
    const http = request(app.getHttpServer());
    return http[method](`/classrooms/${classroom}/activities/${activity}/forum${path}`).set(
      'Authorization',
      token(actor),
    );
  };
  const body = (text: string) => ({ body: text });
  const activityData = (
    id: string,
    classroomId: string,
    state: 'PUBLISHED' | 'DRAFT',
  ): Prisma.ActivityUncheckedCreateInput => ({
    id,
    classroomId,
    createdById: teacher,
    type: 'TP',
    format: 'FILE',
    state,
    ...(state === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
    title: `Forum ${id}`,
    description: '',
    dueAt: futureInstant(30, 15),
    allowLate: false,
    maxScore: 10,
  });
  const replyRequests = async (threadId: string) =>
    (
      await prisma.outboxEvent.findMany({
        where: { type: NOTIFICATION_REQUESTED_EVENT },
      })
    ).filter(
      (event) =>
        (event.payload as { kind?: string; resourceId?: string }).kind === 'activity_forum_reply' &&
        (event.payload as { kind?: string; resourceId?: string }).resourceId === threadId,
    );
  const materialize = async (threadId: string) => {
    const events = await replyRequests(threadId);
    await dispatcher.dispatchPending(
      100,
      new Date(),
      [NOTIFICATION_REQUESTED_EVENT],
      events.map((event) => event.id),
    );
    return prisma.notification.findMany({ where: { resourceId: threadId } });
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({
          // The manual dispatchPending calls drive materialization; a huge poll interval
          // keeps the background loop from materializing events during cleanup.
          ...authTestConfig({ outboxPollIntervalSeconds: 86400 }),
          databaseUrl,
        }),
        ActivityForumModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer forum-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer forum-test:'.length),
                sessionId: randomUUID(),
              };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    dispatcher = app.get(OutboxDispatcher);
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: `Forum ${id}`,
          email: `forum-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-forum-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomA, name: `Forum A ${classroomA}`, independentTeacherId: teacher },
          { id: classroomB, name: `Forum B ${classroomB}`, independentTeacherId: stranger },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroomA, userId: student, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: otherStudent, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.create({
        data: { parentId: parent, childId: student, classroomId: classroomA },
      });
      await tx.activity.createMany({
        data: [
          activityData(publishedActivity, classroomA, 'PUBLISHED'),
          activityData(draftActivity, classroomA, 'DRAFT'),
          activityData(foreignActivity, classroomB, 'PUBLISHED'),
          activityData(paginationActivity, classroomA, 'PUBLISHED'),
        ],
      });
    });
    fixtureReady = true;
  }, 30_000);

  afterAll(async () => {
    try {
      if (fixtureReady) {
        // Final teardown removes only this file's fixture events and their dependent notices.
        const events = await prisma.outboxEvent.findMany({
          where: {
            type: NOTIFICATION_REQUESTED_EVENT,
            OR: [classroomA, classroomB].map((classroomId) => ({
              payload: { path: ['classroomId'], equals: classroomId },
            })),
          },
          select: { id: true },
        });
        const mine = events.map((event) => event.id);
        if (mine.length > 0)
          await prisma.$transaction(async (tx) => {
            await tx.notificationDelivery.deleteMany({
              where: { notification: { sourceEventId: { in: mine } } },
            });
            await tx.notification.deleteMany({ where: { sourceEventId: { in: mine } } });
            await tx.outboxEvent.deleteMany({ where: { id: { in: mine } } });
          });
        await prisma.$transaction(async (tx) => {
          const where = { activity: { classroomId: { in: [classroomA, classroomB] } } };
          await tx.activityForumPost.deleteMany({ where: { thread: where } });
          await tx.activityForumThread.deleteMany({ where });
          await tx.activity.deleteMany({
            where: { classroomId: { in: [classroomA, classroomB] } },
          });
          await tx.parentLink.deleteMany({ where: { classroomId: classroomA } });
          await tx.classroomMembership.deleteMany({ where: { classroomId: classroomA } });
          await tx.classroom.deleteMany({ where: { id: { in: [classroomA, classroomB] } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      }
    } finally {
      await app?.close();
    }
  }, 30_000);

  it('student creates a thread on a published activity; the server trims the body', async () => {
    const res = await forum('post', '/threads', student)
      .send(body('  How do I start the TP?  '))
      .expect(201);
    expect(res.body).toMatchObject({
      activityId: publishedActivity,
      authorId: student,
      posts: [{ threadId: res.body.id, authorId: student, body: 'How do I start the TP?' }],
    });
    expect(res.body.createdAt).toMatch(/Z$/);
    const stored = await prisma.activityForumThread.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { activityId: true, posts: { select: { body: true } } },
    });
    expect(stored.activityId).toBe(publishedActivity);
    expect(stored.posts).toHaveLength(1);
  });

  it('teacher reply notifies the thread author; student replies notify nobody', async () => {
    const thread = (
      await forum('post', '/threads', student).send(body('Question for the teacher')).expect(201)
    ).body as { id: string };
    await forum('post', `/threads/${thread.id}/posts`, otherStudent)
      .send(body('Same doubt here'))
      .expect(201);
    expect(await materialize(thread.id)).toEqual([]);

    await forum('post', `/threads/${thread.id}/posts`, teacher)
      .send(body('It is in the material of week 1'))
      .expect(201);
    const rows = await materialize(thread.id);
    expect(rows.map((n) => n.recipientId)).toEqual([student]);
    expect(
      rows.every((n) => n.kind === 'activity_forum_reply' && n.classroomId === classroomA),
    ).toBe(true);
  });

  it('a teacher replying to their own thread records no notification', async () => {
    const thread = (
      await forum('post', '/threads', teacher)
        .send(body('Announcement: due date extended'))
        .expect(201)
    ).body as { id: string };
    await forum('post', `/threads/${thread.id}/posts`, teacher).send(body('Follow-up')).expect(201);
    expect(await materialize(thread.id)).toEqual([]);
  });

  it('threads list is paginated and newest first with id tiebreaker', async () => {
    const created: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const threadResponse = (await forum('post', '/threads', student, paginationActivity)
        .send(body(`Thread ${index}`))
        .expect(201)) as { body: { id: string } };
      created.push(threadResponse.body.id);
    }
    const page1 = (
      await forum(
        'get',
        '/threads?sort=-createdAt&page=1&pageSize=2',
        student,
        paginationActivity,
      ).expect(200)
    ).body as { items: { id: string }[]; total: number };
    const page2 = (
      await forum(
        'get',
        '/threads?sort=-createdAt&page=2&pageSize=2',
        student,
        paginationActivity,
      ).expect(200)
    ).body as { items: { id: string }[]; total: number };
    expect(page1.total).toBe(3);
    expect(page1.items.map((thread) => thread.id)).toEqual([created[2], created[1]]);
    expect(page2.items.map((thread) => thread.id)).toEqual([created[0]]);
    expect(page1.items[0]).toMatchObject({
      firstPostBody: 'Thread 2',
      replyCount: 0,
      authorId: student,
    });
  });

  it('posts list is paginated and oldest first with id tiebreaker', async () => {
    const threadResponse = (await forum('post', '/threads', student)
      .send(body('Root question'))
      .expect(201)) as { body: { id: string; posts: { id: string }[] } };
    const thread = threadResponse.body.id;
    const firstPostId = threadResponse.body.posts[0].id;
    const created: string[] = [];
    for (const [actor, text] of [
      [teacher, 'Answer 1'],
      [otherStudent, 'Answer 2'],
    ] as const) {
      const postResponse = (await forum('post', `/threads/${thread}/posts`, actor)
        .send(body(text))
        .expect(201)) as { body: { id: string } };
      created.push(postResponse.body.id);
    }
    const res = (await forum('get', `/threads/${thread}/posts`, student).expect(200)).body as {
      items: { id: string }[];
      total: number;
    };
    expect(res.total).toBe(3);
    expect(res.items.map((post) => post.id)).toEqual([firstPostId, ...created]);
  });

  it('whitespace-only and over-length bodies are rejected; 2000 chars are accepted', async () => {
    await forum('post', '/threads', student).send(body('   ')).expect(400);
    await forum('post', '/threads', student)
      .send(body('x'.repeat(2001)))
      .expect(400);
    await forum('post', '/threads', student)
      .send(body('x'.repeat(2000)))
      .expect(201);
  });

  it('access matrix: parent 403, stranger 404, students cannot reach drafts, other classroom 404', async () => {
    await forum('get', '/threads', parent).expect(403);
    await forum('post', '/threads', parent).send(body('Can I ask?')).expect(403);
    await forum('get', '/threads', stranger).expect(404);
    await forum('post', '/threads', stranger).send(body('Am I here?')).expect(404);
    await forum('get', '/threads', student, draftActivity).expect(404);
    await forum('get', '/threads', teacher, draftActivity).expect(200);
    await forum('get', '/threads', student, foreignActivity, classroomB).expect(404);
    await forum('get', '/threads', student, 'not-a-uuid').expect(404);
  });

  it('thread and post paths are scoped: another activity or classroom id is 404', async () => {
    const thread = (
      (await forum('post', '/threads', student).send(body('Scoped question')).expect(201)) as {
        body: { id: string };
      }
    ).body.id;
    await forum('get', `/threads/${thread}/posts`, student, foreignActivity, classroomB).expect(
      404,
    );
    await forum('post', `/threads/${thread}/posts`, teacher, draftActivity)
      .send(body('Replying in the wrong activity'))
      .expect(404);
    await forum('get', `/threads/${randomUUID()}/posts`, student).expect(404);
    await forum('get', `/threads/not-a-uuid/posts`, student).expect(404);
  });
});
