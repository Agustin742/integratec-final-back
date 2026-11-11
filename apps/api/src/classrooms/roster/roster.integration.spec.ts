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
import { ClassroomRosterModule } from './roster.module';

const databaseUrl = loadIsolatedTestDatabaseUrl();

describe('S1/S4 roster PostgreSQL HTTP — API contracts, data and classrooms-and-roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtureReady = false;
  const [teacher, foreignTeacher, child, sibling, literal, decoy, guardian, unrelatedGuardian] =
    Array.from({ length: 8 }, () => randomUUID());
  const users = [
    teacher,
    foreignTeacher,
    child,
    sibling,
    literal,
    decoy,
    guardian,
    unrelatedGuardian,
  ];
  const [classroom, otherClassroom] = [randomUUID(), randomUUID()];
  const memberships = Array.from({ length: 4 }, () => randomUUID());
  const links = Array.from({ length: 3 }, () => randomUUID());
  const removedAt = new Date('2026-11-09T12:00:00.000Z');
  const token = (actor: string) => `Bearer roster-test:${actor}`;
  const get = (query = '', actor = teacher) =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroom}/roster${query}`)
      .set('Authorization', token(actor));
  const snapshot = async () => ({
    memberships: await prisma.classroomMembership.findMany({
      where: { id: { in: memberships } },
      orderBy: { id: 'asc' },
    }),
    links: await prisma.parentLink.findMany({
      where: { id: { in: links } },
      orderBy: { id: 'asc' },
    }),
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }),
        ClassroomRosterModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer roster-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer roster-test:'.length),
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
        data: users.map((id, index) => ({
          id,
          displayName: [
            'Teacher',
            'Foreign teacher',
            'Ada',
            'Ada',
            'Mi%_\\Literal',
            'MiXXLiteral',
            'Pat',
            'Other guardian',
          ][index],
          email: `roster-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-roster-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [classroom, otherClassroom].map((id, index) => ({
          id,
          name: `Roster fixture ${id}`,
          independentTeacherId: index === 0 ? teacher : foreignTeacher,
        })),
      });
      await tx.classroomMembership.createMany({
        data: [child, sibling, literal, decoy].map((userId, index) => ({
          id: memberships[index],
          classroomId: classroom,
          userId,
          state: index === 0 ? MembershipState.INACTIVE : MembershipState.ACTIVE,
          deletedAt: index === 0 ? removedAt : null,
        })),
      });
      await tx.parentLink.createMany({
        data: [
          {
            id: links[0],
            parentId: guardian,
            childId: child,
            classroomId: classroom,
            state: MembershipState.INACTIVE,
          },
          { id: links[1], parentId: unrelatedGuardian, childId: sibling, classroomId: classroom },
          {
            id: links[2],
            parentId: unrelatedGuardian,
            childId: child,
            classroomId: otherClassroom,
          },
        ],
      });
    });
    fixtureReady = true;
  }, 20_000);

  afterAll(async () => {
    try {
      if (fixtureReady)
        await prisma.$transaction(async (tx) => {
          await tx.parentLink.deleteMany({ where: { id: { in: links } } });
          await tx.classroomMembership.deleteMany({ where: { id: { in: memberships } } });
          await tx.classroom.deleteMany({ where: { id: { in: [classroom, otherClassroom] } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
    } finally {
      await app?.close();
    }
  }, 20_000);

  it('S1 data: preserves inactive history and scopes guardian relations to this child and classroom', async () => {
    const res = await get().expect(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 4 });
    expect(res.body.items.map((item: { membershipId: string }) => item.membershipId)).toEqual([
      ...memberships.slice(0, 2).sort(),
      memberships[2],
      memberships[3],
    ]);
    expect(res.body.items.find((item: { userId: string }) => item.userId === child)).toEqual({
      membershipId: memberships[0],
      userId: child,
      displayName: 'Ada',
      state: 'INACTIVE',
      deletedAt: removedAt.toISOString(),
      guardians: [{ id: guardian, displayName: 'Pat', state: 'INACTIVE' }],
    });
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual([
        'deletedAt',
        'displayName',
        'guardians',
        'membershipId',
        'state',
        'userId',
      ]);
      for (const parent of item.guardians)
        expect(Object.keys(parent).sort()).toEqual(['displayName', 'id', 'state']);
    }
    expect(JSON.stringify(res.body)).not.toContain('@example.invalid');
    expect(JSON.stringify(res.body)).not.toContain('synthetic-unused-roster-hash');
  });

  it('S1 API contracts: SQL prefix matching, membership tie-break and offset total agree', async () => {
    const res = await get('?q=aD&page=2&pageSize=1').expect(200);
    expect(res.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(res.body.items.map((item: { membershipId: string }) => item.membershipId)).toEqual([
      memberships.slice(0, 2).sort()[1],
    ]);
    const active = await get('?q=AD&state=ACTIVE').expect(200);
    expect(active.body.total).toBe(1);
    expect(active.body.items[0]).toMatchObject({
      membershipId: memberships[1],
      state: 'ACTIVE',
      deletedAt: null,
    });
    const inactive = await get('?state=INACTIVE').expect(200);
    expect(inactive.body.items.map((item: { userId: string }) => item.userId)).toEqual([child]);
  });

  it('S1 data: PostgreSQL treats percent, underscore and backslash as literal prefix characters', async () => {
    const res = await get(`?q=${encodeURIComponent('mi%_\\')}`).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((item: { userId: string }) => item.userId)).toEqual([literal]);
  });

  it('S4 security: missing authentication and persisted foreign teacher are denied without mutation', async () => {
    const before = await snapshot();
    await request(app.getHttpServer()).get(`/classrooms/${classroom}/roster`).expect(401);
    await get('', foreignTeacher).expect(404);
    expect(await snapshot()).toEqual(before);
  });
});
