import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../../auth/auth.module';
import { SessionVerifier } from '../../auth/session-verifier.service';
import type { ApiConfig } from '../../config/api-config';
import { ApiConfigModule } from '../../config/config.module';
import { configureHttp } from '../../http/configure-http';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { assertResourceAuthorization } from '../../testing/resource-authorization';
import { ClassroomDesksModule } from './desks.module';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1);
const childId = id(2);
const classroomId = id(3);
const foreignId = id(4);
const schoolId = id(5);
const foreignSchoolId = id(6);
const url = (resourceId = classroomId) => `/classrooms/${resourceId}/desks`;
// No environment loader, Prisma constructor, external service or live session is used.
const config: ApiConfig = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://synthetic:synthetic@localhost:1/unused',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604800,
  refreshReuseGraceSeconds: 30,
  passwordResetTtlSeconds: 3600,
  passwordResetUrlBase: 'https://example.test/reset',
  invitationTtlSeconds: 3600,
  outboxPollIntervalSeconds: 5,
  outboxMaxAttempts: 5,
  internalServiceSecret: 'synthetic-internal-secret-for-tests-0000',
  jwtSecret: 'synthetic-jwt-secret-for-tests-only-0000',
  invitationTokenKey: Buffer.alloc(32, 1),
  allowedOrigins: ['http://localhost'],
  s3Bucket: 'synthetic',
  s3Region: 'sa-east-1',
  s3Endpoint: undefined,
  s3ForcePathStyle: false,
  s3Credentials: undefined,
  storageSignedUrlTtlSeconds: 300,
  authDataRetentionSeconds: 2592000,
  authCleanupIntervalSeconds: 86400,
  authCleanupBatchSize: 1000,
};

type Classroom = {
  id: string;
  schoolId: string | null;
  independentTeacherId: string | null;
  name: string;
  adultMode: boolean;
  deletedAt: Date | null;
};
type Member = {
  classroomId: string;
  userId: string;
  role: ClassroomRole;
  state: MembershipState;
  deletedAt: Date | null;
};
let classrooms: Classroom[];
let members: Member[];
let schoolMembers: { schoolId: string; userId: string; role: SchoolRole; state: MembershipState }[];
let links: { classroomId: string; parentId: string; childId: string; state: MembershipState }[];
let desks: {
  id: string;
  classroomId: string;
  deskIndex: number;
  membershipId: string | null;
  membership: { userId: string } | null;
}[];
const prisma = {
  classroom: { findFirst: vi.fn() },
  school: { findFirst: vi.fn() },
  schoolMember: { findFirst: vi.fn() },
  classroomMembership: { findFirst: vi.fn() },
  parentLink: { findMany: vi.fn() },
  desk: { findMany: vi.fn() },
};

// Exact predicates matter: a role in a different classroom/school must not match.
function matches(row: object, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value);
}
function snapshot() {
  return structuredClone({ classrooms, members, schoolMembers, links, desks });
}

