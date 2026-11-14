import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, PointEntryKind, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';
import { PointsLedgerService } from './points-ledger.service';

// Real PostgreSQL and root AppModule; only session token verification is stubbed.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    owner: randomUUID(),
    admin: randomUUID(),
    teacher: randomUUID(),
    student: randomUUID(),
    classmate: randomUUID(),
    parent: randomUUID(),
    unlinkedParent: randomUUID(),
    stranger: randomUUID(),
    school: randomUUID(),
    otherSchool: randomUUID(),
    classroom: randomUUID(),
    foreignClassroom: randomUUID(),
  };
}

describe('Points HTTP contract (/classrooms/:id/points and /classrooms/:id/students/:studentId/points)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: PointsLedgerService;
  let ids: ReturnType<typeof makeIds>;

  const getOwn = (classroomId: string, actor: string, query = '') =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroomId}/points${query}`)
      .set('Authorization', `Bearer ${actor}`);

  const getStudent = (classroomId: string, studentId: string, actor: string, query = '') =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroomId}/students/${studentId}/points${query}`)
      .set('Authorization', `Bearer ${actor}`);

  const assertEnvelope = (body: unknown, code: string) => {
    expect(body).toMatchObject({
      error: { code, message: expect.any(String), correlationId: expect.any(String) },
    });
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot({ ...authTestConfig(), databaseUrl })],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          const actor = header?.replace('Bearer ', '');
          if (!actor || actor === 'invalid') throw new UnauthorizedException();
          return { userId: actor, sessionId: randomUUID() };
        },
      })
      .compile();

    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get(PointsLedgerService);
  }, 20_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    ids = makeIds();
    await prisma.user.createMany({
      data: [
        ids.owner,
        ids.admin,
        ids.teacher,
        ids.student,
        ids.classmate,
        ids.parent,
        ids.unlinkedParent,
        ids.stranger,
      ].map((id) => ({
        id,
        email: `points-http-${id}@example.invalid`,
        displayName: 'Synthetic User',
        passwordHash: 'unused-synthetic-hash',
        registrationPath: 'SCHOOL',
      })),
    });
    await prisma.school.createMany({
      data: [ids.school, ids.otherSchool].map((id) => ({
        id,
        name: 'Synthetic School',
        slug: id,
      })),
    });
    await prisma.schoolMember.createMany({
      data: [
        { schoolId: ids.school, userId: ids.owner, role: SchoolRole.OWNER },
        { schoolId: ids.school, userId: ids.admin, role: SchoolRole.ADMIN },
        { schoolId: ids.school, userId: ids.teacher, role: SchoolRole.TEACHER },
      ],
    });
    await prisma.classroom.createMany({
      data: [
        { id: ids.classroom, schoolId: ids.school, name: 'Main Classroom' },
        { id: ids.foreignClassroom, schoolId: ids.otherSchool, name: 'Foreign Classroom' },
      ],
    });
    await prisma.classroomMembership.createMany({
      data: [
        { classroomId: ids.classroom, userId: ids.teacher, role: ClassroomRole.TEACHER },
        { classroomId: ids.classroom, userId: ids.student, role: ClassroomRole.STUDENT },
        { classroomId: ids.classroom, userId: ids.classmate, role: ClassroomRole.STUDENT },
        { classroomId: ids.foreignClassroom, userId: ids.stranger, role: ClassroomRole.STUDENT },
      ],
    });
    await prisma.parentLink.createMany({
      data: [
        { classroomId: ids.classroom, parentId: ids.parent, childId: ids.student },
        { classroomId: ids.classroom, parentId: ids.unlinkedParent, childId: ids.classmate },
      ],
    });
  });

  it('returns server-derived balance, reason, ISO dates, pagination, and sorting on GET /classrooms/:id/points', async () => {
    const t1 = new Date('2026-11-10T10:00:00.000Z');
    const t2 = new Date('2026-11-11T10:00:00.000Z');
    const t3 = new Date('2026-11-12T10:00:00.000Z');
    const id1 = randomUUID();
    const id2 = randomUUID();
    const id3 = randomUUID();

    await prisma.pointTransaction.createMany({
      data: [
        {
          id: id1,
          classroomId: ids.classroom,
          studentId: ids.student,
          actorId: ids.teacher,
          entryKind: PointEntryKind.EARNING,
          amount: 100,
          sourceType: 'submission_grade',
          sourceId: randomUUID(),
          reason: 'Quiz #1 graded',
          createdAt: t1,
        },
        {
          id: id2,
          classroomId: ids.classroom,
          studentId: ids.student,
          actorId: ids.student,
          entryKind: PointEntryKind.DEBIT,
          amount: -35,
          sourceType: 'shop_purchase',
          sourceId: randomUUID(),
          reason: 'Pet scarf purchase',
          createdAt: t2,
        },
        {
          id: id3,
          classroomId: ids.classroom,
          studentId: ids.student,
          actorId: ids.teacher,
          entryKind: PointEntryKind.COMPENSATION,
          amount: 15,
          sourceType: 'grade_regrade',
          sourceId: randomUUID(),
          reason: 'Bonus point correction',
          createdAt: t3,
        },
      ],
    });

    const page1 = await getOwn(ids.classroom, ids.student, '?page=1&pageSize=2').expect(200);
    expect(page1.body).toEqual({
      classroomId: ids.classroom,
      studentId: ids.student,
      balance: 80,
      page: 1,
      pageSize: 2,
      total: 3,
      items: [
        {
          id: id3,
          entryKind: PointEntryKind.COMPENSATION,
          amount: 15,
          sourceType: 'grade_regrade',
          sourceId: expect.any(String),
          reason: 'Bonus point correction',
          actorId: ids.teacher,
          createdAt: t3.toISOString(),
        },
        {
          id: id2,
          entryKind: PointEntryKind.DEBIT,
          amount: -35,
          sourceType: 'shop_purchase',
          sourceId: expect.any(String),
          reason: 'Pet scarf purchase',
          actorId: ids.student,
          createdAt: t2.toISOString(),
        },
      ],
    });

    const sortedByAmountAsc = await getOwn(ids.classroom, ids.student, '?sort=amount').expect(200);
    expect(sortedByAmountAsc.body.items.map((item: { amount: number }) => item.amount)).toEqual([
      -35, 15, 100,
    ]);

    const sortedByAmountDesc = await getOwn(ids.classroom, ids.student, '?sort=-amount').expect(
      200,
    );
    expect(sortedByAmountDesc.body.items.map((item: { amount: number }) => item.amount)).toEqual([
      100, 15, -35,
    ]);
  });

  it('enforces resource isolation on GET /classrooms/:id/points across foreign classrooms and non-student roles', async () => {
    await assertResourceAuthorization({
      allowedResourceId: ids.classroom,
      foreignResourceId: ids.foreignClassroom,
      interaction: { page: 1, pageSize: 20 },
      deniedStatus: 404,
      request: (resourceId, interaction) => {
        const req = getOwn(resourceId, ids.student);
        return interaction === undefined ? req : req.query(interaction);
      },
      assertAllowed: (res) => {
        expect(res.body).toMatchObject({
          classroomId: ids.classroom,
          studentId: ids.student,
          balance: 0,
        });
      },
      assertDenied: (res) => {
        assertEnvelope(res.body, 'NOT_FOUND');
      },
    });

    // Staff and linked parent get 403 on own-student endpoint /classrooms/:id/points
    for (const actor of [ids.teacher, ids.owner, ids.admin, ids.parent]) {
      const res = await getOwn(ids.classroom, actor).expect(403);
      assertEnvelope(res.body, 'FORBIDDEN');
    }

    // Stranger gets 404
    assertEnvelope((await getOwn(ids.classroom, ids.stranger).expect(404)).body, 'NOT_FOUND');
  });

  it('authorizes GET /classrooms/:id/students/:studentId/points for self, staff, and linked non-adult parent', async () => {
    await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 60,
      sourceType: 'submission_grade',
      sourceId: randomUUID(),
      reason: 'Homework 1',
      actorId: ids.teacher,
    });

    for (const actor of [ids.student, ids.teacher, ids.owner, ids.admin, ids.parent]) {
      const res = await getStudent(ids.classroom, ids.student, actor).expect(200);
      expect(res.body).toMatchObject({
        classroomId: ids.classroom,
        studentId: ids.student,
        balance: 60,
        total: 1,
      });
    }

    // Classmate -> 403 Forbidden
    assertEnvelope(
      (await getStudent(ids.classroom, ids.student, ids.classmate).expect(403)).body,
      'FORBIDDEN',
    );

    // Unlinked parent (linked only to classmate) -> 404 NotFound
    assertEnvelope(
      (await getStudent(ids.classroom, ids.student, ids.unlinkedParent).expect(404)).body,
      'NOT_FOUND',
    );

    // Cross-school / stranger -> 404 NotFound
    assertEnvelope(
      (await getStudent(ids.classroom, ids.student, ids.stranger).expect(404)).body,
      'NOT_FOUND',
    );
    assertEnvelope(
      (await getStudent(ids.foreignClassroom, ids.student, ids.student).expect(404)).body,
      'NOT_FOUND',
    );

    // Adult mode hides child wallet from linked parent (404), while keeping staff & self at 200
    await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: true } });
    assertEnvelope(
      (await getStudent(ids.classroom, ids.student, ids.parent).expect(404)).body,
      'NOT_FOUND',
    );
    await getStudent(ids.classroom, ids.student, ids.teacher).expect(200);
    await getStudent(ids.classroom, ids.student, ids.student).expect(200);
  });

  it('denies removed student and inactive parent link on student wallet endpoint', async () => {
    await prisma.parentLink.updateMany({
      where: { classroomId: ids.classroom, parentId: ids.parent, childId: ids.student },
      data: { state: MembershipState.INACTIVE },
    });
    assertEnvelope(
      (await getStudent(ids.classroom, ids.student, ids.parent).expect(404)).body,
      'NOT_FOUND',
    );

    await prisma.classroomMembership.updateMany({
      where: { classroomId: ids.classroom, userId: ids.student },
      data: { state: MembershipState.INACTIVE, deletedAt: new Date() },
    });
    assertEnvelope(
      (await getStudent(ids.classroom, ids.student, ids.student).expect(404)).body,
      'NOT_FOUND',
    );
    assertEnvelope(
      (await getStudent(ids.classroom, ids.student, ids.teacher).expect(404)).body,
      'NOT_FOUND',
    );
  });

  it('rejects client balance tampering, unknown sort/query params, and non-existent transfer/write routes', async () => {
    for (const invalidQuery of ['?balance=100', '?studentId=abc', '?sort=reason', '?page=0']) {
      assertEnvelope(
        (await getOwn(ids.classroom, ids.student, invalidQuery).expect(400)).body,
        'VALIDATION_FAILED',
      );
    }

    await request(app.getHttpServer())
      .post(`/classrooms/${ids.classroom}/points`)
      .set('Authorization', `Bearer ${ids.student}`)
      .send({ balance: 999 })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/classrooms/${ids.classroom}/points`)
      .set('Authorization', `Bearer ${ids.student}`)
      .send({ balance: 999 })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/classrooms/${ids.classroom}/points/transfer`)
      .set('Authorization', `Bearer ${ids.student}`)
      .send({ toStudentId: ids.classmate, amount: 10 })
      .expect(404);
  });

  it('requires authentication on wallet endpoints', async () => {
    for (const path of [
      `/classrooms/${ids.classroom}/points`,
      `/classrooms/${ids.classroom}/students/${ids.student}/points`,
    ]) {
      assertEnvelope(
        (await request(app.getHttpServer()).get(path).expect(401)).body,
        'UNAUTHENTICATED',
      );
      assertEnvelope(
        (
          await request(app.getHttpServer())
            .get(path)
            .set('Authorization', 'Bearer invalid')
            .expect(401)
        ).body,
        'UNAUTHENTICATED',
      );
    }
  });
});
