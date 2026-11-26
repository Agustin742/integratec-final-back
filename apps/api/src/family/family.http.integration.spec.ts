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

  const [
    schoolId,
    schoolClassroom,
    schoolLink,
    schoolOwner,
    schoolAdmin,
    schoolOnlyTeacher,
    schoolTeacher,
    schoolParent,
  ] = Array.from({ length: 8 }, () => randomUUID());

  const token = (actor: string) => `Bearer family-test:${actor}`;
  const get = (path: string, actor?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return actor ? req.set('Authorization', token(actor)) : req;
  };
  const post = (path: string, actor?: string) => {
    const req = request(app.getHttpServer()).post(path);
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

    await prisma.user.createMany({
      data: [schoolOwner, schoolAdmin, schoolOnlyTeacher, schoolTeacher, schoolParent].map(
        (id) => ({
          id,
          email: `family-http-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          displayName: 'Synthetic school member',
          registrationPath: RegistrationPath.INVITEE,
        }),
      ),
    });
    await prisma.school.create({
      data: { id: schoolId, name: 'Synthetic private school', slug: `family-${schoolId}` },
    });
    await prisma.schoolMember.createMany({
      data: [
        { schoolId, userId: schoolOwner, role: 'OWNER' },
        { schoolId, userId: schoolAdmin, role: 'ADMIN' },
        { schoolId, userId: schoolParent, role: 'ADMIN' },
        { schoolId, userId: schoolTeacher, role: 'TEACHER' },
        { schoolId, userId: schoolOnlyTeacher, role: 'TEACHER' },
      ],
    });
    await prisma.classroom.create({
      data: { id: schoolClassroom, schoolId, name: 'Private classroom' },
    });
    await prisma.classroomMembership.createMany({
      data: [
        ...[schoolTeacher, schoolOwner, schoolAdmin].map((userId) => ({
          classroomId: schoolClassroom,
          userId,
          role: ClassroomRole.TEACHER,
        })),
        { classroomId: schoolClassroom, userId: studentActive, role: ClassroomRole.STUDENT },
      ],
    });
    await prisma.parentLink.create({
      data: {
        id: schoolLink,
        classroomId: schoolClassroom,
        parentId: schoolParent,
        childId: studentActive,
      },
    });
    await prisma.message.create({
      data: {
        parentLinkId: schoolLink,
        authorId: schoolParent,
        body: 'Private school conversation',
      },
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
    await get('/me/family-threads').expect(401);
    await get(`/parent-links/${linkLive}/messages`).expect(401);
    await post(`/parent-links/${linkLive}/messages`).send({ body: 'Hi' }).expect(401);
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
    expect(adultRes.body.error.code).toBe('FORBIDDEN');
  });

  it('POST + GET /parent-links/:linkId/messages completes Parent <-> Teacher roundtrip with classroomId NULL in PostgreSQL', async () => {
    const parentPost = await post(`/parent-links/${linkLive}/messages`, parentA)
      .send({ body: '  Hello Prof. Ada, how is Sofia doing?  ' })
      .expect(201);

    expect(parentPost.body).toMatchObject({
      parentLinkId: linkLive,
      authorId: parentA,
      authorDisplayName: 'Parent Ana',
      authorRole: 'PARENT',
      body: 'Hello Prof. Ada, how is Sofia doing?',
    });
    expect(typeof parentPost.body.id).toBe('string');
    expect(typeof parentPost.body.createdAt).toBe('string');

    const teacherPost = await post(`/parent-links/${linkLive}/messages`, teacher)
      .send({ body: 'Hello Ana!\nSofia is doing great in Physics.' })
      .expect(201);

    expect(teacherPost.body).toMatchObject({
      parentLinkId: linkLive,
      authorId: teacher,
      authorDisplayName: 'Prof. Ada',
      authorRole: 'STAFF',
      body: 'Hello Ana!\nSofia is doing great in Physics.',
    });

    // Seed a hidden message to confirm hidden rows are excluded from GET.
    await prisma.message.create({
      data: {
        parentLinkId: linkLive,
        classroomId: null,
        authorId: teacher,
        body: 'Hidden internal note',
        hiddenAt: new Date(),
        hiddenById: teacher,
      },
    });

    // Verify PostgreSQL rows strictly have classroomId === null.
    const dbRows = await prisma.message.findMany({
      where: { parentLinkId: linkLive },
      select: { id: true, classroomId: true, parentLinkId: true },
    });
    expect(dbRows).toHaveLength(3);
    for (const row of dbRows) {
      expect(row.classroomId).toBeNull();
      expect(row.parentLinkId).toBe(linkLive);
    }

    // Both parent and teacher read the same chronological thread (excluding hidden messages).
    const [parentGet, teacherGet] = await Promise.all([
      get(`/parent-links/${linkLive}/messages`, parentA).expect(200),
      get(`/parent-links/${linkLive}/messages`, teacher).expect(200),
    ]);

    expect(parentGet.body).toEqual(teacherGet.body);
    expect(parentGet.body.total).toBe(2);
    expect(parentGet.body.page).toBe(1);
    expect(parentGet.body.pageSize).toBe(30);
    expect(parentGet.body.link).toMatchObject({
      id: linkLive,
      classroomId: classroomLive,
      childId: studentActive,
      adultMode: false,
    });
    expect(parentGet.body.items).toEqual([parentPost.body, teacherPost.body]);

    // Pagination slice check
    const page2 = await get(`/parent-links/${linkLive}/messages?page=2&pageSize=1`, parentA).expect(
      200,
    );
    expect(page2.body.total).toBe(2);
    expect(page2.body.page).toBe(2);
    expect(page2.body.pageSize).toBe(1);
    expect(page2.body.items).toEqual([teacherPost.body]);

    // Invalid query & DTO body validation -> 400
    await get(`/parent-links/${linkLive}/messages?pageSize=51`, parentA).expect(400);
    await post(`/parent-links/${linkLive}/messages`, parentA).send({ body: '   ' }).expect(400);
    await post(`/parent-links/${linkLive}/messages`, parentA)
      .send({ body: 'a'.repeat(2001) })
      .expect(400);
    await post(`/parent-links/${linkLive}/messages`, parentA)
      .send({ body: 'bad\u0000text' })
      .expect(400);
  });

  it('enforces 404 anti-enumeration for child, foreign parent, outsider, inactive/removed/deleted links, and 403 in adultMode', async () => {
    // Student (childId), foreign parent, and outsider -> 404 on GET & POST
    for (const actor of [studentActive, parentB, stranger]) {
      await get(`/parent-links/${linkLive}/messages`, actor).expect(404);
      await post(`/parent-links/${linkLive}/messages`, actor).send({ body: 'Hi' }).expect(404);
    }

    // Malformed UUID -> 404
    await get('/parent-links/not-a-uuid/messages', parentA).expect(404);
    await post('/parent-links/not-a-uuid/messages', parentA).send({ body: 'Hi' }).expect(404);

    // Inactive link -> 404
    await get(`/parent-links/${linkInactive}/messages`, parentB).expect(404);
    await post(`/parent-links/${linkInactive}/messages`, parentB).send({ body: 'Hi' }).expect(404);

    // Removed student -> 404
    await get(`/parent-links/${linkRemovedStudent}/messages`, parentA).expect(404);
    await post(`/parent-links/${linkRemovedStudent}/messages`, teacher)
      .send({ body: 'Hi' })
      .expect(404);

    // Deleted classroom -> 404
    await get(`/parent-links/${linkDeletedClassroom}/messages`, parentA).expect(404);
    await post(`/parent-links/${linkDeletedClassroom}/messages`, teacher)
      .send({ body: 'Hi' })
      .expect(404);

    // Adult mode -> 403 for authorized participants (writes nothing), 404 for unauthorized callers
    for (const actor of [parentA, teacher]) {
      const getAdult = await get(`/parent-links/${linkAdult}/messages`, actor).expect(403);
      expect(getAdult.body.error.code).toBe('FORBIDDEN');
      const postAdult = await post(`/parent-links/${linkAdult}/messages`, actor)
        .send({ body: 'Blocked' })
        .expect(403);
      expect(postAdult.body.error.code).toBe('FORBIDDEN');
    }
    await get(`/parent-links/${linkAdult}/messages`, studentActive).expect(404);
    await post(`/parent-links/${linkAdult}/messages`, stranger).send({ body: 'Hi' }).expect(404);

    const adultMessagesCount = await prisma.message.count({ where: { parentLinkId: linkAdult } });
    expect(adultMessagesCount).toBe(0);
  });

  it('privacy: denies school Owner/Admin even with TEACHER membership, school-only teachers, and inactive school members', async () => {
    const inactiveSchoolTeacher = randomUUID();
    await prisma.user.create({
      data: {
        id: inactiveSchoolTeacher,
        email: `family-http-${inactiveSchoolTeacher}@example.invalid`,
        passwordHash: 'unused-synthetic-hash',
        displayName: 'Inactive school teacher',
        registrationPath: RegistrationPath.INVITEE,
      },
    });
    await prisma.schoolMember.create({
      data: {
        schoolId,
        userId: inactiveSchoolTeacher,
        role: 'TEACHER',
        state: MembershipState.INACTIVE,
      },
    });
    await prisma.classroomMembership.create({
      data: {
        classroomId: schoolClassroom,
        userId: inactiveSchoolTeacher,
        role: ClassroomRole.TEACHER,
        state: MembershipState.ACTIVE,
      },
    });

    const before = await prisma.message.count({ where: { parentLinkId: schoolLink } });
    for (const actor of [schoolOwner, schoolAdmin, schoolOnlyTeacher, inactiveSchoolTeacher]) {
      await get(`/parent-links/${schoolLink}/messages`, actor).expect(404);
      await post(`/parent-links/${schoolLink}/messages`, actor)
        .send({ body: 'Denied' })
        .expect(404);
      const inbox = await get('/me/family-threads', actor).expect(200);
      expect(inbox.body).toEqual({ items: [] });
    }
    expect(await prisma.message.count({ where: { parentLinkId: schoolLink } })).toBe(before);

    const schoolTeacherInbox = await get('/me/family-threads', schoolTeacher).expect(200);
    expect(schoolTeacherInbox.body.items.map((item: { id: string }) => item.id)).toContain(
      schoolLink,
    );

    for (const actor of [schoolTeacher, schoolParent]) {
      await get(`/parent-links/${schoolLink}/messages`, actor).expect(200);
      await post(`/parent-links/${schoolLink}/messages`, actor)
        .send({ body: 'Participant reply' })
        .expect(201);
    }
    // The ADMIN parent sees only their own link, never a staff inbox.
    expect((await get('/me/family-threads', schoolParent).expect(200)).body).toEqual({ items: [] });
  });

  it('send limiting: bounds concurrent admission at the persisted window without partial writes', async () => {
    const limitLink = randomUUID();
    await prisma.parentLink.create({
      data: {
        id: limitLink,
        parentId: parentB,
        childId: studentActive,
        classroomId: schoolClassroom,
      },
    });
    await prisma.message.createMany({
      data: Array.from({ length: 4 }, () => ({
        parentLinkId: limitLink,
        authorId: parentB,
        body: 'Recent send',
        createdAt: new Date(),
      })),
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        post(
          `/parent-links/${index % 2 ? limitLink.toUpperCase() : limitLink}/messages`,
          parentB,
        ).send({ body: 'Concurrent send' }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([201, 429, 429, 429]);
    expect(await prisma.message.count({ where: { parentLinkId: limitLink } })).toBe(5);
    await post(`/parent-links/${limitLink}/messages`, parentB)
      .send({ body: 'Over limit' })
      .expect(429);
    expect(await prisma.message.count({ where: { parentLinkId: limitLink } })).toBe(5);
    // Other authors and threads have separate quotas.
    await post(`/parent-links/${limitLink}/messages`, schoolTeacher)
      .send({ body: 'Teacher reply' })
      .expect(201);
    await post(`/parent-links/${schoolLink}/messages`, parentB)
      .send({ body: 'Foreign link' })
      .expect(404);
  });

  it('send limiting: expires old sends, counts hidden sends, and isolates each thread', async () => {
    const expiryLink = randomUUID();
    const expiryClassroom = randomUUID();
    await prisma.classroom.create({ data: { id: expiryClassroom, schoolId, name: 'Expiry test' } });
    await prisma.classroomMembership.create({
      data: {
        classroomId: expiryClassroom,
        userId: studentActive,
        role: ClassroomRole.STUDENT,
      },
    });
    await prisma.parentLink.create({
      data: {
        id: expiryLink,
        classroomId: expiryClassroom,
        parentId: schoolParent,
        childId: studentActive,
      },
    });
    await prisma.message.createMany({
      data: Array.from({ length: 5 }, () => ({
        parentLinkId: expiryLink,
        authorId: schoolParent,
        body: 'Expired send',
        createdAt: new Date(Date.now() - 60_000),
      })),
    });
    await post(`/parent-links/${expiryLink}/messages`, schoolParent)
      .send({ body: 'Window renewed' })
      .expect(201);
    await prisma.message.createMany({
      data: Array.from({ length: 4 }, () => ({
        parentLinkId: expiryLink,
        authorId: schoolParent,
        body: 'Hidden recent send',
        hiddenAt: new Date(),
        hiddenById: teacher,
      })),
    });
    await post(`/parent-links/${expiryLink}/messages`, schoolParent)
      .send({ body: 'Over limit' })
      .expect(429);
    expect(await prisma.message.count({ where: { parentLinkId: expiryLink } })).toBe(10);
    await post(`/parent-links/${schoolLink}/messages`, schoolParent)
      .send({ body: 'Other thread' })
      .expect(201);
    const page = await get(`/parent-links/${expiryLink}/messages`, schoolParent).expect(200);
    const expected = await prisma.message.findMany({
      where: { parentLinkId: expiryLink, hiddenAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    expect(page.body.items.map((item: { id: string }) => item.id)).toEqual(
      expected.map((row) => row.id),
    );
  });

  it('GET /me/family-threads returns active threads with latest visible message preview for teacher and { items: [] } for student/parent', async () => {
    const parentFollowUp = await post(`/parent-links/${linkLive}/messages`, parentA)
      .send({ body: 'Thank you Prof. Ada!' })
      .expect(201);

    const teacherRes = await get('/me/family-threads', teacher).expect(200);
    expect(teacherRes.body).toEqual({
      items: [
        {
          id: linkLive,
          classroomId: classroomLive,
          classroomName: 'Physics A',
          parentId: parentA,
          parentDisplayName: 'Parent Ana',
          childId: studentActive,
          childDisplayName: 'Student Sofia',
          lastMessageBody: 'Thank you Prof. Ada!',
          lastMessageAt: parentFollowUp.body.createdAt,
          lastMessageAuthorRole: 'PARENT',
        },
      ],
    });

    for (const actor of [studentActive, parentA, stranger]) {
      const res = await get('/me/family-threads', actor).expect(200);
      expect(res.body).toEqual({ items: [] });
    }
  });
});