describe('desk map HTTP — S1/S2/S4 classroom resource authorization', () => {
  let app: INestApplication;
  let initialState: ReturnType<typeof snapshot>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), PrismaModule, AuthModule, ClassroomDesksModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (header !== 'Bearer synthetic') throw new UnauthorizedException();
          return { userId: actorId, sessionId: id(7) };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    classrooms = [classroomId, foreignId].map((resourceId) => ({
      id: resourceId,
      schoolId: resourceId === classroomId ? schoolId : foreignSchoolId,
      independentTeacherId: null,
      name: 'Synthetic classroom',
      adultMode: false,
      deletedAt: null,
    }));
    members = [
      {
        classroomId,
        userId: actorId,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
      },
    ];
    schoolMembers = [];
    links = [];
    // Unsorted physical layout: index 2 was released; index 13 is an expanded desk.
    desks = [13, 2, 1].map((deskIndex) => ({
      id: id(100 + deskIndex),
      classroomId,
      deskIndex,
      membershipId: deskIndex === 2 ? null : id(200 + deskIndex),
      membership: deskIndex === 2 ? null : { userId: deskIndex === 1 ? actorId : childId },
    }));
    prisma.classroom.findFirst.mockImplementation(
      async ({ where }) => classrooms.find((row) => matches(row, where)) ?? null,
    );
    prisma.school.findFirst.mockImplementation(async ({ where }) =>
      [schoolId, foreignSchoolId].includes(where.id) ? { id: where.id } : null,
    );
    prisma.schoolMember.findFirst.mockImplementation(
      async ({ where }) => schoolMembers.find((row) => matches(row, where)) ?? null,
    );
    prisma.classroomMembership.findFirst.mockImplementation(
      async ({ where }) => members.find((row) => matches(row, where)) ?? null,
    );
    prisma.parentLink.findMany.mockImplementation(async ({ where }) =>
      links.filter((row) => matches(row, where)),
    );
    prisma.desk.findMany.mockImplementation(async ({ where, orderBy }) => {
      const rows = desks.filter((row) => matches(row, where));
      if (orderBy?.[0]?.deskIndex === 'asc') rows.sort((a, b) => a.deskIndex - b.deskIndex);
      return structuredClone(rows);
    });
    initialState = snapshot();
  });
  afterEach(() => {
    // Only the controlled fixture's state is asserted, not a real database invariant.
    expect(snapshot()).toEqual(initialState);
  });
  const get = (resourceId = classroomId) =>
    request(app.getHttpServer()).get(url(resourceId)).set('Authorization', 'Bearer synthetic');
  const sealFixture = () => {
    initialState = snapshot();
  };

  it('returns enrolled student assignments, released and expanded desks in ascending order', async () => {
    const response = await get().expect(200);
    expect(response.body).toEqual({
      items: [1, 2, 13].map((deskIndex) => ({
        id: id(100 + deskIndex),
        deskIndex,
        membershipId: deskIndex === 2 ? null : id(200 + deskIndex),
        userId: deskIndex === 2 ? null : deskIndex === 1 ? actorId : childId,
      })),
    });
    expect(prisma.desk.findMany).toHaveBeenCalledWith({
      where: { classroomId },
      orderBy: [{ deskIndex: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        deskIndex: true,
        membershipId: true,
        membership: { select: { userId: true } },
      },
    });
  });
  it('returns every physical desk without an arbitrary page limit', async () => {
    desks = Array.from({ length: 105 }, (_, index) => ({
      id: id(1000 + index),
      classroomId,
      deskIndex: index + 1,
      membershipId: null,
      membership: null,
    }));
    sealFixture();
    const response = await get().expect(200);
    expect(response.body.items).toHaveLength(105);
    expect(response.body.items[104].deskIndex).toBe(105);
  });
  it('returns an empty layout without creating or repairing desks', async () => {
    desks = [];
    sealFixture();
    expect((await get().expect(200)).body).toEqual({ items: [] });
  });
  it.each([SchoolRole.OWNER, SchoolRole.ADMIN, SchoolRole.TEACHER])(
    'allows school %s with the persisted classroom scope',
    async (role) => {
      schoolMembers = [{ schoolId, userId: actorId, role, state: MembershipState.ACTIVE }];
      members = role === SchoolRole.TEACHER ? [{ ...members[0], role: ClassroomRole.TEACHER }] : [];
      sealFixture();
      await get().expect(200);
    },
  );
  it('allows an independent teacher only in their own classroom', async () => {
    classrooms[0].schoolId = null;
    classrooms[0].independentTeacherId = actorId;
    members = [];
    sealFixture();
    await get().expect(200);
    await get(foreignId).expect(404);
  });
  it.each(['foreign teacher', 'foreign student', 'nonmember', 'removed member', 'foreign owner'])(
    'denies %s without reading desks',
    async (kind) => {
      members =
        kind === 'nonmember' || kind === 'foreign owner'
          ? []
          : [
              {
                classroomId: kind === 'removed member' ? classroomId : foreignId,
                userId: actorId,
                role: kind === 'foreign teacher' ? ClassroomRole.TEACHER : ClassroomRole.STUDENT,
                state:
                  kind === 'removed member' ? MembershipState.INACTIVE : MembershipState.ACTIVE,
                deletedAt: kind === 'removed member' ? new Date('2026-11-11T00:00:00Z') : null,
              },
            ];
      schoolMembers =
        kind === 'foreign owner'
          ? [
              {
                schoolId: foreignSchoolId,
                userId: actorId,
                role: SchoolRole.OWNER,
                state: MembershipState.ACTIVE,
              },
            ]
          : kind === 'foreign teacher'
            ? [
                {
                  schoolId,
                  userId: actorId,
                  role: SchoolRole.TEACHER,
                  state: MembershipState.ACTIVE,
                },
              ]
            : [];
      sealFixture();
      expect((await get().expect(404)).body.error.code).toBe('NOT_FOUND');
      expect(prisma.desk.findMany).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'S3/S5 resource boundary for students when adultMode=%s',
    async (adultMode) => {
      classrooms[0].adultMode = adultMode;
      classrooms[1].adultMode = adultMode;
      sealFixture();
      await assertResourceAuthorization({
        allowedResourceId: classroomId,
        foreignResourceId: foreignId,
        interaction: { classroomId, objectId: desks[0].id },
        deniedStatus: 404,
        request: (resourceId, interaction) => {
          const req = get(resourceId);
          return interaction === undefined ? req : req.query(interaction);
        },
        assertAllowed: (response) => {
          expect(response.body).toMatchObject({ items: expect.any(Array) });
        },
        assertDenied: (response) => {
          expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
          expect(response.body).not.toHaveProperty('items');
        },
      });
      // The successful layout was read twice; denied requests never fetched it.
      expect(prisma.desk.findMany).toHaveBeenCalledTimes(2);
      expect(
        prisma.desk.findMany.mock.calls.every(([query]) => query.where.classroomId === classroomId),
      ).toBe(true);
    },
  );
  it.each([false, true])('excludes parent-only access when adultMode=%s', async (adultMode) => {
    members = [];
    classrooms[0].adultMode = adultMode;
    links = [{ classroomId, parentId: actorId, childId, state: MembershipState.ACTIVE }];
    sealFixture();
    const response = await get().expect(adultMode ? 404 : 403);
    expect(response.body.error.code).toBe(adultMode ? 'NOT_FOUND' : 'FORBIDDEN');
    expect(prisma.desk.findMany).not.toHaveBeenCalled();
  });
  it.each(['not-a-uuid', id(999)])('hides invalid or missing resource %s', async (resourceId) => {
    await get(resourceId).expect(404);
    expect(prisma.desk.findMany).not.toHaveBeenCalled();
  });
  it.each([undefined, 'Bearer invalid'])(
    'rejects missing or invalid credentials %s',
    async (header) => {
      const req = request(app.getHttpServer()).get(url());
      if (header) req.set('Authorization', header);
      expect((await req.expect(401)).body.error.code).toBe('UNAUTHENTICATED');
      expect(prisma.classroom.findFirst).not.toHaveBeenCalled();
      expect(prisma.desk.findMany).not.toHaveBeenCalled();
    },
  );
});
