import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { SessionVerifier, type VerifiedSession } from '../../auth/session-verifier.service';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../../config/testing/isolated-test-database';
import { configureHttp } from '../../http/configure-http';
import { OutboxDispatcher } from '../../platform/outbox/outbox.dispatcher';
import { OutboxWriter } from '../../platform/outbox/outbox.writer';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomsModule } from '../classrooms.module';
import { ClassroomRosterModule } from '../roster/roster.module';
import { ClassroomRemovalModule } from './classroom-removal.module';

// The caller must supply its isolated test database; never load an environment file
// or silently connect to a developer's default database. No provisioning or seeding here.
const databaseUrl = loadIsolatedTestDatabaseUrl();
const eventType = 'classroom.membership.removed';

function identifiers() {
  return {
    teacher: randomUUID(),
    student: randomUUID(),
    sibling: randomUUID(),
    soleParent: randomUUID(),
    sharedParent: randomUUID(),
    classroom: randomUUID(),
    otherClassroom: randomUUID(),
    membership: randomUUID(),
    otherMembership: randomUUID(),
    siblingMembership: randomUUID(),
    desk: randomUUID(),
    otherDesk: randomUUID(),
    childLink: randomUUID(),
    sharedLink: randomUUID(),
    siblingLink: randomUUID(),
    otherLink: randomUUID(),
  };
}

