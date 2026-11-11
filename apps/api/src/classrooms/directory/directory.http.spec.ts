import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../../auth/auth.module';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { configureHttp } from '../../http/configure-http';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomDirectoryModule } from './directory.module';

const classroomId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const schoolId = '33333333-3333-4333-8333-333333333333';
const studentId = '44444444-4444-4444-8444-444444444444';
const url = `/classrooms/${classroomId}/members`;

const membershipRow = {
  role: ClassroomRole.STUDENT,
  user: {
    id: studentId,
    displayName: 'Ada Lovelace',
    avatarConfig: {
      appearance: {
        bodyId: 'female',
        hairId: 'original',
        topId: 'tshirt',
        hairColor: '#353849',
        clothingColor: '#75B7DA',
      },
    },
  },
};

const prisma = {
  classroom: { findFirst: vi.fn() },
  school: { findFirst: vi.fn() },
  schoolMember: { findFirst: vi.fn() },
  classroomMembership: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  user: { findUnique: vi.fn() },
  parentLink: { findMany: vi.fn() },
};

describe('Classroom Directory HTTP — classrooms-and-roles, security, API contracts (Issue #52)', () => {
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
        ClassroomDirectoryModule,
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
    prisma.classroomMembership.findMany.mockResolvedValue([membershipRow]);
    prisma.user.findUnique.mockResolvedValue(null);
  });

  const get = (suffix = '') =>
    request(app.getHttpServer())
      .get(url + suffix)
      .set('Authorization', 'Bearer synthetic');

  it('security: rejects missing authentication with 401 Unauthorized', async () => {
    await request(app.getHttpServer()).get(url).expect(401);
    expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
  });

  it.each([SchoolRole.OWNER, SchoolRole.ADMIN, SchoolRole.TEACHER])(
    'classrooms-and-roles: allows school %s to read directory',
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
            id: studentId,
            userId: studentId,
            displayName: 'Ada Lovelace',
            role: 'STUDENT',
            avatar: {
              bodyId: 'female',
              hairId: 'original',
              topId: 'tshirt',
              hairColor: '#353849',
              clothingColor: '#75B7DA',
            },
          },
        ],
      });
    },
  );

  it('classrooms-and-roles: allows enrolled STUDENT to read directory', async () => {
    prisma.schoolMember.findFirst.mockResolvedValue(null);
    prisma.classroomMembership.findFirst.mockResolvedValue({ role: ClassroomRole.STUDENT });
    const res = await get().expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].displayName).toBe('Ada Lovelace');
  });

  it('classrooms-and-roles: allows independent teacher without school membership', async () => {
    prisma.classroom.findFirst.mockResolvedValue({
      id: classroomId,
      schoolId: null,
      independentTeacherId: actorId,
      name: 'Independent classroom',
      adultMode: false,
    });
    prisma.classroomMembership.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: actorId,
      displayName: 'Teacher User',
      avatarConfig: null,
    });

    const res = await get().expect(200);
    expect(prisma.schoolMember.findFirst).not.toHaveBeenCalled();
    expect(res.body.items).toHaveLength(2); // student + independent teacher
  });

  it('classrooms-and-roles: denies linked PARENT with 403 Forbidden', async () => {
    prisma.schoolMember.findFirst.mockResolvedValue(null);
    prisma.classroomMembership.findFirst.mockResolvedValue(null);
    prisma.parentLink.findMany.mockResolvedValue([{ childId: studentId }]);

    const res = await get().expect(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
    expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
  });

  it.each(['foreign teacher', 'cross-school actor', 'removed member', 'stranger'])(
    'isolation: %s receives 404 NotFound without reading directory',
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
                deletedAt: new Date(),
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
      expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'invalid id'])('isolation: %s classroom returns 404', async (kind) => {
    prisma.classroom.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(kind === 'missing' ? url : '/classrooms/invalid/members')
      .set('Authorization', 'Bearer synthetic')
      .expect(404);
  });

  it('privacy: response never leaks emails, passwordHash, parent links, or grades', async () => {
    const res = await get().expect(200);
    const bodyStr = JSON.stringify(res.body);

    expect(bodyStr).not.toContain('email');
    expect(bodyStr).not.toContain('password');
    expect(bodyStr).not.toContain('guardians');
    expect(bodyStr).not.toContain('parent');
    expect(bodyStr).not.toContain('grade');

    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['avatar', 'displayName', 'id', 'role', 'userId'].sort(),
      );
    }
  });

  it.each([
    'page=0',
    'page=10001',
    'page=abc',
    'pageSize=101',
    'pageSize=0',
    'q=a&q=b',
    `q=${'x'.repeat(101)}`,
    'secret=x',
  ])('API validation: rejects ?%s before reading database', async (query) => {
    const res = await get(`?${query}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
  });
});
