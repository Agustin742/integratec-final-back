import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';

// Real PostgreSQL and the root module/global guard; only session identity is overridden.
// Append-only synthetic fixtures. The caller owns disposal of this isolated database.
const databaseUrl = loadIsolatedTestDatabaseUrl();
const instant = '2026-11-12T12:00:00.000Z';
const makeIds = () => ({
  teacher: randomUUID(),
  student: randomUUID(),
  sibling: randomUUID(),
  parent: randomUUID(),
  stranger: randomUUID(),
  owner: randomUUID(),
  admin: randomUUID(),
  school: randomUUID(),
  classroom: randomUUID(),
  hidden: randomUUID(),
  otherSchool: randomUUID(),
});

describe('notification HTTP contract with persisted current access', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ids: ReturnType<typeof makeIds>;
  const get = (actor = ids.student, query = '') =>
    request(app.getHttpServer())
      .get(`/notifications${query}`)
      .set('Authorization', `Bearer ${actor}`);
  const patch = (id: string, actor = ids.student) =>
    request(app.getHttpServer())
      .patch(`/notifications/${id}/read`)
      .set('Authorization', `Bearer ${actor}`);
  const all = (actor = ids.student) =>
    request(app.getHttpServer())
      .patch('/notifications/read-all')
      .set('Authorization', `Bearer ${actor}`);
  const notice = async (
    overrides: {
      recipientId?: string;
      classroomId?: string;
      studentId?: string;
      kind?: string;
      createdAt?: Date;
    } = {},
  ) => {
    const event = await prisma.outboxEvent.create({
      data: { type: 'synthetic.notice', payload: {} },
    });
    return prisma.notification.create({
      data: {
        recipientId: ids.student,
        classroomId: ids.classroom,
        kind: 'mention',
        resourceId: randomUUID(),
        sourceEventId: event.id,
        createdAt: new Date(instant),
        ...overrides,
      },
    });
  };
  const envelope = (body: unknown, code: string) =>
    expect(body).toMatchObject({
      error: { code, message: expect.any(String), correlationId: expect.any(String) },
    });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot({ ...authTestConfig(), databaseUrl })],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header: string) => {
          const actor = header?.replace('Bearer ', '');
          if (!actor || actor === 'invalid') throw new UnauthorizedException();
          return { userId: actor, sessionId: randomUUID() };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
  }, 20_000);
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    ids = makeIds();
    await prisma.user.createMany({
      data: [
        ids.teacher,
        ids.student,
        ids.sibling,
        ids.parent,
        ids.stranger,
        ids.owner,
        ids.admin,
      ].map((id) => ({
        id,
        email: `notice-http-${id}@example.invalid`,
        displayName: 'Synthetic user',
        passwordHash: 'unused-synthetic-hash',
        registrationPath: 'SCHOOL',
      })),
    });
    await prisma.school.createMany({
      data: [ids.school, ids.otherSchool].map((id) => ({
        id,
        name: 'Synthetic school',
        slug: id,
      })),
    });
    await prisma.schoolMember.createMany({
      data: [
        { schoolId: ids.school, userId: ids.owner, role: SchoolRole.OWNER },
        { schoolId: ids.school, userId: ids.admin, role: SchoolRole.ADMIN },
        { schoolId: ids.school, userId: ids.teacher, role: SchoolRole.TEACHER },
      ],
    });
    await prisma.classroom.createMany({
      data: [
        { id: ids.classroom, schoolId: ids.school, name: 'Visible classroom' },
        { id: ids.hidden, schoolId: ids.otherSchool, name: 'Hidden classroom' },
      ],
    });
    await prisma.classroomMembership.createMany({
      data: [
        { classroomId: ids.classroom, userId: ids.teacher, role: ClassroomRole.TEACHER },
        { classroomId: ids.classroom, userId: ids.student, role: ClassroomRole.STUDENT },
        { classroomId: ids.classroom, userId: ids.sibling, role: ClassroomRole.STUDENT },
      ],
    });
    await prisma.parentLink.createMany({
      data: [ids.student, ids.sibling].map((childId) => ({
        classroomId: ids.classroom,
        parentId: ids.parent,
        childId,
      })),
    });
  });

  it('filters before pagination/counting, orders ties by descending id and projects only navigation data', async () => {
    await notice({ classroomId: ids.hidden, createdAt: new Date('2026-11-13T00:00:00Z') });
    const rows = await Promise.all([notice(), notice(), notice()]);
    rows.sort((a, b) => b.id.localeCompare(a.id));
    const first = await get(ids.student, '?pageSize=2').expect(200);
    expect(first.body).toEqual({
      items: rows.slice(0, 2).map((row) => ({
        id: row.id,
        kind: 'mention',
        classroomId: ids.classroom,
        resourceId: row.resourceId,
        studentId: null,
        readAt: null,
        createdAt: instant,
      })),
      page: 1,
      pageSize: 2,
      total: 3,
    });
    expect((await get(ids.student, '?page=2&pageSize=2').expect(200)).body).toEqual({
      items: [expect.objectContaining({ id: rows[2].id })],
      page: 2,
      pageSize: 2,
      total: 3,
    });
    expect((await get(ids.stranger).expect(200)).body).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });

  it('persists single read and preserves the original timestamp under replay and concurrent requests', async () => {
    const row = await notice();
    const response = await patch(row.id).expect(200);
    expect(response.body).toEqual({
      id: row.id,
      kind: row.kind,
      resourceId: row.resourceId,
      classroomId: ids.classroom,
      studentId: null,
      createdAt: instant,
      readAt: expect.any(String),
    });
    const repeats = await Promise.all([patch(row.id), patch(row.id), patch(row.id)]);
    for (const repeat of repeats) {
      expect(repeat.status).toBe(200);
      expect(repeat.body).toEqual(response.body);
    }
    expect((await get().expect(200)).body.items).toEqual([response.body]);
  });

  it('marks only visible unread notices and reports actual changed counts on replay and overlap', async () => {
    const old = await notice();
    const first = await patch(old.id).expect(200);
    const fresh = await notice();
    const hidden = await notice({ classroomId: ids.hidden });
    const foreign = await notice({ recipientId: ids.sibling });
    const results = await Promise.all([all(), all(), patch(fresh.id)]);
    results.forEach((result) => expect(result.status).toBe(200));
    expect(results[0].body.updated + results[1].body.updated).toBeLessThanOrEqual(1);
    expect((await all().expect(200)).body).toEqual({ updated: 0 });
    const listed = (await get().expect(200)).body;
    expect(listed.total).toBe(2);
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: old.id, readAt: first.body.readAt }),
        expect.objectContaining({ id: fresh.id, readAt: results[2].body.readAt }),
      ]),
    );
    for (const row of [hidden, foreign]) {
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt,
      ).toBeNull();
    }
  });

  it('reports exact mark-all counts, persists after reload and preserves prior single-read time', async () => {
    const old = await notice();
    const original = (await patch(old.id).expect(200)).body;
    const unread = await notice();
    const hidden = await notice({ classroomId: ids.hidden });
    const foreign = await notice({ recipientId: ids.sibling });
    const before = await prisma.notification.findMany({
      where: { id: { in: [hidden.id, foreign.id] } },
      orderBy: { id: 'asc' },
    });
    expect((await all().expect(200)).body).toEqual({ updated: 1 });
    const listed = (await get().expect(200)).body;
    expect(listed.total).toBe(2);
    expect(listed.items).toEqual(
      expect.arrayContaining([
        original,
        expect.objectContaining({ id: unread.id, readAt: expect.any(String) }),
      ]),
    );
    expect((await all().expect(200)).body).toEqual({ updated: 0 });
    expect((await get().expect(200)).body).toEqual(listed);
    expect(
      await prisma.notification.findMany({
        where: { id: { in: [hidden.id, foreign.id] } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });

  it.each(['classroom', 'school'] as const)(
    'hides deleted %s contexts from listing and both mutations',
    async (context) => {
      const row = await notice();
      if (context === 'classroom')
        await prisma.classroom.update({
          where: { id: ids.classroom },
          data: { deletedAt: new Date() },
        });
      else
        await prisma.school.update({ where: { id: ids.school }, data: { deletedAt: new Date() } });
      expect((await get().expect(200)).body.total).toBe(0);
      await patch(row.id).expect(404);
      expect((await all().expect(200)).body).toEqual({ updated: 0 });
      expect(await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    },
  );

  it.each(['foreign', 'missing', 'malformed', 'lost'] as const)(
    'returns uniform 404 for %s without changing state or visible totals',
    async (reason) => {
      const row = await notice();
      const id =
        reason === 'missing' ? randomUUID() : reason === 'malformed' ? 'not-a-uuid' : row.id;
      const actor = reason === 'foreign' ? ids.sibling : ids.student;
      if (reason === 'lost')
        await prisma.classroomMembership.updateMany({
          where: { userId: ids.student, classroomId: ids.classroom },
          data: { state: MembershipState.INACTIVE },
        });
      const before = (await get(actor).expect(200)).body;
      envelope((await patch(id, actor).expect(404)).body, 'NOT_FOUND');
      expect((await get(actor).expect(200)).body).toEqual(before);
      expect(await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    },
  );

  it.each(['child removed', 'link inactive', 'adult mode'] as const)(
    'revokes exact child visibility for %s despite an active sibling',
    async (change) => {
      const child = await notice({
        recipientId: ids.parent,
        kind: 'grade_posted',
        studentId: ids.student,
      });
      const sibling = await notice({
        recipientId: ids.parent,
        kind: 'grade_posted',
        studentId: ids.sibling,
      });
      expect((await get(ids.parent).expect(200)).body.total).toBe(2);
      if (change === 'child removed')
        await prisma.classroomMembership.updateMany({
          where: { classroomId: ids.classroom, userId: ids.student },
          data: { state: MembershipState.INACTIVE },
        });
      if (change === 'link inactive')
        await prisma.parentLink.updateMany({
          where: { classroomId: ids.classroom, parentId: ids.parent, childId: ids.student },
          data: { state: MembershipState.INACTIVE },
        });
      if (change === 'adult mode')
        await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: true } });
      const listing = (await get(ids.parent, '?pageSize=1').expect(200)).body;
      expect(listing.total).toBe(change === 'adult mode' ? 0 : 1);
      expect(listing.items).toEqual(
        change === 'adult mode' ? [] : [expect.objectContaining({ id: sibling.id })],
      );
      await patch(child.id, ids.parent).expect(404);
      expect((await all(ids.parent).expect(200)).body).toEqual({
        updated: change === 'adult mode' ? 0 : 1,
      });
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: child.id } })).readAt,
      ).toBeNull();
      if (change === 'adult mode') {
        await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: false } });
        expect((await get(ids.parent).expect(200)).body.total).toBe(2);
      }
    },
  );

  it.each(['announcement', 'mention', 'activity_published'])(
    'denies parent %s even with a child context',
    async (kind) => {
      const row = await notice({ recipientId: ids.parent, studentId: ids.student, kind });
      expect((await get(ids.parent).expect(200)).body.total).toBe(0);
      await patch(row.id, ids.parent).expect(404);
      expect((await all(ids.parent).expect(200)).body).toEqual({ updated: 0 });
    },
  );

  it.each(['owner', 'admin', 'teacher'] as const)(
    'preserves %s authority without parent-mode restrictions',
    async (role) => {
      await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: true } });
      const row = await notice({
        recipientId: ids[role],
        studentId: ids.student,
        kind: 'grade_posted',
      });
      expect((await get(ids[role]).expect(200)).body.total).toBe(1);
      await patch(row.id, ids[role]).expect(200);
    },
  );

  it('denies a classmate private context and revoked school authority without writes', async () => {
    const privateRow = await notice({ studentId: ids.sibling, kind: 'grade_posted' });
    const staffRow = await notice({ recipientId: ids.admin });
    await prisma.schoolMember.updateMany({
      where: { userId: ids.admin },
      data: { state: MembershipState.INACTIVE },
    });
    for (const [row, actor] of [
      [privateRow, ids.student],
      [staffRow, ids.admin],
    ] as const) {
      expect((await get(actor).expect(200)).body.total).toBe(0);
      await patch(row.id, actor).expect(404);
      expect((await all(actor).expect(200)).body).toEqual({ updated: 0 });
    }
  });

  it.each([
    'page=0',
    'page=1.5',
    'page=10001',
    'pageSize=0',
    'pageSize=101',
    'pageSize=x',
    'sort=-createdAt',
    'recipientId=x',
  ])('rejects invalid query %s without writes', async (query) => {
    const row = await notice();
    envelope((await get(ids.student, `?${query}`).expect(400)).body, 'VALIDATION_FAILED');
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it.each(['/notifications', '/notifications/read-all', '/notifications/not-a-uuid/read'])(
    'requires credentials at %s and leaves data unchanged',
    async (path) => {
      const row = await notice();
      const method = path === '/notifications' ? 'get' : 'patch';
      for (const header of [undefined, 'Bearer invalid']) {
        const req = request(app.getHttpServer())[method](path);
        if (header) req.set('Authorization', header);
        envelope((await req.expect(401)).body, 'UNAUTHENTICATED');
      }
      expect(await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    },
  );

  it('preserves existing public health and authenticated classroom routes after root integration', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    const result = await request(app.getHttpServer())
      .get(`/classrooms/${ids.classroom}`)
      .set('Authorization', `Bearer ${ids.student}`)
      .expect(200);
    expect(result.body.id).toBe(ids.classroom);
  });
});
