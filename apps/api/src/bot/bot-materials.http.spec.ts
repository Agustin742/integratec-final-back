import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, RegistrationPath, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';
import {
  MATERIAL_INDEX_PORT,
  type MaterialIndexEntry,
  type MaterialIndexPort,
} from './material-index.port';

const databaseUrl = loadIsolatedTestDatabaseUrl();

// Public HTTP + real isolated PostgreSQL + fake index port. No real sessions,
// environment-file loader, AWS credentials, retrieval network, or shared fixture
// cleanup. The fake port records per-classroom partition membership so tests can
// assert the retrieval partition contract without any retrieval technology.
describe('teacher bot material enablement — issue #40 / HU-BOT-001', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let failNextIndex = false;
  let failNextRemove = false;
  const [
    teacher,
    student,
    parent,
    stranger,
    otherTeacher,
    owner,
    admin,
    schoolTeacher,
    otherSchoolTeacher,
  ] = Array.from({ length: 9 }, () => randomUUID());
  const [classroom, foreignClassroom, schoolClassroom, otherSchoolClassroom, school] = Array.from(
    { length: 5 },
    () => randomUUID(),
  );
  const [m1, m2, m3, mRemoval, fm, sm, osm] = Array.from({ length: 7 }, () => randomUUID());
  const users: string[] = [
    teacher,
    student,
    parent,
    stranger,
    otherTeacher,
    owner,
    admin,
    schoolTeacher,
    otherSchoolTeacher,
  ];
  const pdf = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const material = (id: string, classroomId: string, authorId: string, name: string) => ({
    id,
    classroomId,
    authorId,
    objectKey: `materials/${classroomId}/${id}`,
    filename: name,
    contentType: 'application/pdf',
    sizeBytes: pdf.length,
  });
  const materialsByClassroom: Record<string, string> = {
    [classroom]: m1,
    [foreignClassroom]: fm,
    [schoolClassroom]: sm,
    [otherSchoolClassroom]: osm,
  };
  const ownerByClassroom: Record<string, string> = {
    [classroom]: teacher,
    [foreignClassroom]: otherTeacher,
    [schoolClassroom]: schoolTeacher,
    [otherSchoolClassroom]: otherSchoolTeacher,
  };
  // Fake port membership: classroom partition -> set of indexed material ids.
  const indexedPartitions = new Map<string, Set<string>>();
  const indexMock = vi.fn(async (entry: MaterialIndexEntry): Promise<void> => {
    if (failNextIndex) {
      failNextIndex = false;
      throw new Error('Synthetic index diagnostic');
    }
    const partition = indexedPartitions.get(entry.classroomId) ?? new Set<string>();
    partition.add(entry.materialId);
    indexedPartitions.set(entry.classroomId, partition);
  });
  const removeMock = vi.fn(async (classroomId: string, materialId: string): Promise<void> => {
    if (failNextRemove) {
      failNextRemove = false;
      throw new Error('Synthetic remove diagnostic');
    }
    indexedPartitions.get(classroomId)?.delete(materialId);
  });
  const isIndexedMock = vi.fn(
    async (classroomId: string, materialId: string): Promise<boolean> =>
      indexedPartitions.get(classroomId)?.has(materialId) ?? false,
  );
  const indexPort: MaterialIndexPort = {
    index: indexMock,
    remove: removeMock,
    isIndexed: isIndexedMock,
  };

  const path = (id: string = classroom) => `/classrooms/${id}/bot/materials`;
  const bearer = (call: request.Test, actor: string | null) =>
    actor === null ? call : call.set('Authorization', `Bearer bot-materials:${actor}`);
  const enable = (
    actor: string | null,
    id: string = classroom,
    materialId: string,
    extra: object = {},
  ) =>
    bearer(
      request(app.getHttpServer())
        .post(path(id))
        .send({ materialId, ...extra }),
      actor,
    );
  const enableRaw = (actor: string | null, body: object) =>
    bearer(request(app.getHttpServer()).post(path()).send(body), actor);
  const list = (actor: string | null, id: string = classroom, query: object = {}) =>
    bearer(request(app.getHttpServer()).get(path(id)).query(query), actor);
  const disable = (actor: string | null, id: string = classroom, materialId: string) =>
    bearer(request(app.getHttpServer()).delete(`${path(id)}/${materialId}`), actor);
  const allowedRows = (classroomId: string = classroom) =>
    prisma.allowedMaterial.count({ where: { classroomId } });
  const partitionHas = async (classroomId: string, materialId: string) =>
    indexPort.isIndexed(classroomId, materialId);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (!header?.startsWith('Bearer bot-materials:')) throw new UnauthorizedException();
          const userId = header.slice('Bearer bot-materials:'.length);
          if (!users.includes(userId)) throw new UnauthorizedException();
          return { userId, sessionId: randomUUID() };
        },
      })
      .overrideProvider(MATERIAL_INDEX_PORT)
      .useValue(indexPort)
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: 'Synthetic bot-material participant',
          email: `bot-material-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.school.create({
        data: { id: school, name: 'Synthetic bot school', slug: `bot-material-${school}` },
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId: school, userId: owner, role: SchoolRole.OWNER },
          { schoolId: school, userId: admin, role: SchoolRole.ADMIN },
          { schoolId: school, userId: schoolTeacher, role: SchoolRole.TEACHER },
          { schoolId: school, userId: otherSchoolTeacher, role: SchoolRole.TEACHER },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: classroom, name: 'Bot materials', independentTeacherId: teacher },
          {
            id: foreignClassroom,
            name: 'Foreign bot materials',
            independentTeacherId: otherTeacher,
          },
          { id: schoolClassroom, name: 'School bot materials', schoolId: school },
          { id: otherSchoolClassroom, name: 'Other school bot materials', schoolId: school },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroom, userId: student, role: ClassroomRole.STUDENT },
          { classroomId: schoolClassroom, userId: schoolTeacher, role: ClassroomRole.TEACHER },
          {
            classroomId: otherSchoolClassroom,
            userId: otherSchoolTeacher,
            role: ClassroomRole.TEACHER,
          },
        ],
      });
      await tx.parentLink.create({
        data: { classroomId: classroom, parentId: parent, childId: student },
      });
      await tx.studyMaterial.createMany({
        data: [
          material(m1, classroom, teacher, 'lesson-1.pdf'),
          material(m2, classroom, teacher, 'lesson-2.pdf'),
          material(m3, classroom, teacher, 'lesson-3.pdf'),
          material(mRemoval, classroom, teacher, 'to-remove.pdf'),
          material(fm, foreignClassroom, otherTeacher, 'foreign.pdf'),
          material(sm, schoolClassroom, schoolTeacher, 'school.pdf'),
          material(osm, otherSchoolClassroom, otherSchoolTeacher, 'other-school.pdf'),
        ],
      });
    });
  }, 30_000);
  afterAll(async () => {
    await app?.close();
  });

  it('indexes a teacher-approved material under the classroom partition and marks it available', async () => {
    const response = await enable(teacher, classroom, m1).expect(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      classroomId: classroom,
      materialId: m1,
      filename: 'lesson-1.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      indexState: 'INDEXED',
      failureReason: null,
      createdAt: expect.any(String),
    });
    expect(indexMock).toHaveBeenCalledWith({
      classroomId: classroom,
      materialId: m1,
      objectKey: `materials/${classroom}/${m1}`,
      filename: 'lesson-1.pdf',
      contentType: 'application/pdf',
    });
    expect(await partitionHas(classroom, m1)).toBe(true);
    expect(await partitionHas(foreignClassroom, m1)).toBe(false);
    const listed = await list(teacher).expect(200);
    expect(listed.body.items).toContainEqual(response.body);
  });

  it.each([owner, admin, schoolTeacher])(
    'lets school staff %s configure bot material without a classroom membership',
    async (actor) => {
      const response = await enable(actor, schoolClassroom, sm).expect(201);
      expect(response.body).toMatchObject({
        classroomId: schoolClassroom,
        materialId: sm,
        indexState: 'INDEXED',
      });
      expect(await partitionHas(schoolClassroom, sm)).toBe(true);
    },
  );

  it.each([
    ['enrolled student', () => enable(student, classroom, m2)],
    ['linked parent', () => enable(parent, classroom, m2)],
    ['unrelated stranger', () => enable(stranger, classroom, m2)],
    ['teacher of a foreign classroom', () => enable(otherTeacher, classroom, m2)],
    ['same-school teacher of another classroom', () => enable(otherSchoolTeacher, classroom, m2)],
    ['school staff outside their school', () => enable(owner, classroom, m2)],
    [
      'teacher of another classroom of the same school',
      () => enable(otherSchoolTeacher, schoolClassroom, sm),
    ],
  ])(
    'conceals bot material configuration from %s with 404 and no state change',
    async (_, call) => {
      const rows = await allowedRows();
      const indexCalls = indexMock.mock.calls.length;
      await call().expect(404);
      expect(await allowedRows()).toBe(rows);
      expect(indexMock.mock.calls).toHaveLength(indexCalls);
    },
  );

  it('rejects missing authentication on each public operation', async () => {
    await enable(null, classroom, m1).expect(401);
    await list(null).expect(401);
    await disable(null, classroom, m1).expect(401);
  });

  it('applies the #26 resource boundary to direct and object-origin requests', async () => {
    // Untrusted object context travels as an ignored header: the endpoints must
    // decide from the authenticated actor and the path resource alone.
    const interaction = { classroomId: classroom, studentId: student, objectId: 'bot-panel' };
    const withInteraction = (call: request.Test, untrusted: unknown) =>
      untrusted === undefined ? call : call.set('x-object-context', JSON.stringify(untrusted));
    await assertResourceAuthorization({
      request: (resourceId, untrusted) =>
        withInteraction(enable(teacher, resourceId, materialsByClassroom[resourceId]), untrusted),
      allowedResourceId: classroom,
      foreignResourceId: foreignClassroom,
      interaction,
      allowedStatus: 201,
      deniedStatus: 404,
      assertAllowed: (response) => {
        expect(response.body).toMatchObject({ indexState: 'INDEXED' });
      },
      assertDenied: (response) => {
        expect(response.body).not.toHaveProperty('indexState');
      },
    });
    await assertResourceAuthorization({
      request: (resourceId, untrusted) => withInteraction(list(teacher, resourceId), untrusted),
      allowedResourceId: classroom,
      foreignResourceId: foreignClassroom,
      interaction,
      allowedStatus: 200,
      deniedStatus: 404,
      assertAllowed: (response) => {
        expect(response.body).toHaveProperty('items');
      },
      assertDenied: (response) => {
        expect(response.body).not.toHaveProperty('items');
      },
    });
    await assertResourceAuthorization({
      // Re-establish the allowed row before each case so the boundary, not the
      // row lifecycle, decides the outcome.
      request: async (resourceId, untrusted) => {
        await enable(ownerByClassroom[resourceId], resourceId, materialsByClassroom[resourceId]);
        return withInteraction(
          disable(teacher, resourceId, materialsByClassroom[resourceId]),
          untrusted,
        );
      },
      allowedResourceId: classroom,
      foreignResourceId: foreignClassroom,
      interaction,
      allowedStatus: 204,
      deniedStatus: 404,
    });
  });

  it('marks a failed indexing attempt visible without touching the material', async () => {
    failNextIndex = true;
    const response = await enable(teacher, classroom, m2).expect(201);
    expect(response.body).toMatchObject({
      materialId: m2,
      indexState: 'FAILED',
      failureReason: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toContain('Synthetic index diagnostic');
    expect(await partitionHas(classroom, m2)).toBe(false);
    // The material stays usable for its normal classroom purposes.
    const row = await prisma.studyMaterial.findUnique({
      where: { id: m2 },
      select: { removedAt: true, filename: true },
    });
    expect(row).toMatchObject({ removedAt: null, filename: 'lesson-2.pdf' });
    const listed = await list(teacher).expect(200);
    const entry = listed.body.items.find((item: { materialId: string }) => item.materialId === m2);
    expect(entry).toMatchObject({ indexState: 'FAILED' });
    // Retry indexes from scratch: no reuse of earlier chunks.
    const retry = await enable(teacher, classroom, m2).expect(201);
    expect(retry.body).toMatchObject({ indexState: 'INDEXED', failureReason: null });
    expect(await partitionHas(classroom, m2)).toBe(true);
  });

  it.each([
    ['a material of another classroom', fm],
    ['an unknown material id', randomUUID()],
  ])('rejects enabling %s with 404 and no state change', async (_, materialId) => {
    const rows = await allowedRows();
    const indexCalls = indexMock.mock.calls.length;
    await enable(teacher, classroom, materialId).expect(404);
    expect(await allowedRows()).toBe(rows);
    expect(indexMock.mock.calls).toHaveLength(indexCalls);
  });

  it.each([
    ['a missing materialId', {}],
    ['a malformed materialId', { materialId: 'not-a-uuid' }],
    ['an unknown extra field', { materialId: m1, objectKey: 'synthetic-tamper' }],
  ])('rejects %s with a validation error and no state change', async (_, body) => {
    const rows = await allowedRows();
    const indexCalls = indexMock.mock.calls.length;
    const response = await enableRaw(teacher, body).expect(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.objectContaining({ field: expect.any(String) })],
    });
    expect(await allowedRows()).toBe(rows);
    expect(indexMock.mock.calls).toHaveLength(indexCalls);
  });

  it('rejects enabling a soft-removed material and excludes it from the list', async () => {
    const rowsBefore = await allowedRows();
    const enabled = await enable(teacher, classroom, mRemoval).expect(201);
    expect(enabled.body.indexState).toBe('INDEXED');
    await prisma.studyMaterial.update({
      where: { id: mRemoval },
      data: { removedAt: new Date(), removedById: teacher },
    });
    try {
      expect(
        (await list(teacher).expect(200)).body.items.some(
          (item: { materialId: string }) => item.materialId === mRemoval,
        ),
      ).toBe(false);
      await enable(teacher, classroom, mRemoval).expect(404);
      // The teacher can still clean up the stale allowance of a removed material.
      await disable(teacher, classroom, mRemoval).expect(204);
      expect(await allowedRows()).toBe(rowsBefore);
    } finally {
      await prisma.studyMaterial.update({
        where: { id: mRemoval },
        data: { removedAt: null, removedById: null },
      });
    }
  });

  it('disables an allowed material immediately: row removed, partition emptied, list empty', async () => {
    await enable(teacher, classroom, m3).expect(201);
    const rowsBefore = await allowedRows();
    await disable(student, classroom, m3).expect(404);
    await disable(otherTeacher, classroom, m3).expect(404);
    expect(await allowedRows()).toBe(rowsBefore);
    const removeCalls = removeMock.mock.calls.length;
    await disable(teacher, classroom, m3).expect(204);
    expect(removeMock).toHaveBeenCalledWith(classroom, m3);
    expect(removeMock.mock.calls).toHaveLength(removeCalls + 1);
    expect(await partitionHas(classroom, m3)).toBe(false);
    expect(
      await prisma.allowedMaterial.count({ where: { classroomId: classroom, materialId: m3 } }),
    ).toBe(0);
    expect(
      (await list(teacher).expect(200)).body.items.some(
        (item: { materialId: string }) => item.materialId === m3,
      ),
    ).toBe(false);
    await disable(teacher, classroom, m3).expect(404);
    // Re-enabling indexes from scratch and never reuses the earlier chunks.
    await enable(teacher, classroom, m3).expect(201);
    expect(await partitionHas(classroom, m3)).toBe(true);
    await disable(teacher, classroom, m3).expect(204);
  });

  it('answers 503 when partition cleanup fails while the row is already deleted', async () => {
    await enable(teacher, classroom, m3).expect(201);
    failNextRemove = true;
    const response = await disable(teacher, classroom, m3).expect(503);
    expect(response.body.error).toBeTruthy();
    // The database row is the exclusion authority: the material is already
    // excluded even though the partition cleanup is still pending.
    expect(
      await prisma.allowedMaterial.count({ where: { classroomId: classroom, materialId: m3 } }),
    ).toBe(0);
    // Cleanup is pending, so the partition still holds the stale membership.
    expect(await partitionHas(classroom, m3)).toBe(true);
    // Retrying the enable re-indexes from scratch, and a successful disable
    // then clears the partition, completing the pending cleanup.
    await enable(teacher, classroom, m3).expect(201);
    expect(await partitionHas(classroom, m3)).toBe(true);
    await disable(teacher, classroom, m3).expect(204);
    expect(await partitionHas(classroom, m3)).toBe(false);
  });

  const removeThroughMaterials = (actor: string, materialId: string) =>
    bearer(
      request(app.getHttpServer()).delete(`/classrooms/${classroom}/materials/${materialId}`),
      actor,
    );
  const restoreMaterial = (id: string) =>
    prisma.studyMaterial.update({ where: { id }, data: { removedAt: null, removedById: null } });

  it('removing a study material also removes it from the bot: row deleted, partition emptied, list empty', async () => {
    await enable(teacher, classroom, mRemoval).expect(201);
    expect(await partitionHas(classroom, mRemoval)).toBe(true);
    try {
      await removeThroughMaterials(teacher, mRemoval).expect(204);
      expect(
        await prisma.allowedMaterial.count({
          where: { classroomId: classroom, materialId: mRemoval },
        }),
      ).toBe(0);
      expect(removeMock).toHaveBeenCalledWith(classroom, mRemoval);
      expect(await partitionHas(classroom, mRemoval)).toBe(false);
      expect(
        (await list(teacher).expect(200)).body.items.some(
          (item: { materialId: string }) => item.materialId === mRemoval,
        ),
      ).toBe(false);
    } finally {
      await restoreMaterial(mRemoval);
    }
  });

  it('keeps the material removal successful when de-indexing fails; the allowed row is already gone', async () => {
    await enable(teacher, classroom, mRemoval).expect(201);
    try {
      failNextRemove = true;
      await removeThroughMaterials(teacher, mRemoval).expect(204);
      expect(
        await prisma.allowedMaterial.count({
          where: { classroomId: classroom, materialId: mRemoval },
        }),
      ).toBe(0);
      const removed = await prisma.studyMaterial.findUniqueOrThrow({
        where: { id: mRemoval },
        select: { removedAt: true },
      });
      expect(removed.removedAt).not.toBeNull();
    } finally {
      failNextRemove = false;
      await restoreMaterial(mRemoval);
    }
  });

  it('answers a duplicate enable idempotently with a single row', async () => {
    const first = await enable(teacher, classroom, m1).expect(201);
    const second = await enable(teacher, classroom, m1).expect(201);
    expect(second.body).toMatchObject(first.body);
    const rows = await prisma.allowedMaterial.findMany({
      where: { classroomId: classroom, materialId: m1 },
      select: { id: true },
    });
    expect(rows).toHaveLength(1);
    expect(second.body.indexState).toBe('INDEXED');
  });

  it('paginates the allowed list deterministically and bounds list parameters', async () => {
    // Reset the classroom allowance directly so only this test's rows decide the
    // pages, regardless of what earlier tests left behind.
    await prisma.allowedMaterial.deleteMany({ where: { classroomId: classroom } });
    const extra = Array.from({ length: 3 }, (_, index) =>
      material(randomUUID(), classroom, teacher, `pagination-${index}.pdf`),
    );
    await prisma.studyMaterial.createMany({ data: extra });
    for (const row of extra) {
      await enable(teacher, classroom, row.id).expect(201);
    }
    const full = await list(teacher, classroom, { pageSize: 100 }).expect(200);
    expect(full.body.total).toBe(extra.length);
    // The API order must match the repository's (createdAt, id) descending order,
    // even when adjacent timestamps tie.
    const expectedOrder = (
      await prisma.allowedMaterial.findMany({
        where: { classroomId: classroom },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { materialId: true },
      })
    ).map((row) => row.materialId);
    expect(full.body.items.map((item: { materialId: string }) => item.materialId)).toEqual(
      expectedOrder,
    );
    const first = await list(teacher, classroom, { pageSize: 1, sort: 'createdAt' }).expect(200);
    const second = await list(teacher, classroom, {
      pageSize: 1,
      page: 2,
      sort: 'createdAt',
    }).expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(second.body.items).toHaveLength(1);
    expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
    await list(teacher, classroom, { pageSize: 101 }).expect(400);
    await list(teacher, classroom, { page: 0 }).expect(400);
    await list(teacher, classroom, { sort: 'objectKey' }).expect(400);
    for (const row of extra) {
      await disable(teacher, classroom, row.id).expect(204);
    }
  });

  it('returns 404 for malformed or unknown classroom identifiers', async () => {
    await enable(teacher, 'not-a-uuid', m1).expect(404);
    await list(teacher, 'not-a-uuid').expect(404);
    await disable(teacher, 'not-a-uuid', m1).expect(404);
    const unknown = randomUUID();
    await enable(teacher, unknown, m1).expect(404);
    await list(teacher, unknown).expect(404);
    await disable(teacher, unknown, m1).expect(404);
  });
});
