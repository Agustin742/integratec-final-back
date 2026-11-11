import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../../access/access-verification.service';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { SessionVerifier } from '../../auth/session-verifier.service';
import { configureHttp } from '../../http/configure-http';
import { OutboxDispatcher } from '../../platform/outbox/outbox.dispatcher';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomRemovalModule } from './classroom-removal.module';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const classroomId = id(1),
  teacherId = id(2),
  studentId = id(3),
  membershipId = id(4);
const parentId = id(5),
  siblingId = id(6),
  soleParentId = id(7);
const initialTime = new Date('2026-01-01T00:00:00Z');
const matches = (row: object, where: object) =>
  Object.entries(where).every(([key, value]) => Reflect.get(row, key) === value);

function fixture() {
  return {
    memberships: [
      {
        id: membershipId,
        classroomId,
        userId: studentId,
        role: ClassroomRole.STUDENT as ClassroomRole,
        state: MembershipState.ACTIVE,
        deletedAt: null as Date | null,
        updatedAt: initialTime,
      },
      {
        id: id(8),
        classroomId,
        userId: siblingId,
        role: ClassroomRole.STUDENT as ClassroomRole,
        state: MembershipState.ACTIVE,
        deletedAt: null as Date | null,
        updatedAt: initialTime,
      },
    ],
    desks: [{ id: id(9), classroomId, membershipId: membershipId as string | null }],
    links: [
      { classroomId, childId: studentId, parentId, state: MembershipState.ACTIVE },
      { classroomId, childId: studentId, parentId: soleParentId, state: MembershipState.ACTIVE },
      { classroomId, childId: siblingId, parentId, state: MembershipState.ACTIVE },
      { classroomId: id(99), childId: studentId, parentId, state: MembershipState.ACTIVE },
    ],
    history: { submission: { studentId }, grade: { studentId }, message: { authorId: studentId } },
    events: [] as { type: string; payload: unknown }[],
  };
}