describe('Classroom removal PostgreSQL HTTP integration (isolated odd23 fixture)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ids: ReturnType<typeof identifiers>;
  let fixtureReady = false;
  const token = (userId: string) => `Bearer test-user:${userId}`;
  const detail = (actor: string, classroom = ids.classroom) =>
    request(app.getHttpServer()).get(`/classrooms/${classroom}`).set('Authorization', token(actor));
  const remove = () =>
    request(app.getHttpServer())
      .delete(`/classrooms/${ids.classroom}/students/${ids.student}`)
      .set('Authorization', token(ids.teacher));
  const roster = () =>
    request(app.getHttpServer())
      .get(`/classrooms/${ids.classroom}/roster`)
      .set('Authorization', token(ids.teacher));
  const events = () =>
    prisma.outboxEvent.findMany({
      where: { type: eventType, payload: { path: ['classroomId'], equals: ids.classroom } },
      orderBy: { id: 'asc' },
    });
  const snapshot = async () => ({
    memberships: await prisma.classroomMembership.findMany({
      where: { classroomId: { in: [ids.classroom, ids.otherClassroom] } },
      orderBy: { id: 'asc' },
    }),
    desks: await prisma.desk.findMany({
      where: { id: { in: [ids.desk, ids.otherDesk] } },
      orderBy: { id: 'asc' },
    }),
    links: await prisma.parentLink.findMany({
      where: { id: { in: [ids.childLink, ids.sharedLink, ids.siblingLink, ids.otherLink] } },
      orderBy: { id: 'asc' },
    }),
    events: await events(),
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }),
        ClassroomsModule,
        ClassroomRemovalModule,
        ClassroomRosterModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string): Promise<VerifiedSession> => {
              if (!header?.startsWith('Bearer test-user:')) throw new UnauthorizedException();
              return { userId: header.slice('Bearer test-user:'.length), sessionId: randomUUID() };
            },
          },
        },
      ],
    })
      .overrideProvider(OutboxDispatcher)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
  }, 20_000);

  beforeEach(async () => {
    ids = identifiers();
    fixtureReady = false;
    // One transaction means setup failure cannot leave a partially owned fixture.
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          [ids.teacher, 'Teacher'],
          [ids.student, 'Student'],
          [ids.sibling, 'Sibling'],
          [ids.soleParent, 'Sole parent'],
          [ids.sharedParent, 'Shared parent'],
        ].map(([id, displayName]) => ({
          id,
          displayName,
          email: `removal-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [ids.classroom, ids.otherClassroom].map((id) => ({
          id,
          name: `Removal fixture ${id}`,
          independentTeacherId: ids.teacher,
        })),
      });
      await tx.classroomMembership.createMany({
        data: [
          { id: ids.membership, classroomId: ids.classroom, userId: ids.student },
          { id: ids.siblingMembership, classroomId: ids.classroom, userId: ids.sibling },
          { id: ids.otherMembership, classroomId: ids.otherClassroom, userId: ids.student },
        ].map((membership) => ({ ...membership, role: ClassroomRole.STUDENT })),
      });
      await tx.desk.createMany({
        data: [
          { id: ids.desk, classroomId: ids.classroom, membershipId: ids.membership, deskIndex: 1 },
          {
            id: ids.otherDesk,
            classroomId: ids.otherClassroom,
            membershipId: ids.otherMembership,
            deskIndex: 1,
          },
        ],
      });
      await tx.parentLink.createMany({
        data: [
          {
            id: ids.childLink,
            parentId: ids.soleParent,
            childId: ids.student,
            classroomId: ids.classroom,
          },
          {
            id: ids.sharedLink,
            parentId: ids.sharedParent,
            childId: ids.student,
            classroomId: ids.classroom,
          },
          {
            id: ids.siblingLink,
            parentId: ids.sharedParent,
            childId: ids.sibling,
            classroomId: ids.classroom,
          },
          {
            id: ids.otherLink,
            parentId: ids.soleParent,
            childId: ids.student,
            classroomId: ids.otherClassroom,
          },
        ],
      });
    });
    fixtureReady = true;
  }, 20_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!fixtureReady) return;
    // Only this test's generated UUIDs are eligible. Never truncate or delete by type alone.
    await prisma.$transaction(async (tx) => {
      await tx.outboxEvent.deleteMany({
        where: {
          type: eventType,
          payload: { path: ['classroomId'], equals: ids.classroom },
        },
      });
      await tx.parentLink.deleteMany({
        where: {
          id: { in: [ids.childLink, ids.sharedLink, ids.siblingLink, ids.otherLink] },
        },
      });
      await tx.desk.deleteMany({ where: { id: { in: [ids.desk, ids.otherDesk] } } });
      await tx.classroomMembership.deleteMany({
        where: {
          id: { in: [ids.membership, ids.siblingMembership, ids.otherMembership] },
        },
      });
      await tx.classroom.deleteMany({ where: { id: { in: [ids.classroom, ids.otherClassroom] } } });
      await tx.user.deleteMany({
        where: {
          id: { in: [ids.teacher, ids.student, ids.sibling, ids.soleParent, ids.sharedParent] },
        },
      });
    });
    fixtureReady = false;
  }, 20_000);
  afterAll(async () => {
    await app?.close();
  });

  it('revokes HTTP access, retains roster attribution and preserves other children/classrooms', async () => {
    for (const actor of [ids.student, ids.soleParent, ids.sharedParent])
      await detail(actor).expect(200);
    const beforeOther = await detail(ids.student, ids.otherClassroom).expect(200);
    const before = await snapshot();
    const response = await remove().expect(204);
    expect(response.text).toBe('');
    await detail(ids.student).expect(404);
    await detail(ids.soleParent).expect(404);
    await detail(ids.sharedParent).expect(200);
    await detail(ids.sibling).expect(200);
    expect((await detail(ids.student, ids.otherClassroom).expect(200)).body).toEqual(
      beforeOther.body,
    );
    await detail(ids.soleParent, ids.otherClassroom).expect(200);

    const listed = await roster().expect(200);
    const removed = listed.body.items.find((row: { userId: string }) => row.userId === ids.student);
    expect(removed).toMatchObject({
      userId: ids.student,
      membershipId: ids.membership,
      state: MembershipState.INACTIVE,
      deletedAt: expect.any(String),
      guardians: expect.arrayContaining([
        expect.objectContaining({ id: ids.soleParent, state: MembershipState.INACTIVE }),
        expect.objectContaining({ id: ids.sharedParent, state: MembershipState.INACTIVE }),
      ]),
    });
    expect(Number.isNaN(Date.parse(removed.deletedAt))).toBe(false);
    const after = await snapshot();
    // No public desk or outbox endpoint exists; these assertions intentionally cross into DB state.
    expect(after.desks.find((row) => row.id === ids.desk)?.membershipId).toBeNull();
    expect(after.desks.find((row) => row.id === ids.otherDesk)).toEqual(
      before.desks.find((row) => row.id === ids.otherDesk),
    );
    expect(after.links).toHaveLength(before.links.length);
    for (const linkId of [ids.siblingLink, ids.otherLink]) {
      expect(after.links.find((row) => row.id === linkId)).toEqual(
        before.links.find((row) => row.id === linkId),
      );
    }
    expect(after.memberships).toHaveLength(before.memberships.length);
    expect(await prisma.user.count({ where: { id: ids.student } })).toBe(1);
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({
      type: eventType,
      payload: { classroomId: ids.classroom, membershipId: ids.membership, userId: ids.student },
    });
  });

  it('records one event and leaves timestamps unchanged on concurrent and repeat DELETE', async () => {
    // Actual PostgreSQL transactions, but no claim of forced lock contention or scheduling order.
    await Promise.all([remove().expect(204), remove().expect(204)]);
    const before = await snapshot();
    expect(before.events).toHaveLength(1);
    expect((await roster().expect(200)).body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ membershipId: ids.membership, state: MembershipState.INACTIVE }),
      ]),
    );
    await remove().expect(204);
    expect(await snapshot()).toEqual(before);
    await detail(ids.student).expect(404);
  });

  it('rolls back membership, links, desk and outbox when event writing fails', async () => {
    const before = await snapshot();
    const beforeRoster = (await roster().expect(200)).body;
    // Insert through the real writer before throwing: absence afterward proves rollback,
    // not merely that an early mock failure never attempted an event insert.
    const writer = app.get(OutboxWriter);
    const originalRecord = writer.record.bind(writer);
    const injection = vi.spyOn(writer, 'record').mockImplementationOnce(async (tx, event) => {
      await originalRecord(tx, event);
      throw new Error('Synthetic post-insert failure');
    });
    try {
      await remove().expect(500);
      expect(injection).toHaveBeenCalledOnce();
      expect(await snapshot()).toEqual(before);
      expect(await events()).toHaveLength(0);
      expect((await roster().expect(200)).body).toEqual(beforeRoster);
      for (const actor of [ids.student, ids.soleParent, ids.sharedParent])
        await detail(actor).expect(200);
      await detail(ids.student, ids.otherClassroom).expect(200);
    } finally {
      injection.mockRestore();
    }
  });
});
