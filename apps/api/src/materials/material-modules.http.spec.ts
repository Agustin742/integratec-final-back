import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MaterialIndexState, RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { STORAGE_PORT, type StoragePort } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { MATERIAL_MODULE_LIMITS } from './material-modules.dto';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const databaseUrl = loadIsolatedTestDatabaseUrl();

type ModuleBody = {
  id: string;
  classroomId: string;
  name: string;
  description: string | null;
  position: number;
  materialCount: number;
};
type MaterialBody = { id: string; moduleId: string | null };

// Public HTTP + real isolated PostgreSQL + in-memory storage boundary.
describe('material modules HTTP — ordered modules inside a classroom', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const [teacher, student, parent, otherTeacher] = Array.from({ length: 4 }, () => randomUUID());
  const [classroom, foreignClassroom] = Array.from({ length: 2 }, () => randomUUID());
  const users: string[] = [teacher, student, parent, otherTeacher];
  const storage: StoragePort = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ body: new Uint8Array(), contentType: 'application/pdf' })),
    delete: vi.fn(async () => undefined),
    getSignedDownloadUrl: vi.fn(async () => 'https://storage.example.invalid/signed'),
  };
  const call = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    actor: string,
    path: string,
    scope: string = classroom,
  ) => {
    const http = request(app.getHttpServer());
    return http[method](`/classrooms/${scope}${path}`).set(
      'Authorization',
      `Bearer modules-test:${actor}`,
    );
  };
  const createModule = async (
    name: string,
    actor = teacher,
    scope = classroom,
    description?: string,
  ) =>
    (
      await call('post', actor, '/material-modules', scope)
        .send(description === undefined ? { name } : { name, description })
        .expect(201)
    ).body as ModuleBody;
  const listModules = async (actor = teacher, scope = classroom) =>
    (await call('get', actor, '/material-modules', scope).expect(200)).body.items as ModuleBody[];
  const upload = (actor = teacher, scope = classroom, moduleId?: string) => {
    let req = call('post', actor, '/materials', scope);
    if (moduleId !== undefined) req = req.field('moduleId', moduleId);
    return req.attach('file', pdf, { filename: 'lesson.pdf', contentType: 'application/pdf' });
  };
  const createMaterial = async (moduleId?: string, actor = teacher, scope = classroom) =>
    (await upload(actor, scope, moduleId).expect(201)).body as MaterialBody;
  const listMaterials = async (query: Record<string, string> = {}, actor = teacher) =>
    (await call('get', actor, '/materials').query(query).expect(200)).body.items as MaterialBody[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (!header?.startsWith('Bearer modules-test:')) throw new UnauthorizedException();
          const userId = header.slice('Bearer modules-test:'.length);
          if (!users.includes(userId)) throw new UnauthorizedException();
          return { userId, sessionId: randomUUID() };
        },
      })
      .overrideProvider(STORAGE_PORT)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: 'Synthetic module participant',
          email: `modules-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          { id: classroom, name: 'Modules', independentTeacherId: teacher },
          { id: foreignClassroom, name: 'Foreign modules', independentTeacherId: otherTeacher },
        ],
      });
      await tx.classroomMembership.create({
        data: { classroomId: classroom, userId: student, role: ClassroomRole.STUDENT },
      });
      await tx.parentLink.create({
        data: { classroomId: classroom, parentId: parent, childId: student },
      });
    });
  }, 30_000);
  afterAll(async () => {
    await app?.close();
  });

  describe('permissions', () => {
    it('lets the teacher create a module and appends it at the end', async () => {
      const first = await createModule('  Unit 1  ', teacher, classroom, 'Intro');
      expect(first).toMatchObject({
        classroomId: classroom,
        name: 'Unit 1',
        description: 'Intro',
        position: expect.any(Number),
        materialCount: 0,
      });
      const second = await createModule('Unit 2');
      expect(second.description).toBeNull();
      expect(second.position).toBeGreaterThan(first.position);
    });

    it('rejects student writes with 403 and leaves modules unchanged', async () => {
      const mod = await createModule('Student write target');
      const before = await listModules();
      await call('post', student, '/material-modules').send({ name: 'x' }).expect(403);
      await call('patch', student, `/material-modules/${mod.id}`).send({ name: 'x' }).expect(403);
      await call('put', student, '/material-modules/order')
        .send({ moduleIds: before.map((m) => m.id) })
        .expect(403);
      await call('delete', student, `/material-modules/${mod.id}`).expect(403);
      const material = await createMaterial();
      await call('patch', student, `/materials/${material.id}`)
        .send({ moduleId: mod.id })
        .expect(403);
      await upload(student, classroom, mod.id).expect(403);
      expect(await listModules()).toEqual(before);
    });

    it('lets students read modules and filter materials, like materials today', async () => {
      const mod = await createModule('Readable');
      const material = await createMaterial(mod.id);
      expect((await listModules(student)).map((m) => m.id)).toContain(mod.id);
      const filtered = await listMaterials({ moduleId: mod.id }, student);
      expect(filtered.map((m) => m.id)).toEqual([material.id]);
    });

    it('gives a foreign teacher 404 on every operation', async () => {
      const mod = await createModule('Hidden');
      await call('get', otherTeacher, '/material-modules').expect(404);
      await call('post', otherTeacher, '/material-modules').send({ name: 'x' }).expect(404);
      await call('patch', otherTeacher, `/material-modules/${mod.id}`)
        .send({ name: 'x' })
        .expect(404);
      await call('delete', otherTeacher, `/material-modules/${mod.id}`).expect(404);
      await call('put', otherTeacher, '/material-modules/order')
        .send({ moduleIds: [] })
        .expect(404);
    });

    it('gives parents 403 as for materials, and 401 without authentication', async () => {
      await call('get', parent, '/material-modules').expect(403);
      await call('post', parent, '/material-modules').send({ name: 'x' }).expect(403);
      await request(app.getHttpServer())
        .get(`/classrooms/${classroom}/material-modules`)
        .expect(401);
    });

    it('returns 404 for malformed identifiers', async () => {
      await call('patch', teacher, '/material-modules/not-a-uuid').send({ name: 'x' }).expect(404);
      await call('delete', teacher, '/material-modules/not-a-uuid').expect(404);
      await call('get', teacher, '/material-modules', 'not-a-uuid').expect(404);
      await call('delete', teacher, `/material-modules/${randomUUID()}`).expect(404);
    });
  });

  describe('validation, rename and ordering', () => {
    it.each([
      ['empty name', { name: '   ' }],
      ['missing name', {}],
      ['overlong name', { name: 'a'.repeat(81) }],
      ['overlong description', { name: 'ok', description: 'a'.repeat(501) }],
      ['NUL byte in description', { name: 'ok', description: 'Intro\u0000' }],
      ['control character in description', { name: 'ok', description: 'Intro\x07' }],
      ['null description on create', { name: 'ok', description: null }],
      ['unknown field', { name: 'ok', position: 3 }],
    ])('rejects %s with 400', async (_label, body) => {
      const before = await listModules();
      await call('post', teacher, '/material-modules').send(body).expect(400);
      expect(await listModules()).toEqual(before);
    });

    it('renames a module and clears its description with null', async () => {
      const mod = await createModule('Old name', teacher, classroom, 'Desc');
      const renamed = await call('patch', teacher, `/material-modules/${mod.id}`)
        .send({ name: 'New name' })
        .expect(200);
      expect(renamed.body).toMatchObject({ id: mod.id, name: 'New name', description: 'Desc' });
      const multiline = await call('patch', teacher, `/material-modules/${mod.id}`)
        .send({ description: 'Line 1\nLine 2' })
        .expect(200);
      expect(multiline.body).toMatchObject({ name: 'New name', description: 'Line 1\nLine 2' });
      const cleared = await call('patch', teacher, `/material-modules/${mod.id}`)
        .send({ description: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ name: 'New name', description: null });
      await call('patch', teacher, `/material-modules/${mod.id}`)
        .send({ description: 'Bad\u0000desc' })
        .expect(400);
      await call('patch', teacher, `/material-modules/${mod.id}`).send({ name: null }).expect(400);
      await call('patch', teacher, `/material-modules/${mod.id}`).send({}).expect(400);
    });

    it('lists modules in position order and persists an exact reorder', async () => {
      const ids = (await listModules()).map((m) => m.id);
      const reversed = [...ids].reverse();
      const response = await call('put', teacher, '/material-modules/order')
        .send({ moduleIds: reversed })
        .expect(200);
      expect(response.body.items.map((m: ModuleBody) => m.id)).toEqual(reversed);
      expect((await listModules(student)).map((m) => m.id)).toEqual(reversed);
      const created = await createModule('Appended after reorder');
      expect((await listModules()).map((m) => m.id)).toEqual([...reversed, created.id]);
    });

    it('rejects a reorder that misses, repeats, or invents modules', async () => {
      const current = await listModules();
      const ids = current.map((m) => m.id);
      const bad = [ids.slice(1), [...ids, ids[0]], [...ids.slice(1), randomUUID()], ['not-a-uuid']];
      for (const moduleIds of bad) {
        await call('put', teacher, '/material-modules/order').send({ moduleIds }).expect(400);
      }
      expect(await listModules()).toEqual(current);
    });
  });

  describe('materials and modules', () => {
    it('uploads into a module, or unassigned when moduleId is omitted', async () => {
      const mod = await createModule('Upload target');
      const inModule = await createMaterial(mod.id);
      const loose = await createMaterial();
      expect(inModule.moduleId).toBe(mod.id);
      expect(loose.moduleId).toBeNull();
      expect((await listModules()).find((m) => m.id === mod.id)?.materialCount).toBe(1);
    });

    it('rejects upload to an unknown, removed, malformed or foreign module before storing', async () => {
      const foreign = await createModule('Foreign', otherTeacher, foreignClassroom);
      const removed = await createModule('Removed');
      await call('delete', teacher, `/material-modules/${removed.id}`).expect(204);
      const putCalls = vi.mocked(storage.put).mock.calls.length;
      await upload(teacher, classroom, randomUUID()).expect(404);
      await upload(teacher, classroom, foreign.id).expect(404);
      await upload(teacher, classroom, removed.id).expect(404);
      await upload(teacher, classroom, 'not-a-uuid').expect(400);
      expect(vi.mocked(storage.put).mock.calls).toHaveLength(putCalls);
    });

    it('moves a material between modules and back to unassigned', async () => {
      const a = await createModule('Move A');
      const b = await createModule('Move B');
      const material = await createMaterial();
      const toA = await call('patch', teacher, `/materials/${material.id}`)
        .send({ moduleId: a.id })
        .expect(200);
      expect(toA.body).toMatchObject({ id: material.id, moduleId: a.id });
      const toB = await call('patch', teacher, `/materials/${material.id}`)
        .send({ moduleId: b.id })
        .expect(200);
      expect(toB.body.moduleId).toBe(b.id);
      const loose = await call('patch', teacher, `/materials/${material.id}`)
        .send({ moduleId: null })
        .expect(200);
      expect(loose.body.moduleId).toBeNull();
      await call('patch', teacher, `/materials/${material.id}`).send({}).expect(400);
      await call('patch', teacher, `/materials/${material.id}`)
        .send({ moduleId: 'nope' })
        .expect(400);
    });

    it('cleans up the newly stored object when the module is removed mid-upload', async () => {
      const mod = await createModule('Mid-upload removed');
      let uploadedKey: string | undefined;
      vi.mocked(storage.put).mockImplementationOnce(async (key) => {
        uploadedKey = key;
        await prisma.materialModule.update({
          where: { id: mod.id },
          data: { removedAt: new Date(), removedById: teacher },
        });
      });
      await upload(teacher, classroom, mod.id).expect(404);
      expect(uploadedKey).toBeDefined();
      expect(vi.mocked(storage.delete)).toHaveBeenCalledWith(uploadedKey);
      expect(await prisma.studyMaterial.count({ where: { moduleId: mod.id } })).toBe(0);
    });

    it('filters materials by module and by unassigned', async () => {
      const mod = await createModule('Filter module');
      const foreign = await createModule('Foreign filter', otherTeacher, foreignClassroom);
      const inside = await createMaterial(mod.id);
      const outside = await createMaterial();
      const byModule = await listMaterials({ moduleId: mod.id });
      expect(byModule.map((m) => m.id)).toEqual([inside.id]);
      const unassigned = await listMaterials({ moduleId: 'unassigned', pageSize: '100' });
      expect(unassigned.map((m) => m.id)).toContain(outside.id);
      expect(unassigned.map((m) => m.id)).not.toContain(inside.id);
      expect(unassigned.every((m) => m.moduleId === null)).toBe(true);
      const all = await listMaterials({ pageSize: '100' });
      expect(all.map((m) => m.id)).toEqual(expect.arrayContaining([inside.id, outside.id]));
      await call('get', teacher, '/materials').query({ moduleId: 'nope' }).expect(400);
      await call('get', teacher, '/materials').query({ moduleId: 'UNASSIGNED' }).expect(400);
      await call('get', teacher, '/materials').query({ moduleId: randomUUID() }).expect(404);
      await call('get', teacher, '/materials').query({ moduleId: foreign.id }).expect(404);
    });

    it('keeps removed materials out of module counts', async () => {
      const mod = await createModule('Count');
      const material = await createMaterial(mod.id);
      await call('delete', teacher, `/materials/${material.id}`).expect(204);
      expect((await listModules()).find((m) => m.id === mod.id)?.materialCount).toBe(0);
    });
  });

  describe('delete behavior: materials return to unassigned', () => {
    it('soft-removes the module, unassigns its materials and keeps them downloadable', async () => {
      const mod = await createModule('Doomed');
      const material = await createMaterial(mod.id);
      await call('delete', teacher, `/material-modules/${mod.id}`).expect(204);
      expect((await listModules()).some((m) => m.id === mod.id)).toBe(false);
      const unassigned = await listMaterials({ moduleId: 'unassigned', pageSize: '100' });
      expect(unassigned.find((m) => m.id === material.id)?.moduleId).toBeNull();
      await call('get', student, `/materials/${material.id}/download`).expect(200);
      const row = await prisma.materialModule.findUniqueOrThrow({ where: { id: mod.id } });
      expect(row.removedAt).toBeInstanceOf(Date);
      expect(row.removedById).toBe(teacher);
      await call('delete', teacher, `/material-modules/${mod.id}`).expect(404);
      await call('patch', teacher, `/material-modules/${mod.id}`).send({ name: 'x' }).expect(404);
      await call('patch', teacher, `/materials/${material.id}`)
        .send({ moduleId: mod.id })
        .expect(404);
      await call('get', teacher, '/materials').query({ moduleId: mod.id }).expect(404);
    });

    it('does not touch chunks or allowed-material state', async () => {
      const mod = await createModule('Bot safe');
      const material = await createMaterial(mod.id);
      const botConfig = await prisma.botConfig.upsert({
        where: { classroomId: classroom },
        create: { classroomId: classroom },
        update: {},
      });
      await prisma.allowedMaterial.create({
        data: {
          botConfigId: botConfig.id,
          classroomId: classroom,
          materialId: material.id,
          indexState: MaterialIndexState.INDEXED,
        },
      });
      const zeroVector = `[${Array.from({ length: 768 }, () => 0).join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO "material_chunks" (
          "id",
          "classroom_id",
          "material_id",
          "chunk_index",
          "content",
          "position",
          "embedding"
        ) VALUES (
          ${randomUUID()}::uuid,
          ${classroom}::uuid,
          ${material.id}::uuid,
          0,
          'Lesson excerpt preserved across module deletion',
          'p. 1',
          ${zeroVector}::vector
        )`;
      const countChunks = async () => {
        const [row] = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS "count"
          FROM "material_chunks"
          WHERE "classroom_id" = ${classroom}::uuid AND "material_id" = ${material.id}::uuid`;
        return Number(row?.count ?? 0n);
      };
      expect(await prisma.allowedMaterial.count({ where: { materialId: material.id } })).toBe(1);
      expect(await countChunks()).toBe(1);

      await call('delete', teacher, `/material-modules/${mod.id}`).expect(204);

      const allowedAfter = await prisma.allowedMaterial.findMany({
        where: { materialId: material.id },
      });
      expect(allowedAfter).toHaveLength(1);
      expect(allowedAfter[0]?.indexState).toBe(MaterialIndexState.INDEXED);
      expect(await countChunks()).toBe(1);
      const materialAfter = await prisma.studyMaterial.findUniqueOrThrow({
        where: { id: material.id },
      });
      expect(materialAfter.removedAt).toBeNull();
      expect(materialAfter.moduleId).toBeNull();
    });
  });

  describe('cross-classroom isolation', () => {
    it('never mixes a module and a material from different classrooms', async () => {
      const foreignModule = await createModule('Foreign target', otherTeacher, foreignClassroom);
      const foreignMaterial = await createMaterial(undefined, otherTeacher, foreignClassroom);
      const localModule = await createModule('Local target');
      const localMaterial = await createMaterial();
      await call('patch', teacher, `/materials/${localMaterial.id}`)
        .send({ moduleId: foreignModule.id })
        .expect(404);
      await call('patch', teacher, `/materials/${foreignMaterial.id}`)
        .send({ moduleId: localModule.id })
        .expect(404);
      await call('patch', otherTeacher, `/materials/${foreignMaterial.id}`, foreignClassroom)
        .send({ moduleId: localModule.id })
        .expect(404);
      await call('patch', teacher, `/material-modules/${foreignModule.id}`)
        .send({ name: 'x' })
        .expect(404);
      await call('delete', teacher, `/material-modules/${foreignModule.id}`).expect(404);
      expect((await listModules()).map((m) => m.id)).not.toContain(foreignModule.id);
      expect(
        (await prisma.studyMaterial.findUniqueOrThrow({ where: { id: localMaterial.id } }))
          .moduleId,
      ).toBeNull();
      const order = [...(await listModules()).map((m) => m.id), foreignModule.id];
      await call('put', teacher, '/material-modules/order').send({ moduleIds: order }).expect(400);
    });
  });

  describe('concurrency and transaction serialization', () => {
    const createIsolatedClassroom = async (name: string) => {
      const id = randomUUID();
      await prisma.classroom.create({ data: { id, name, independentTeacherId: teacher } });
      return id;
    };

    it('serializes concurrent POST /material-modules with contiguous positions and enforces the 100-module cap', async () => {
      const batchClassroom = await createIsolatedClassroom('Concurrent creates');
      const batchResponses = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          call('post', teacher, '/material-modules', batchClassroom).send({
            name: `Concurrent ${index}`,
          }),
        ),
      );
      expect(batchResponses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const createdPositions = batchResponses
        .map((r) => (r.body as ModuleBody).position)
        .sort((a, b) => a - b);
      expect(createdPositions).toEqual([0, 1, 2, 3, 4]);

      const capClassroom = await createIsolatedClassroom('Module cap race');
      await prisma.materialModule.createMany({
        data: Array.from({ length: MATERIAL_MODULE_LIMITS.maxModules - 1 }, (_, position) => ({
          id: randomUUID(),
          classroomId: capClassroom,
          name: `Seed ${position}`,
          position,
        })),
      });
      const capResponses = await Promise.all([
        call('post', teacher, '/material-modules', capClassroom).send({ name: 'Cap A' }),
        call('post', teacher, '/material-modules', capClassroom).send({ name: 'Cap B' }),
      ]);
      expect(capResponses.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
      const activeModules = await listModules(teacher, capClassroom);
      expect(activeModules).toHaveLength(MATERIAL_MODULE_LIMITS.maxModules);
      const reversedIds = [...activeModules].reverse().map((m) => m.id);
      const reordered = await call('put', teacher, '/material-modules/order', capClassroom)
        .send({ moduleIds: reversedIds })
        .expect(200);
      expect(reordered.body.items.map((m: ModuleBody) => m.id)).toEqual(reversedIds);
    });

    it('resolves concurrent DELETE /material-modules/:moduleId with [204, 404]', async () => {
      const delClassroom = await createIsolatedClassroom('Concurrent deletes');
      const mod = await createModule('Delete once', teacher, delClassroom);
      const responses = await Promise.all([
        call('delete', teacher, `/material-modules/${mod.id}`, delClassroom),
        call('delete', teacher, `/material-modules/${mod.id}`, delClassroom),
      ]);
      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 404]);
    });

    it('never leaves an active material pointing to a deleted module when DELETE races upload and move', async () => {
      const raceClassroom = await createIsolatedClassroom('Delete vs upload and move');
      for (let round = 0; round < 5; round++) {
        const mod = await createModule(`Race target ${round}`, teacher, raceClassroom);
        const loose = await createMaterial(undefined, teacher, raceClassroom);
        const [delRes, uploadRes, moveRes] = await Promise.all([
          call('delete', teacher, `/material-modules/${mod.id}`, raceClassroom),
          upload(teacher, raceClassroom, mod.id),
          call('patch', teacher, `/materials/${loose.id}`, raceClassroom).send({
            moduleId: mod.id,
          }),
        ]);
        expect(delRes.status).toBe(204);
        expect([201, 404]).toContain(uploadRes.status);
        expect([200, 404]).toContain(moveRes.status);
        const stranded = await prisma.studyMaterial.count({
          where: { classroomId: raceClassroom, moduleId: mod.id, removedAt: null },
        });
        expect(stranded).toBe(0);
      }
    });

    it('serializes concurrent PUT /material-modules/order and POST /material-modules without 500s', async () => {
      const orderClassroom = await createIsolatedClassroom('Reorder vs create');
      const m1 = await createModule('Order 1', teacher, orderClassroom);
      const m2 = await createModule('Order 2', teacher, orderClassroom);
      const m3 = await createModule('Order 3', teacher, orderClassroom);
      const [reorderRes, createRes] = await Promise.all([
        call('put', teacher, '/material-modules/order', orderClassroom).send({
          moduleIds: [m3.id, m2.id, m1.id],
        }),
        call('post', teacher, '/material-modules', orderClassroom).send({ name: 'Order 4' }),
      ]);
      expect(createRes.status).toBe(201);
      expect([200, 400]).toContain(reorderRes.status);
      const finalModules = await listModules(teacher, orderClassroom);
      expect(finalModules).toHaveLength(4);
      const positions = finalModules.map((m) => m.position);
      expect(new Set(positions).size).toBe(4);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
  });
});
