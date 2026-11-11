import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { MembershipState, RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../../config/testing/isolated-test-database';
import { configureHttp } from '../../http/configure-http';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomDirectoryModule } from './directory.module';

const databaseUrl = loadIsolatedTestDatabaseUrl();

describe('Classroom Directory PostgreSQL HTTP Integration — API contracts, privacy & DoD (Issue #52)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtureReady = false;

  const [
    teacher,
    foreignTeacher,
    activeStudent1,
    activeStudent2,
    literalStudent,
    removedStudent,
    parentUser,
    strangerUser,
  ] = Array.from({ length: 8 }, () => randomUUID());

  const users = [
    teacher,
    foreignTeacher,
    activeStudent1,
    activeStudent2,
    literalStudent,
    removedStudent,
    parentUser,
    strangerUser,
  ];

  const [classroom, otherClassroom] = [randomUUID(), randomUUID()];
  const memberships = Array.from({ length: 4 }, () => randomUUID());
  const parentLinkId = randomUUID();
  const removedAt = new Date('2026-11-09T12:00:00.000Z');

  const token = (actor: string) => `Bearer directory-test:${actor}`;
  const get = (query = '', actor = activeStudent1) =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroom}/members${query}`)
      .set('Authorization', token(actor));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }),
        ClassroomDirectoryModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer directory-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer directory-test:'.length),
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

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          {
            id: teacher,
            displayName: 'Teacher Xavier',
            email: `teacher-${teacher}@example.invalid`,
            passwordHash: 'secret-hash-teacher',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: foreignTeacher,
            displayName: 'Foreign Teacher',
            email: `foreign-${foreignTeacher}@example.invalid`,
            passwordHash: 'secret-hash-foreign',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: activeStudent1,
            displayName: 'Alice Walker',
            email: `alice-${activeStudent1}@example.invalid`,
            passwordHash: 'secret-hash-alice',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: activeStudent2,
            displayName: 'Bob Dylan',
            email: `bob-${activeStudent2}@example.invalid`,
            passwordHash: 'secret-hash-bob',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: literalStudent,
            displayName: 'Mi%_\\Literal',
            email: `literal-${literalStudent}@example.invalid`,
            passwordHash: 'secret-hash-literal',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: removedStudent,
            displayName: 'Removed Dave',
            email: `removed-${removedStudent}@example.invalid`,
            passwordHash: 'secret-hash-removed',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: parentUser,
            displayName: 'Parent Guardian',
            email: `parent-${parentUser}@example.invalid`,
            passwordHash: 'secret-hash-parent',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: strangerUser,
            displayName: 'Stranger User',
            email: `stranger-${strangerUser}@example.invalid`,
            passwordHash: 'secret-hash-stranger',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
        ],
      });

      await tx.avatarConfiguration.create({
        data: {
          userId: activeStudent1,
          appearance: {
            bodyId: 'female',
            hairId: 'original',
            topId: 'tshirt',
            hairColor: '#353849',
            clothingColor: '#75B7DA',
          },
        },
      });

      await tx.classroom.createMany({
        data: [
          {
            id: classroom,
            name: 'Directory Test Classroom',
            independentTeacherId: teacher,
          },
          {
            id: otherClassroom,
            name: 'Foreign Classroom',
            independentTeacherId: foreignTeacher,
          },
        ],
      });

      await tx.classroomMembership.createMany({
        data: [
          {
            id: memberships[0],
            classroomId: classroom,
            userId: activeStudent1,
            state: MembershipState.ACTIVE,
            deletedAt: null,
          },
          {
            id: memberships[1],
            classroomId: classroom,
            userId: activeStudent2,
            state: MembershipState.ACTIVE,
            deletedAt: null,
          },
          {
            id: memberships[2],
            classroomId: classroom,
            userId: literalStudent,
            state: MembershipState.ACTIVE,
            deletedAt: null,
          },
          {
            id: memberships[3],
            classroomId: classroom,
            userId: removedStudent,
            state: MembershipState.INACTIVE,
            deletedAt: removedAt,
          },
        ],
      });

      await tx.parentLink.create({
        data: {
          id: parentLinkId,
          parentId: parentUser,
          childId: activeStudent1,
          classroomId: classroom,
          state: MembershipState.ACTIVE,
        },
      });
    });

    fixtureReady = true;
  }, 20_000);

  afterAll(async () => {
    try {
      if (fixtureReady) {
        await prisma.$transaction(async (tx) => {
          await tx.parentLink.deleteMany({ where: { id: parentLinkId } });
          await tx.classroomMembership.deleteMany({ where: { id: { in: memberships } } });
          await tx.avatarConfiguration.deleteMany({ where: { userId: activeStudent1 } });
          await tx.classroom.deleteMany({ where: { id: { in: [classroom, otherClassroom] } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      }
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('allows enrolled student to list members and includes independent teacher and active students', async () => {
    const res = await get().expect(200);

    // 1 independent teacher + 3 active students = 4 active members (removed student excluded)
    expect(res.body.total).toBe(4);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.items).toHaveLength(4);

    const userIds = res.body.items.map((i: { userId: string }) => i.userId);
    expect(userIds).toContain(teacher);
    expect(userIds).toContain(activeStudent1);
    expect(userIds).toContain(activeStudent2);
    expect(userIds).toContain(literalStudent);
    expect(userIds).not.toContain(removedStudent);
    expect(userIds).not.toContain(parentUser);
  });

  it('preserves strict privacy: never leaks emails, passwordHash, parent links, or grades', async () => {
    const res = await get().expect(200);
    const bodyStr = JSON.stringify(res.body);

    expect(bodyStr).not.toContain('@example.invalid');
    expect(bodyStr).not.toContain('secret-hash');
    expect(bodyStr).not.toContain('parentLinkId');
    expect(bodyStr).not.toContain('Parent Guardian');

    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['avatar', 'displayName', 'id', 'role', 'userId'].sort(),
      );
    }
  });

  it('orders members by displayName asc, then id asc', async () => {
    const res = await get().expect(200);
    const displayNames = res.body.items.map((i: { displayName: string }) => i.displayName);

    expect(displayNames).toEqual(['Alice Walker', 'Bob Dylan', 'Mi%_\\Literal', 'Teacher Xavier']);
  });

  it('supports pagination with correct page, pageSize, and total', async () => {
    const page1 = await get('?page=1&pageSize=2').expect(200);
    expect(page1.body.total).toBe(4);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.items[0].displayName).toBe('Alice Walker');
    expect(page1.body.items[1].displayName).toBe('Bob Dylan');

    const page2 = await get('?page=2&pageSize=2').expect(200);
    expect(page2.body.total).toBe(4);
    expect(page2.body.page).toBe(2);
    expect(page2.body.pageSize).toBe(2);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.items[0].displayName).toBe('Mi%_\\Literal');
    expect(page2.body.items[1].displayName).toBe('Teacher Xavier');
  });

  it('filters by case-insensitive display name prefix q', async () => {
    const res = await get('?q=al').expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].displayName).toBe('Alice Walker');
    expect(res.body.items[0].avatar).toEqual({
      bodyId: 'female',
      hairId: 'original',
      topId: 'tshirt',
      hairColor: '#353849',
      clothingColor: '#75B7DA',
    });
  });

  it('treats %, _, and \\ as literal characters in prefix search', async () => {
    const res = await get(`?q=${encodeURIComponent('mi%_\\')}`).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].displayName).toBe('Mi%_\\Literal');
  });

  it('MANDATORY CONCURRENCY: handles concurrent directory reads with Promise.all cleanly', async () => {
    const requests = [
      get('?page=1&pageSize=2', activeStudent1),
      get('?page=1&pageSize=2', activeStudent2),
      get('?page=1&pageSize=2', teacher),
      get('?q=Alice', activeStudent1),
    ];

    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
    }

    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[0].body).toEqual(responses[2].body);
    expect(responses[3].body.total).toBe(1);
    expect(responses[3].body.items[0].displayName).toBe('Alice Walker');
  });

  it('rejection policy: linked parent receives 403 Forbidden', async () => {
    const res = await get('', parentUser).expect(403);
    expect(res.body.message).toBe(
      'Classroom member directory is only accessible to classroom members',
    );
  });

  it('rejection policy: stranger, foreign teacher, removed student receive 404 NotFound', async () => {
    await get('', strangerUser).expect(404);
    await get('', foreignTeacher).expect(404);
    await get('', removedStudent).expect(404);
  });
});
