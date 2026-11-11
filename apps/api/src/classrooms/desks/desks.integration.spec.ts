import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { SessionVerifier, type VerifiedSession } from '../../auth/session-verifier.service';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../../config/testing/isolated-test-database';
import { configureHttp } from '../../http/configure-http';
import { OutboxDispatcher } from '../../platform/outbox/outbox.dispatcher';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomsModule } from '../classrooms.module';
import type { JoinClassroomResponseDto } from '../dto/join-classroom-response.dto';
import type { ClassroomDeskDto, ClassroomDeskMapDto } from './desks.dto';

// No default URL or environment-file loading: the caller owns the disposable DB.
const databaseUrl = loadIsolatedTestDatabaseUrl();
const teacherId = randomUUID();
const studentIds = Array.from({ length: 14 }, () => randomUUID());
const userIds: string[] = [teacherId, ...studentIds];

describe('S4 desk map PostgreSQL HTTP acceptance (isolated task26 database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const authenticate = (userId: string) => ({ Authorization: `Bearer desk-test:${userId}` });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(authTestConfig({ databaseUrl })), ClassroomsModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string): Promise<VerifiedSession> => {
              const prefix = 'Bearer desk-test:';
              const userId = header?.startsWith(prefix) ? header.slice(prefix.length) : '';
              if (!userIds.includes(userId)) throw new UnauthorizedException();
              return { userId, sessionId: randomUUID() };
            },
          },
        },
      ],
    })
      // No background delivery or external service calls; removal still records its real event.
      .overrideProvider(OutboxDispatcher)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: `desk-acceptance-${id}@example.invalid`,
        displayName: id === teacherId ? 'Synthetic desk teacher' : 'Synthetic desk student',
        passwordHash: 'synthetic-unused-hash',
        registrationPath:
          id === teacherId ? RegistrationPath.INDEPENDENT_TEACHER : RegistrationPath.SCHOOL,
      })),
    });
  }, 20_000);

  afterAll(async () => {
    try {
      if (!prisma) return;
      // Teardown-only reads recover owned classrooms even if an HTTP assertion failed.
      // Every deletion is scoped to this suite's random teacher/student UUIDs.
      const owned = await prisma.classroom.findMany({
        where: { independentTeacherId: teacherId },
        select: { id: true },
      });
      const classroomIds = owned.map((row) => row.id);
      await prisma.$transaction(async (tx) => {
        for (const classroomId of classroomIds) {
          await tx.outboxEvent.deleteMany({
            where: {
              type: 'classroom.membership.removed',
              payload: { path: ['classroomId'], equals: classroomId },
            },
          });
        }
        await tx.joinCodeUsage.deleteMany({
          where: { invitation: { classroomId: { in: classroomIds } }, userId: { in: studentIds } },
        });
        await tx.invitation.deleteMany({
          where: { classroomId: { in: classroomIds }, createdById: teacherId },
        });
        await tx.desk.deleteMany({ where: { classroomId: { in: classroomIds } } });
        await tx.classroomMembership.deleteMany({
          where: { classroomId: { in: classroomIds }, userId: { in: userIds } },
        });
        await tx.classroomPet.deleteMany({ where: { classroomId: { in: classroomIds } } });
        await tx.classroom.deleteMany({
          where: { id: { in: classroomIds }, independentTeacherId: teacherId },
        });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      });
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('maps public enrollments exactly once through expansion, repeat join, release and reuse', async () => {
    const created = await request(app.getHttpServer())
      .post('/classrooms')
      .set(authenticate(teacherId))
      .send({ name: `Desk acceptance ${teacherId}` })
      .expect(201);
    const classroomId: string = created.body.id;
    expect(classroomId).toEqual(expect.any(String));
    const map = async (actorId = teacherId): Promise<ClassroomDeskMapDto> => {
      const response = await request(app.getHttpServer())
        .get(`/classrooms/${classroomId}/desks`)
        .set(authenticate(actorId))
        .expect(200);
      return response.body as ClassroomDeskMapDto;
    };
    const initial = await map();
    expect(initial.items).toHaveLength(12);
    expect(initial.items.map((desk) => desk.deskIndex)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    for (const desk of initial.items) {
      expect(desk.membershipId).toBeNull();
      expect(desk.userId).toBeNull();
    }
    const generated = await request(app.getHttpServer())
      .post(`/classrooms/${classroomId}/join-code`)
      .set(authenticate(teacherId))
      .send({})
      .expect(201);
    const join = async (studentId: string): Promise<JoinClassroomResponseDto> => {
      const response = await request(app.getHttpServer())
        .post('/classrooms/join')
        .set(authenticate(studentId))
        .send({ code: generated.body.code })
        .expect(201);
      return response.body as JoinClassroomResponseDto;
    };
    const expected = new Map<string, ClassroomDeskDto>();
    const rememberEnrollment = (userId: string, enrolled: JoinClassroomResponseDto) => {
      expect(enrolled).toMatchObject({ classroomId, role: 'STUDENT', alreadyMember: false });
      expect(enrolled.membershipId).toEqual(expect.any(String));
      expect(enrolled.desk).toMatchObject({
        id: expect.any(String),
        deskIndex: expect.any(Number),
      });
      if (!enrolled.desk) throw new Error('Public student enrollment must return its desk');
      expected.set(userId, { ...enrolled.desk, membershipId: enrolled.membershipId, userId });
    };
    const assertAssignments = (layout: ClassroomDeskMapDto) => {
      const assigned = layout.items.filter((desk) => desk.userId !== null);
      expect(assigned).toEqual(
        [...expected.values()].sort((left, right) => left.deskIndex - right.deskIndex),
      );
      // Public map cardinality and IDs must match every successful active enrollment response.
      expect(new Set(assigned.map((desk) => desk.membershipId)).size).toBe(expected.size);
      expect(new Set(assigned.map((desk) => desk.userId)).size).toBe(expected.size);
      expect(new Set(layout.items.map((desk) => desk.id)).size).toBe(layout.items.length);
    };
    for (const studentId of studentIds.slice(0, 13)) {
      rememberEnrollment(studentId, await join(studentId));
    }
    const expanded = await map(studentIds[0]);
    expect(expanded.items).toHaveLength(13);
    expect(expanded.items.map((desk) => desk.deskIndex)).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    );
    expect(expanded.items.slice(0, 12).map((desk) => desk.id)).toEqual(
      initial.items.map((desk) => desk.id),
    );
    assertAssignments(expanded);

    const repeated = await join(studentIds[0]);
    const released = expected.get(studentIds[0])!;
    expect(repeated).toMatchObject({
      classroomId,
      membershipId: released.membershipId,
      alreadyMember: true,
      desk: { id: released.id, deskIndex: released.deskIndex },
    });
    expect(await map()).toEqual(expanded);

    await request(app.getHttpServer())
      .delete(`/classrooms/${classroomId}/students/${studentIds[0]}`)
      .set(authenticate(teacherId))
      .expect(204);
    expected.delete(studentIds[0]);
    const afterRemoval = await map(studentIds[1]);
    expect(afterRemoval.items).toHaveLength(13);
    assertAssignments(afterRemoval);
    expect(afterRemoval.items.find((desk) => desk.id === released.id)).toEqual({
      id: released.id,
      deskIndex: released.deskIndex,
      membershipId: null,
      userId: null,
    });
    await request(app.getHttpServer())
      .get(`/classrooms/${classroomId}/desks`)
      .set(authenticate(studentIds[0]))
      .expect(404);

    rememberEnrollment(studentIds[13], await join(studentIds[13]));
    const afterReuse = await map(studentIds[13]);
    expect(afterReuse.items).toHaveLength(13);
    assertAssignments(afterReuse);
    expect(expected.get(studentIds[13])).toMatchObject({
      id: released.id,
      deskIndex: released.deskIndex,
    });
    expect(expected.get(studentIds[13])?.membershipId).not.toBe(released.membershipId);
    expect(await map()).toEqual(afterReuse);
  }, 30_000);
});
