import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessModule } from '../access/access.module';
import { computeClassroomCapabilities } from '../access/access-verification.service';
import { AuthModule } from '../auth/auth.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';
import { ClassroomInvitationsService } from './classroom-invitations.service';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorId = id(1);
const classroomId = id(2);
const schoolId = id(3);
const foreignId = id(4);
const staffPanels = [
  'activities',
  'material',
  'grades',
  'chat',
  'notices',
  'bot',
  'members',
  'settings',
];
const studentPanels = [
  'activities',
  'material',
  'grades',
  'chat',
  'notices',
  'shop',
  'bot',
  'members',
];
const prisma = {
  classroom: { findFirst: vi.fn() },
  school: { findFirst: vi.fn() },
  schoolMember: { findFirst: vi.fn() },
  classroomMembership: { findFirst: vi.fn() },
  parentLink: { findMany: vi.fn() },
};
const classroom = () => ({
  id: classroomId,
  schoolId: schoolId as string | null,
  independentTeacherId: null as string | null,
  name: 'Synthetic classroom',
  subject: null,
  adultMode: false,
  chatMuted: false,
  collaborationLocked: false,
  gamesDisabled: false,
  deletedAt: null,
  pet: null,
  _count: { desks: 12 },
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
});

// Predicate-aware stubs preserve classroom/school/actor boundaries; no Prisma client is created.
function matches(row: object, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value);
}

describe('classroom context HTTP — panel availability is not authorization', () => {
  let app: INestApplication;
  let row: ReturnType<typeof classroom>;
  let schoolMembers: object[];
  let members: object[];
  let links: object[];
  const get = (resourceId = classroomId) =>
    request(app.getHttpServer())
      .get(`/classrooms/${resourceId}`)
      .set('Authorization', 'Bearer synthetic');

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(
          authTestConfig({ databaseUrl: 'postgresql://synthetic:synthetic@localhost:1/unused' }),
        ),
        PrismaModule,
        AuthModule,
        AccessModule,
      ],
      controllers: [ClassroomsController],
      providers: [ClassroomsService, { provide: ClassroomInvitationsService, useValue: {} }],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (header !== 'Bearer synthetic') throw new UnauthorizedException();
          return { userId: actorId, sessionId: id(5) };
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
    row = classroom();
    schoolMembers = [];
    members = [];
    links = [];
    prisma.classroom.findFirst.mockImplementation(async ({ where }) =>
      matches(row, where) ? structuredClone(row) : null,
    );
    prisma.school.findFirst.mockImplementation(async ({ where }) =>
      where.id === schoolId ? { id: schoolId } : null,
    );
    prisma.schoolMember.findFirst.mockImplementation(
      async ({ where }) => schoolMembers.find((member) => matches(member, where)) ?? null,
    );
    prisma.classroomMembership.findFirst.mockImplementation(
      async ({ where }) => members.find((member) => matches(member, where)) ?? null,
    );
    prisma.parentLink.findMany.mockImplementation(async ({ where }) =>
      links.filter((link) => matches(link, where)),
    );
  });
  function enroll(role: ClassroomRole = ClassroomRole.STUDENT) {
    members = [
      { classroomId, userId: actorId, role, state: MembershipState.ACTIVE, deletedAt: null },
    ];
  }
  function linkChild() {
    links = [{ classroomId, parentId: actorId, childId: id(6), state: MembershipState.ACTIVE }];
  }

  it.each([
    { role: 'OWNER' as const, panels: staffPanels },
    { role: 'ADMIN' as const, panels: staffPanels },
    { role: 'TEACHER' as const, panels: staffPanels },
    { role: 'STUDENT' as const, panels: studentPanels },
    { role: 'PARENT' as const, panels: ['grades'] },
  ])('projects exact panels and prior authorization for $role', async ({ role, panels }) => {
    if (role === 'PARENT') linkChild();
    else if (role === 'STUDENT') enroll();
    else {
      schoolMembers = [{ schoolId, userId: actorId, role, state: MembershipState.ACTIVE }];
      if (role === 'TEACHER') enroll(ClassroomRole.TEACHER);
    }
    const before = structuredClone({ row, schoolMembers, members, links });
    const response = await get().expect(200);
    expect(response.body.availablePanels).toEqual(panels);
    expect(response.body.myRole).toBe(role);
    expect(response.body.capabilities).toEqual(computeClassroomCapabilities(role));
    expect(response.body).not.toHaveProperty('linkedChildIds');
    expect(response.body.availablePanels).not.toContain('pet');
    expect({ row, schoolMembers, members, links }).toEqual(before);
    expect(prisma.classroom.findFirst).toHaveBeenCalledTimes(2);
  });

  it('allows an independent teacher only in their own classroom', async () => {
    row.schoolId = null;
    row.independentTeacherId = actorId;
    expect((await get().expect(200)).body.availablePanels).toEqual(staffPanels);
    await get(foreignId).expect(404);
  });

  it('ignores client role/panel hints and preserves resource isolation', async () => {
    enroll();
    await assertResourceAuthorization({
      request: (resourceId, interaction) => get(resourceId).query(interaction ?? {}),
      allowedResourceId: classroomId,
      foreignResourceId: foreignId,
      interaction: { myRole: 'OWNER', availablePanels: 'settings' },
      deniedStatus: 404,
      assertAllowed: ({ body }) =>
        expect(body).toMatchObject({ myRole: 'STUDENT', availablePanels: studentPanels }),
      assertDenied: ({ body }) => expect(body).not.toHaveProperty('availablePanels'),
    });
  });

  it.each(['stranger', 'foreign owner', 'removed student', 'unlinked parent', 'adult parent'])(
    'returns opaque 404 for %s without projecting panels',
    async (kind) => {
      if (kind === 'foreign owner') {
        schoolMembers = [
          {
            schoolId: id(9),
            userId: actorId,
            role: SchoolRole.OWNER,
            state: MembershipState.ACTIVE,
          },
        ];
      }
      if (kind === 'removed student') {
        enroll();
        members = [{ ...members[0], state: MembershipState.INACTIVE }];
      }
      if (kind === 'unlinked parent') {
        links = [
          {
            classroomId: foreignId,
            parentId: actorId,
            childId: id(6),
            state: MembershipState.ACTIVE,
          },
        ];
      }
      if (kind === 'adult parent') {
        linkChild();
        row.adultMode = true;
      }
      const response = await get().expect(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body).not.toHaveProperty('availablePanels');
      expect(prisma.classroom.findFirst).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves authentication and malformed/missing classroom statuses', async () => {
    await request(app.getHttpServer()).get(`/classrooms/${classroomId}`).expect(401);
    await request(app.getHttpServer())
      .get(`/classrooms/${classroomId}`)
      .set('Authorization', 'Bearer invalid')
      .expect(401);
    enroll();
    await get('invalid').expect(404);
    await get(foreignId).expect(404);
  });

  it('does not turn a parent panel into staff operation authority', async () => {
    linkChild();
    const response = await request(app.getHttpServer())
      .patch(`/classrooms/${classroomId}`)
      .set('Authorization', 'Bearer synthetic')
      .send({ name: 'Not allowed' })
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
