import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { MetricsModule } from '../metrics/metrics.module';
import { PrismaService } from '../prisma/prisma.service';
import { FamilyModule } from './family.module';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe('Family Area HTTP — HU-ACT-006 (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const [teacher, studentActive, studentRemoved, parentA, parentB, stranger] = Array.from(
    { length: 6 },
    () => randomUUID(),
  );
  const [classroomLive, classroomAdult, classroomDeleted] = Array.from({ length: 3 }, () =>
    randomUUID(),
  );
  const [linkLive, linkAdult, linkInactive, linkRemovedStudent, linkDeletedClassroom] = Array.from(
    { length: 5 },
    () => randomUUID(),
  );

  const token = (actor: string) => `Bearer family-test:${actor}`;
  const get = (path: string, actor?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return actor ? req.set('Authorization', token(actor)) : req;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }),
        MetricsModule,
        FamilyModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer family-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer family-test:'.length),
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

    await prisma.user.createMany({
      data: [
        { id: teacher, displayName: 'Prof. Ada', path: RegistrationPath.INDEPENDENT_TEACHER },
        { id: studentActive, displayName: 'Student Sofia', path: RegistrationPath.INVITEE },
        { id: studentRemoved, displayName: 'Student Former', path: RegistrationPath.INVITEE },
        { id: parentA, displayName: 'Parent Ana', path: RegistrationPath.INVITEE },
        { id: parentB, displayName: 'Parent Bruno', path: RegistrationPath.INVITEE },
        { id: stranger, displayName: 'Stranger', path: RegistrationPath.INVITEE },
      ].map((u) => ({
        id: u.id,
        email: `family-http-${u.id}@example.invalid`,
        passwordHash: 'unused-synthetic-hash',
        displayName: u.displayName,
        registrationPath: u.path,
      })),
    });

    await prisma.classroom.createMany({
      data: [
        {
          id: classroomLive,
          independentTeacherId: teacher,
          name: 'Physics A',
          subject: 'Mechanics',
          adultMode: false,
        },
        {
          id: classroomAdult,
          independentTeacherId: teacher,
          name: 'Adult Night Class',
          subject: null,
          adultMode: true,
        },
        {
          id: classroomDeleted,
          independentTeacherId: teacher,
          name: 'Deleted Class',
          deletedAt: new Date(),
        },
      ],
    });

    await prisma.classroomMembership.createMany({
      data: [
        {
          classroomId: classroomLive,
          userId: studentActive,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: classroomAdult,
          userId: studentActive,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: classroomDeleted,
          userId: studentActive,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: classroomLive,
          userId: studentRemoved,
          role: ClassroomRole.STUDENT,
          state: MembershipState.INACTIVE,
          deletedAt: new Date(),
        },
      ],
    });

    const t1 = new Date('2026-11-10T10:00:00.000Z');
    const t2 = new Date('2026-11-11T10:00:00.000Z');
    await prisma.parentLink.createMany({
      data: [
        {
          id: linkLive,
          parentId: parentA,
          childId: studentActive,
          classroomId: classroomLive,
          state: MembershipState.ACTIVE,
          createdAt: t1,
        },
        {
          id: linkAdult,
          parentId: parentA,
          childId: studentActive,
          classroomId: classroomAdult,
          state: MembershipState.ACTIVE,
          createdAt: t2,
        },
        {
          id: linkInactive,
          parentId: parentB,
          childId: studentActive,
          classroomId: classroomLive,
          state: MembershipState.INACTIVE,
          createdAt: t1,
        },
        {
          id: linkRemovedStudent,
          parentId: parentA,
          childId: studentRemoved,
          classroomId: classroomLive,
          state: MembershipState.ACTIVE,
          createdAt: t1,
        },
        {
          id: linkDeletedClassroom,
          parentId: parentA,
          childId: studentActive,
          classroomId: classroomDeleted,
          state: MembershipState.ACTIVE,
          createdAt: t1,
        },
      ],
    });

    // Published activities in classroomLive: 1 graded, 1 submitted ungraded, 1 pending
    const [actGraded, actUngraded, actPending] = Array.from({ length: 3 }, () => randomUUID());
    await prisma.activity.createMany({
      data: [
        {
          id: actGraded,
          classroomId: classroomLive,
          createdById: teacher,
          type: 'TP',
          format: 'FILE',
          state: 'PUBLISHED',
          publishedAt: new Date(Date.now() - 2 * HOUR_MS),
          title: 'Kinematics Lab',
          dueAt: new Date(Date.now() + DAY_MS),
          maxScore: 100,
        },
        {
          id: actUngraded,
          classroomId: classroomLive,
          createdById: teacher,
          type: 'EXAM',
          format: 'FILE',
          state: 'PUBLISHED',
          publishedAt: new Date(Date.now() - HOUR_MS),
          title: 'Midterm Exam',
          dueAt: new Date(Date.now() + DAY_MS),
          maxScore: 100,
        },
        {
          id: actPending,
          classroomId: classroomLive,
          createdById: teacher,
          type: 'TP',
          format: 'FILE',
          state: 'PUBLISHED',
          publishedAt: new Date(Date.now() - HOUR_MS),
          title: 'Pending Worksheet',
          dueAt: new Date(Date.now() + 2 * DAY_MS),
          maxScore: 100,
        },
      ],
    });

    const gradedAt = new Date('2026-11-20T15:00:00.000Z');
    const subGraded = await prisma.submission.create({
      data: {
        activityId: actGraded,
        studentId: studentActive,
        submittedAt: new Date('2026-11-20T14:00:00.000Z'),
        isLate: false,
        idempotencyKey: randomUUID(),
      },
    });
    await prisma.grade.create({
      data: {
        submissionId: subGraded.id,
        graderId: teacher,
        score: 88,
        feedback: 'Strong lab report',
        activityTitle: 'Kinematics Lab',
        maxScore: 100,
        pointsAwarded: 88,
        typeWeight: 1,
        weightMultiplier: 1,
        version: 1,
        gradedAt,
      },
    });
    await prisma.submission.create({
      data: {
        activityId: actUngraded,
        studentId: studentActive,
        submittedAt: new Date('2026-11-20T16:00:00.000Z'),
        isLate: false,
        idempotencyKey: randomUUID(),
      },
    });

    await prisma.activityMetric.create({
      data: {
        classroomId: classroomLive,
        userId: studentActive,
        day: new Date('2026-11-20T00:00:00.000Z'),
        connectedSeconds: 2400,
        submissionCount: 2,
        messageCount: 7,
      },
    });
  }, 20_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unauthenticated requests with 401', async () => {
    await get('/me/parent-links').expect(401);
    await get(`/me/parent-links/${linkLive}/report-card`).expect(401);
  });

  it('GET /me/parent-links returns active links including adultMode: true and excludes inactive/removed/deleted', async () => {
    const res = await get('/me/parent-links', parentA).expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      id: linkLive,
      classroomId: classroomLive,
      classroomName: 'Physics A',
      classroomSubject: 'Mechanics',
      schoolId: null,
      adultMode: false,
      childId: studentActive,
      childDisplayName: 'Student Sofia',
    });
    expect(res.body.items[1]).toMatchObject({
      id: linkAdult,
      classroomId: classroomAdult,
      classroomName: 'Adult Night Class',
      classroomSubject: null,
      schoolId: null,
      adultMode: true,
      childId: studentActive,
      childDisplayName: 'Student Sofia',
    });

    // User with only INACTIVE link or no links receives empty array.
    const resInactive = await get('/me/parent-links', parentB).expect(200);
    expect(resInactive.body).toEqual({ items: [] });

    const resStranger = await get('/me/parent-links', stranger).expect(200);
    expect(resStranger.body).toEqual({ items: [] });
  });

  it('GET /me/parent-links/:linkId/report-card matches student report card and includes participation metrics', async () => {
    const [parentRes, studentRes] = await Promise.all([
      get(`/me/parent-links/${linkLive}/report-card`, parentA).expect(200),
      get(`/classrooms/${classroomLive}/me/report-card`, studentActive).expect(200),
    ]);

    expect(parentRes.body.items).toEqual(studentRes.body.items);
    expect(parentRes.body.total).toBe(1);
    expect(parentRes.body.page).toBe(1);
    expect(parentRes.body.pageSize).toBe(20);
    expect(parentRes.body.link).toMatchObject({
      id: linkLive,
      classroomId: classroomLive,
      childId: studentActive,
      adultMode: false,
    });
    expect(parentRes.body.metrics).toEqual({
      connectedSeconds: 2400,
      submissionCount: 2,
      messageCount: 7,
      gradedCount: 1,
      ungradedCount: 1,
      pendingCount: 1,
      averageScorePercent: 88,
    });
  });

  it('enforces 404 anti-enumeration for foreign callers, invalid UUIDs, inactive links, and removed students, and 403 for adultMode', async () => {
    // Foreign callers / student / teacher trying linkLive -> 404
    for (const actor of [parentB, stranger, studentActive, teacher]) {
      await get(`/me/parent-links/${linkLive}/report-card`, actor).expect(404);
    }

    // Malformed UUID -> 404
    await get('/me/parent-links/not-a-uuid/report-card', parentA).expect(404);

    // Inactive link -> 404
    await get(`/me/parent-links/${linkInactive}/report-card`, parentB).expect(404);

    // Removed student -> 404
    await get(`/me/parent-links/${linkRemovedStudent}/report-card`, parentA).expect(404);

    // Deleted classroom -> 404
    await get(`/me/parent-links/${linkDeletedClassroom}/report-card`, parentA).expect(404);

    // Adult mode -> 403
    const adultRes = await get(`/me/parent-links/${linkAdult}/report-card`, parentA).expect(403);
    expect(adultRes.body.error.message).toContain('adult education mode');
  });
});
