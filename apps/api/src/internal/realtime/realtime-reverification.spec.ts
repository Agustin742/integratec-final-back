import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessModule } from '../../access/access.module';
import { AuthModule } from '../../auth/auth.module';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { configureHttp } from '../../http/configure-http';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { INTERNAL_SERVICE_SECRET_HEADER } from './internal-service.guard';
import { RealtimeJoinModule } from './realtime-join.module';

const ROUTE = '/internal/realtime/access-reverification';

describe('POST /internal/realtime/access-reverification (#25)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const config = authTestConfig();
  const ts = Date.now();
  const userIds: string[] = [];
  const classroomIds: string[] = [];
  const sessionIds: string[] = [];

  let teacherId: string;
  let studentId: string;
  let strangerId: string;
  let classroomId: string;
  let studentSessionId: string;
  let teacherSessionId: string;
  let membershipId: string;

  const post = (body: object, secret: string | null = config.internalServiceSecret) => {
    const req = request(app.getHttpServer()).post(ROUTE);
    return (secret === null ? req : req.set(INTERNAL_SERVICE_SECRET_HEADER, secret)).send(body);
  };

  const makeUser = async (label: string) => {
    const user = await prisma.user.create({
      data: {
        email: `${label}.${ts}@example.com`,
        passwordHash: 'dummy-hash-for-integration-tests',
        displayName: label,
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userIds.push(user.id);
    return user.id;
  };

  const makeSession = async (
    userId: string,
    overrides: { revokedAt?: Date; expiresAt?: Date } = {},
  ) => {
    const session = await prisma.session.create({
      data: {
        userId,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000),
        revokedAt: overrides.revokedAt,
      },
    });
    sessionIds.push(session.id);
    return session.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(config),
        PrismaModule,
        AuthModule,
        AccessModule,
        RealtimeJoinModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);

    teacherId = await makeUser('rv-teacher');
    studentId = await makeUser('rv-student');
    strangerId = await makeUser('rv-stranger');
    const classroom = await prisma.classroom.create({
      data: { name: `RV Classroom ${ts}`, independentTeacherId: teacherId },
    });
    classroomId = classroom.id;
    classroomIds.push(classroom.id);
    const membership = await prisma.classroomMembership.create({
      data: {
        classroomId,
        userId: studentId,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
      },
    });
    membershipId = membership.id;
    teacherSessionId = await makeSession(teacherId);
    studentSessionId = await makeSession(studentId);
  });

  afterAll(async () => {
    await prisma?.classroomMembership.deleteMany({ where: { classroomId: { in: classroomIds } } });
    await prisma?.parentLink.deleteMany({ where: { classroomId: { in: classroomIds } } });
    await prisma?.classroom.deleteMany({ where: { id: { in: classroomIds } } });
    await prisma?.session.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma?.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
  });

  it('answers 200 with the current identity of a user whose access still holds', async () => {
    const res = await post({
      userId: teacherId,
      sessionId: teacherSessionId,
      classroomId,
    }).expect(200);
    expect(res.body).toEqual({
      userId: teacherId,
      sessionId: teacherSessionId,
      classroomId,
      role: 'TEACHER',
      displayName: 'rv-teacher',
    });
  });

  it('maps an active student membership to its role', async () => {
    const res = await post({ userId: studentId, sessionId: studentSessionId, classroomId }).expect(
      200,
    );
    expect(res.body).toMatchObject({ userId: studentId, role: 'STUDENT' });
  });

  describe('lost access', () => {
    it('answers 404 once the student membership is deactivated', async () => {
      await prisma.classroomMembership.update({
        where: { id: membershipId },
        data: { state: MembershipState.INACTIVE },
      });
      try {
        await post({ userId: studentId, sessionId: studentSessionId, classroomId }).expect(404);
      } finally {
        await prisma.classroomMembership.update({
          where: { id: membershipId },
          data: { state: MembershipState.ACTIVE },
        });
      }
    });

    it('answers 404 for a user who never had access', async () => {
      const sessionId = await makeSession(strangerId);
      await post({ userId: strangerId, sessionId, classroomId }).expect(404);
    });

    it('answers 401 for a revoked session', async () => {
      const sessionId = await makeSession(studentId, { revokedAt: new Date() });
      await post({ userId: studentId, sessionId, classroomId }).expect(401);
    });

    it('answers 401 for an expired session', async () => {
      const sessionId = await makeSession(studentId, { expiresAt: new Date(Date.now() - 1000) });
      await post({ userId: studentId, sessionId, classroomId }).expect(401);
    });

    it('answers 401 when the session belongs to another user', async () => {
      await post({ userId: studentId, sessionId: teacherSessionId, classroomId }).expect(401);
    });

    it('answers 401 for an unknown session', async () => {
      await post({
        userId: studentId,
        sessionId: '99999999-9999-4999-8999-999999999999',
        classroomId,
      }).expect(401);
    });

    it('denies a linked parent a live join with 403', async () => {
      const parentId = await makeUser('rv-parent');
      const sessionId = await makeSession(parentId);
      await prisma.parentLink.create({
        data: { parentId, childId: studentId, classroomId, state: MembershipState.ACTIVE },
      });

      await post({ userId: parentId, sessionId, classroomId }).expect(403);
    });
  });

  describe('service authentication', () => {
    const body = () => ({ userId: studentId, sessionId: studentSessionId, classroomId });

    it('rejects a missing secret with 401', async () => {
      await post(body(), null).expect(401);
    });

    it('rejects a wrong secret with 401', async () => {
      await post(body(), 'x'.repeat(config.internalServiceSecret.length)).expect(401);
    });
  });

  describe('body validation', () => {
    it.each([
      ['a malformed userId', { userId: 'x' }],
      ['a malformed sessionId', { sessionId: 'x' }],
      ['a malformed classroomId', { classroomId: 'x' }],
      ['an unexpected access token', { accessToken: 'token' }],
      ['an unexpected field', { extra: 1 }],
    ])('answers 400 for %s', async (_label, override) => {
      await post({
        userId: studentId,
        sessionId: studentSessionId,
        classroomId,
        ...override,
      }).expect(400);
    });

    it('answers 400 for an empty body', async () => {
      await post({}).expect(400);
    });
  });
});