describe('Classroom removal HTTP (deterministic persistence, not PostgreSQL)', () => {
  let app: INestApplication;
  let state = fixture();
  let failure: 'desk' | 'links' | 'event' | undefined;
  let reachedFailure: typeof failure;
  let lostTransition = false;
  let queue = Promise.resolve();
  const findMembership = vi.fn(async ({ where }: { where: object }) => {
    const row = state.memberships.find((m) => matches(m, where));
    return row ? { ...row } : null;
  });
  const prisma = {
    classroom: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === classroomId
          ? {
              id: classroomId,
              schoolId: null,
              independentTeacherId: teacherId,
              adultMode: false,
              name: 'Synthetic classroom',
            }
          : null,
      ),
    },
    classroomMembership: { findFirst: findMembership },
    parentLink: {
      findMany: vi.fn(async ({ where }: { where: object }) =>
        state.links.filter((link) => matches(link, where)),
      ),
    },
    // Snapshot reads before queued writes model competing readers seeing ACTIVE.
    // Writes use current state. This deterministic model is NOT a DB lock test.
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<void>) => {
      const readSnapshot = structuredClone(state);
      const prior = queue;
      let unlock!: () => void;
      queue = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await prior;
      const draft = structuredClone(state);
      const tx = {
        classroomMembership: {
          findFirst: async ({ where }: { where: object }) => {
            const row = readSnapshot.memberships.find((m) => matches(m, where));
            return row ? { ...row } : null;
          },
          updateMany: vi.fn(async ({ where, data }: { where: object; data: object }) => {
            if (lostTransition) return { count: 0 };
            let count = 0;
            for (const row of draft.memberships.filter((m) => matches(m, where))) {
              Object.assign(row, data, { updatedAt: new Date() });
              count++;
            }
            return { count };
          }),
        },
        desk: {
          updateMany: async ({ where, data }: { where: object; data: object }) => {
            if (failure === 'desk') {
              reachedFailure = failure;
              throw new Error('Synthetic desk failure');
            }
            draft.desks.filter((d) => matches(d, where)).forEach((d) => Object.assign(d, data));
            return { count: 1 };
          },
        },
        parentLink: {
          updateMany: async ({ where, data }: { where: object; data: object }) => {
            if (failure === 'links') {
              reachedFailure = failure;
              throw new Error('Synthetic link failure');
            }
            draft.links.filter((l) => matches(l, where)).forEach((l) => Object.assign(l, data));
            return { count: 1 };
          },
        },
        outboxEvent: {
          create: async ({ data }: { data: { type: string; payload: unknown } }) => {
            draft.events.push(data);
            if (failure === 'event') {
              reachedFailure = failure;
              throw new Error('Synthetic event failure');
            }
            return { id: id(10) };
          },
        },
      };
      try {
        await work(tx);
        state = draft;
      } finally {
        unlock();
      }
    }),
  };
  const remove = (actor = teacherId, classroom = classroomId, student = studentId) =>
    request(app.getHttpServer())
      .delete(`/classrooms/${classroom}/students/${student}`)
      .set('Authorization', `Bearer ${actor}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ClassroomRemovalModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
              return { userId: header.slice(7), sessionId: id(11) };
            },
          },
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(OutboxDispatcher)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    state = fixture();
    failure = undefined;
    reachedFailure = undefined;
    lostTransition = false;
    queue = Promise.resolve();
    vi.clearAllMocks();
  });

  it('returns 204, preserves attribution, releases desk and revokes only child-specific access', async () => {
    const history = structuredClone(state.history);
    const access = app.get(AccessVerificationService);
    expect((await access.verifyClassroomAccess(studentId, classroomId)).myRole).toBe('STUDENT');
    expect((await access.verifyClassroomAccess(soleParentId, classroomId)).myRole).toBe('PARENT');
    const response = await remove().expect(204);
    expect(response.text).toBe('');
    expect(state.memberships[0]).toMatchObject({ state: 'INACTIVE', deletedAt: expect.any(Date) });
    expect(state.desks[0].membershipId).toBeNull();
    expect(state.links.map((l) => l.state)).toEqual(['INACTIVE', 'INACTIVE', 'ACTIVE', 'ACTIVE']);
    expect(state.history).toEqual(history);
    expect(state.events).toEqual([
      {
        type: 'classroom.membership.removed',
        payload: { classroomId, membershipId, userId: studentId },
      },
    ]);
    await expect(access.verifyClassroomAccess(studentId, classroomId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(access.verifyClassroomAccess(soleParentId, classroomId)).rejects.toMatchObject({
      status: 404,
    });
    expect((await access.verifyClassroomAccess(parentId, classroomId)).linkedChildIds).toEqual([
      siblingId,
    ]);
  });

  it.each([
    ['foreign teacher', id(20), classroomId, studentId, 404],
    ['student', studentId, classroomId, studentId, 403],
    ['parent', parentId, classroomId, studentId, 403],
    ['unknown classroom', teacherId, id(21), studentId, 404],
    ['invalid classroom', teacherId, 'invalid', studentId, 404],
    ['invalid user', teacherId, classroomId, 'invalid', 404],
    ['unknown user', teacherId, classroomId, id(22), 404],
    ['membership UUID is not user UUID', teacherId, classroomId, membershipId, 404],
    ['teacher target', teacherId, classroomId, teacherId, 404],
  ])('rejects %s without writes', async (_label, actor, classroom, student, status) => {
    state.memberships.push({
      ...state.memberships[0],
      id: id(23),
      userId: teacherId,
      role: ClassroomRole.TEACHER,
    });
    const before = structuredClone(state);
    await remove(actor as string, classroom as string, student as string).expect(status as number);
    expect(state).toEqual(before);
  });

  it('requires the existing global session guard', async () => {
    const before = structuredClone(state);
    await request(app.getHttpServer())
      .delete(`/classrooms/${classroomId}/students/${studentId}`)
      .expect(401);
    expect(state).toEqual(before);
  });

  it('leaves duplicate removal timestamps and events unchanged', async () => {
    await remove().expect(204);
    const before = structuredClone(state);
    await remove().expect(204);
    expect(state).toEqual(before);
  });

  it('records one event for concurrent requests', async () => {
    await Promise.all([remove().expect(204), remove().expect(204)]);
    expect(state.events).toHaveLength(1);
    expect(state.memberships[0].state).toBe('INACTIVE');
  });

  it('performs no side effects when a competing writer wins the conditional transition', async () => {
    lostTransition = true;
    const before = structuredClone(state);
    await remove().expect(204);
    expect(state).toEqual(before);
  });

  it.each(['desk', 'links', 'event'] as const)(
    'rolls back all draft changes on %s failure',
    async (stage) => {
      failure = stage;
      const before = structuredClone(state);
      await remove().expect(500);
      expect(reachedFailure).toBe(stage);
      expect(state).toEqual(before);
    },
  );

  it.each([
    { state: MembershipState.INACTIVE, deletedAt: null },
    { state: MembershipState.INACTIVE, deletedAt: initialTime },
    { state: MembershipState.ACTIVE, deletedAt: initialTime },
  ])('treats historical inactive/deleted rows as no-op: %j', async (historical) => {
    Object.assign(state.memberships[0], historical);
    const before = structuredClone(state);
    await remove().expect(204);
    expect(state).toEqual(before);
  });
});
