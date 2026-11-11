import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../../auth/auth.module';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { configureHttp } from '../../http/configure-http';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomRosterModule } from './roster.module';

const classroomId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const schoolId = '33333333-3333-4333-8333-333333333333';
const childId = '44444444-4444-4444-8444-444444444444';
const url = `/classrooms/${classroomId}/roster`;
const row = {
  id: 'membership-1',
  userId: childId,
  state: MembershipState.INACTIVE,
  deletedAt: new Date('2026-11-09T12:00:00.000Z'),
  user: {
    displayName: 'Ada',
    childInLinks: [
      { state: MembershipState.INACTIVE, parent: { id: 'guardian-1', displayName: 'Pat' } },
    ],
  },
};

// All persistence is replaced: no Prisma client or database connection is created.
const prisma = {
  classroom: { findFirst: vi.fn() },
  school: { findFirst: vi.fn() },
  schoolMember: { findFirst: vi.fn() },
  classroomMembership: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
  },
  parentLink: { findMany: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
};

describe('S1/S4 classroom roster HTTP — classrooms-and-roles, security, API contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(
          authTestConfig({
            databaseUrl: 'postgresql://synthetic:synthetic@localhost:1/unused',
          }),
        ),
        PrismaModule,
        AuthModule,
        ClassroomRosterModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (header !== 'Bearer synthetic') throw new UnauthorizedException();
          return { userId: actorId, sessionId: 'synthetic-session' };
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
    prisma.classroom.findFirst.mockResolvedValue({
      id: classroomId,
      schoolId,
      independentTeacherId: null,
      name: 'Synthetic classroom',
      adultMode: false,
    });
    prisma.school.findFirst.mockResolvedValue({ id: schoolId });
    prisma.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.TEACHER });
    prisma.classroomMembership.findFirst.mockResolvedValue({ role: ClassroomRole.TEACHER });
    prisma.parentLink.findMany.mockResolvedValue([]);
    prisma.classroomMembership.findMany.mockResolvedValue([row]);
    prisma.classroomMembership.count.mockResolvedValue(1);
  });
  const get = (suffix = '') =>
    request(app.getHttpServer())
      .get(url + suffix)
      .set('Authorization', 'Bearer synthetic');

  it('security: rejects missing authentication before reading roster', async () => {
    await request(app.getHttpServer()).get(url).expect(401);
    expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
  });
  it.each([SchoolRole.OWNER, SchoolRole.ADMIN, SchoolRole.TEACHER])(
    'classrooms-and-roles: allows school %s; returns safe historical students and links',
    async (role) => {
      prisma.schoolMember.findFirst.mockResolvedValue({ role });
      if (role !== SchoolRole.TEACHER) prisma.classroomMembership.findFirst.mockResolvedValue(null);
      const res = await get().expect(200);
      expect(res.body).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [
          {
            membershipId: row.id,
            userId: childId,
            displayName: 'Ada',
            state: 'INACTIVE',
            deletedAt: '2026-11-09T12:00:00.000Z',
            guardians: [{ id: 'guardian-1', displayName: 'Pat', state: 'INACTIVE' }],
          },
        ],
      });
    },
  );
  it('classrooms-and-roles: allows the independent owner without school membership', async () => {
    prisma.classroom.findFirst.mockResolvedValue({
      id: classroomId,
      schoolId: null,
      independentTeacherId: actorId,
      adultMode: false,
    });
    prisma.classroomMembership.findFirst.mockResolvedValue(null);
    await get().expect(200);
    expect(prisma.schoolMember.findFirst).not.toHaveBeenCalled();
  });
  afterEach(() => {
    expect(prisma.classroomMembership.update).not.toHaveBeenCalled();
    expect(prisma.classroomMembership.delete).not.toHaveBeenCalled();
    expect(prisma.classroomMembership.create).not.toHaveBeenCalled();
    expect(prisma.parentLink.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['foreign teacher', 'cross-school actor', 'removed member', 'stranger'])(
    'S4 isolation: %s receives 404 without roster reads',
    async (kind) => {
      const elsewhere = '55555555-5555-4555-8555-555555555555';
      const schoolMembership =
        kind === 'foreign teacher'
          ? { schoolId, role: SchoolRole.TEACHER }
          : kind === 'cross-school actor'
            ? { schoolId: elsewhere, role: SchoolRole.OWNER }
            : null;
      const membership =
        kind === 'foreign teacher'
          ? {
              classroomId: elsewhere,
              state: MembershipState.ACTIVE,
              deletedAt: null,
              role: ClassroomRole.TEACHER,
            }
          : kind === 'removed member'
            ? {
                classroomId,
                state: MembershipState.INACTIVE,
                deletedAt: row.deletedAt,
                role: ClassroomRole.STUDENT,
              }
            : null;
      prisma.schoolMember.findFirst.mockImplementation(async ({ where }) =>
        schoolMembership?.schoolId === where.schoolId ? schoolMembership : null,
      );
      prisma.classroomMembership.findFirst.mockImplementation(async ({ where }) =>
        membership?.classroomId === where.classroomId &&
        membership?.state === where.state &&
        membership?.deletedAt === where.deletedAt
          ? membership
          : null,
      );
      await get().expect(404);
      expect(prisma.classroomMembership.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classroomId, userId: actorId, state: MembershipState.ACTIVE, deletedAt: null },
        }),
      );
      expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
      expect(prisma.classroomMembership.count).not.toHaveBeenCalled();
    },
  );
  it.each(['student', 'linked parent'])(
    'classrooms-and-roles: denies %s with 403',
    async (actor) => {
      prisma.schoolMember.findFirst.mockResolvedValue(null);
      prisma.classroomMembership.findFirst.mockResolvedValue(
        actor === 'student' ? { role: ClassroomRole.STUDENT } : null,
      );
      prisma.parentLink.findMany.mockResolvedValue(actor === 'linked parent' ? [{ childId }] : []);
      await get().expect(403);
      expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
      expect(prisma.classroomMembership.count).not.toHaveBeenCalled();
    },
  );
  it.each(['missing', 'invalid id'])('isolation: %s classroom returns 404', async (kind) => {
    prisma.classroom.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(kind === 'missing' ? url : '/classrooms/invalid/roster')
      .set('Authorization', 'Bearer synthetic')
      .expect(404);
  });
  it('S1 data: scopes students, keeps both states, and selects only safe classroom-child links', async () => {
    await get().expect(200);
    expect(prisma.classroomMembership.findMany).toHaveBeenCalledWith({
      where: { classroomId, role: 'STUDENT' },
      skip: 0,
      take: 20,
      orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
      select: {
        id: true,
        userId: true,
        state: true,
        deletedAt: true,
        user: {
          select: {
            displayName: true,
            childInLinks: {
              where: { classroomId },
              orderBy: { id: 'asc' },
              select: { state: true, parent: { select: { id: true, displayName: true } } },
            },
          },
        },
      },
    });
    expect(prisma.classroomMembership.count).toHaveBeenCalledWith({
      where: { classroomId, role: 'STUDENT' },
    });
  });
  it('S1 data: serializes active students without guardians or removal timestamp', async () => {
    prisma.classroomMembership.findMany.mockResolvedValue([
      {
        ...row,
        state: MembershipState.ACTIVE,
        deletedAt: null,
        user: { displayName: 'Ada', childInLinks: [] },
      },
    ]);
    const res = await get('?state=ACTIVE').expect(200);
    expect(res.body.items[0]).toEqual({
      membershipId: row.id,
      userId: childId,
      displayName: 'Ada',
      state: 'ACTIVE',
      deletedAt: null,
      guardians: [],
    });
  });
  it('S1 pagination: shared helpers preserve page metadata and filtered total with prefix search', async () => {
    prisma.classroomMembership.findMany.mockResolvedValue([]);
    prisma.classroomMembership.count.mockResolvedValue(3);
    const res = await get('?page=2&pageSize=2&state=ACTIVE&q=aD').expect(200);
    expect(res.body).toEqual({ items: [], page: 2, pageSize: 2, total: 3 });
    const where = {
      classroomId,
      role: 'STUDENT',
      state: 'ACTIVE',
      user: { displayName: { startsWith: 'aD', mode: 'insensitive' } },
    };
    expect(prisma.classroomMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 2, take: 2 }),
    );
    expect(prisma.classroomMembership.count).toHaveBeenCalledWith({ where });
  });
  it('S1 filters: treats LIKE wildcard characters as literal prefix text', async () => {
    await get('?q=%25_').expect(200);
    expect(prisma.classroomMembership.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { displayName: { startsWith: '\\%\\_', mode: 'insensitive' } },
        }),
      }),
    );
  });
  it.each([
    'page=0',
    'page=10001',
    'page=abc',
    'pageSize=101',
    'pageSize=0',
    'state=removed',
    'state=ACTIVE&state=INACTIVE',
    'q=a&q=b',
    `q=${'x'.repeat(101)}`,
    'sort=displayName',
    'secret=x',
  ])('API validation: rejects ?%s before persistence', async (query) => {
    const res = await get(`?${query}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
  });
});
