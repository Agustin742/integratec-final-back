import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  ClassroomRole,
  RegistrationPath,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { toLocalDay } from '../gamification/local-day';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';

const databaseUrl = loadIsolatedTestDatabaseUrl();

// Public HTTP + real isolated PostgreSQL + faked session verification. No real
// sessions, environment-file loader, or provider network: the inference port is
// not exercised by the delivery semantics covered here (it gets its own specs
// with a fake provider in the composition and question slices).
describe('daily review delivery — issue #42 / HU-BOT-003', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const [
    teacher,
    student,
    reloadStudent,
    concurrentStudent,
    boundaryStudent,
    parent,
    stranger,
    examStudent,
  ] = Array.from({ length: 8 }, () => randomUUID());
  const [classroom, reloadClassroom, concurrentClassroom, boundaryClassroom, examClassroom] =
    Array.from({ length: 5 }, () => randomUUID());
  const users: string[] = [
    teacher,
    student,
    reloadStudent,
    concurrentStudent,
    boundaryStudent,
    parent,
    stranger,
    examStudent,
  ];

  const path = () => '/users/me/daily-review';
  const get = (actor: string | null) => {
    const call = request(app.getHttpServer()).get(path());
    return actor === null ? call : call.set('Authorization', `Bearer daily-review:${actor}`);
  };
  const deliveries = (userId: string) => prisma.dailyReviewDelivery.count({ where: { userId } });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (!header?.startsWith('Bearer daily-review:')) throw new UnauthorizedException();
          const userId = header.slice('Bearer daily-review:'.length);
          if (!users.includes(userId)) throw new UnauthorizedException();
          return { userId, sessionId: randomUUID() };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: 'Synthetic daily-review participant',
          email: `daily-review-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          classroom,
          reloadClassroom,
          concurrentClassroom,
          boundaryClassroom,
          examClassroom,
        ].map((id) => ({ id, name: `Daily review ${id}`, independentTeacherId: teacher })),
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroom, userId: student, role: ClassroomRole.STUDENT },
          { classroomId: reloadClassroom, userId: reloadStudent, role: ClassroomRole.STUDENT },
          {
            classroomId: concurrentClassroom,
            userId: concurrentStudent,
            role: ClassroomRole.STUDENT,
          },
          {
            classroomId: boundaryClassroom,
            userId: boundaryStudent,
            role: ClassroomRole.STUDENT,
          },
          { classroomId: examClassroom, userId: examStudent, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.create({
        data: { classroomId: classroom, parentId: parent, childId: student },
      });
      await tx.activity.create({
        data: {
          classroomId: examClassroom,
          createdById: teacher,
          type: ActivityType.EXAM,
          format: ActivityFormat.MULTIPLE_CHOICE,
          state: ActivityState.PUBLISHED,
          title: 'Synthetic exam in progress',
          dueAt: new Date(now.getTime() + 30 * 60 * 1000),
          opensAt: new Date(now.getTime() - 30 * 60 * 1000),
          publishedAt: now,
          maxScore: 100,
        },
      });
    });
  }, 30_000);
  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication', async () => {
    await get(null).expect(401);
  });

  it('delivers the review once on the first authenticated student access of the local day', async () => {
    const response = await get(student).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'STUDENT',
      contentKind: 'structured',
      summary: null,
      sections: [],
      dailyQuestion: null,
    });
    expect(await deliveries(student)).toBe(1);
    const [delivery] = await prisma.dailyReviewDelivery.findMany({
      where: { userId: student },
    });
    expect(delivery.contentKind).toBe('STRUCTURED');
    expect(delivery.localDay).toBe(toLocalDay(new Date()));
  });

  it('answers not_due on reload within the same local day and keeps exactly one delivery', async () => {
    await get(reloadStudent).expect(200);
    const second = await get(reloadStudent).expect(200);
    expect(second.body).toEqual({ status: 'not_due' });
    expect(await deliveries(reloadStudent)).toBe(1);
  });

  it('delivers exactly once under concurrent first connections', async () => {
    const responses = await Promise.all([
      get(concurrentStudent),
      get(concurrentStudent),
      get(concurrentStudent),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const statuses = responses.map((r) => r.body.status).sort();
    expect(statuses).toEqual(['due', 'not_due', 'not_due']);
    expect(await deliveries(concurrentStudent)).toBe(1);
  });

  it('a delivered past local day does not block today (Buenos Aires day boundary)', async () => {
    const yesterday = toLocalDay(new Date(Date.now() - 36 * 60 * 60 * 1000));
    await prisma.dailyReviewDelivery.create({
      data: { userId: boundaryStudent, localDay: yesterday, contentKind: 'STRUCTURED' },
    });
    const response = await get(boundaryStudent).expect(200);
    expect(response.body.status).toBe('due');
    expect(await deliveries(boundaryStudent)).toBe(2);
  });

  it('parents never receive the review and consume no delivery', async () => {
    const response = await get(parent).expect(200);
    expect(response.body).toEqual({ status: 'not_due' });
    expect(await deliveries(parent)).toBe(0);
  });

  it('a user with no classroom access receives not_due', async () => {
    const response = await get(stranger).expect(200);
    expect(response.body).toEqual({ status: 'not_due' });
    expect(await deliveries(stranger)).toBe(0);
  });

  it('teachers receive the review with TEACHER audience and no daily question', async () => {
    const response = await get(teacher).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'TEACHER',
      dailyQuestion: null,
    });
    expect(await deliveries(teacher)).toBe(1);
  });

  it('a student with an exam in progress does not consume the delivery', async () => {
    const response = await get(examStudent).expect(200);
    expect(response.body).toEqual({ status: 'not_due' });
    expect(await deliveries(examStudent)).toBe(0);
  });
});
