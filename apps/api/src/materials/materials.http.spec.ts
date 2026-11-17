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
import { STORAGE_PORT, type StoragePort } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';

const MAX_BYTES = 10 * 1024 * 1024;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const databaseUrl = loadIsolatedTestDatabaseUrl();

// Public HTTP + real isolated PostgreSQL + controlled storage boundary. No real sessions,
// environment-file loader, AWS credentials, storage network, or shared fixture cleanup.
describe('study materials HTTP — S1–S5 private classroom material', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let failCreateBeforePersistence = false;
  let loseCreateAcknowledgement = false;
  const [teacher, student, parent, otherTeacher, owner, admin, schoolTeacher] = Array.from(
    { length: 7 },
    () => randomUUID(),
  );
  const [classroom, foreignClassroom, schoolClassroom, school] = Array.from({ length: 4 }, () =>
    randomUUID(),
  );
  const users: string[] = [teacher, student, parent, otherTeacher, owner, admin, schoolTeacher];
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const storage: StoragePort = {
    put: vi.fn(async (key, body, options) => {
      objects.set(key, { body: Uint8Array.from(body), contentType: options.contentType });
    }),
    get: vi.fn(async (key) => {
      const object = objects.get(key);
      if (!object) throw new Error('Synthetic missing object');
      return object;
    }),
    delete: vi.fn(async () => undefined),
    getSignedDownloadUrl: vi.fn(
      async () => 'https://storage.example.invalid/synthetic-signed-download',
    ),
  };
  const api = (
    method: 'get' | 'post' | 'delete',
    actor: string,
    scope: string = classroom,
    suffix: string = '',
  ) => {
    const http = request(app.getHttpServer());
    return http[method](`/classrooms/${scope}/materials${suffix}`).set(
      'Authorization',
      `Bearer materials-test:${actor}`,
    );
  };
  const upload = (
    actor: string = teacher,
    scope: string = classroom,
    bytes = pdf,
    name = 'lesson.pdf',
    contentType = 'application/pdf',
  ) => api('post', actor, scope).attach('file', bytes, { filename: name, contentType });
  const list = async (actor: string = teacher, scope: string = classroom) =>
    (await api('get', actor, scope).expect(200)).body;
  const create = async (actor: string = teacher, scope: string = classroom) =>
    (await upload(actor, scope).expect(201)).body as { id: string };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (!header?.startsWith('Bearer materials-test:')) throw new UnauthorizedException();
          const userId = header.slice('Bearer materials-test:'.length);
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
    // Faults live in middleware, not spies on Prisma's lazily bound delegate methods.
    // The pre-query fault prevents insertion; the post-query fault loses only the
    // acknowledgement after the ordinary nontransactional insert has committed.
    prisma.$use(async (params, next) => {
      const materialCreate = params.model === 'StudyMaterial' && params.action === 'create';
      if (materialCreate && failCreateBeforePersistence) {
        failCreateBeforePersistence = false;
        throw new Error('Synthetic persistence diagnostic');
      }
      const result = await next(params);
      if (materialCreate && loseCreateAcknowledgement) {
        loseCreateAcknowledgement = false;
        throw new Error('Synthetic commit acknowledgement lost');
      }
      return result;
    });
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: 'Synthetic material participant',
          email: `material-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.school.create({
        data: { id: school, name: 'Synthetic school', slug: `material-${school}` },
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId: school, userId: owner, role: SchoolRole.OWNER },
          { schoolId: school, userId: admin, role: SchoolRole.ADMIN },
          { schoolId: school, userId: schoolTeacher, role: SchoolRole.TEACHER },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: classroom, name: 'Materials', independentTeacherId: teacher },
          { id: foreignClassroom, name: 'Foreign materials', independentTeacherId: otherTeacher },
          { id: schoolClassroom, name: 'School materials', schoolId: school },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroom, userId: student, role: ClassroomRole.STUDENT },
          { classroomId: schoolClassroom, userId: schoolTeacher, role: ClassroomRole.TEACHER },
        ],
      });
      await tx.parentLink.create({
        data: { classroomId: classroom, parentId: parent, childId: student },
      });
    });
  }, 30_000);
  afterAll(async () => {
    await app?.close();
  });

  it('stores validated bytes and exposes only safe metadata and a signed member download', async () => {
    const before = objects.size;
    const response = await upload().expect(201);
    expect(response.body).toMatchObject({
      id: expect.any(String),
      classroomId: classroom,
      authorId: teacher,
      filename: 'lesson.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      createdAt: expect.any(String),
    });
    expect(response.body).not.toHaveProperty('objectKey');
    expect(objects.size).toBe(before + 1);
    const key = [...objects.keys()].at(-1)!;
    expect(key).toBe(`materials/${classroom}/${response.body.id}`);
    expect(Buffer.from(objects.get(key)!.body)).toEqual(pdf);
    expect((await list(student)).items).toContainEqual(response.body);
    const download = await api('get', student, classroom, `/${response.body.id}/download`).expect(
      200,
    );
    expect(download.body).toEqual({
      url: 'https://storage.example.invalid/synthetic-signed-download',
      expiresInSeconds: 300,
    });
  });

  it.each([owner, admin, schoolTeacher])(
    'allows school staff %s without extra parent authority',
    async (actor) => {
      const material = await create(actor, schoolClassroom);
      await api('get', actor, schoolClassroom, `/${material.id}/download`).expect(200);
      await api('delete', actor, schoolClassroom, `/${material.id}`).expect(204);
    },
  );

  it('rejects student upload with 403 and leaves the public list and storage unchanged', async () => {
    const before = await api('get', teacher);
    const count = objects.size;
    await upload(student).expect(403);
    expect(await list()).toEqual(before.body);
    expect(objects.size).toBe(count);
  });

  it('rejects a foreign teacher upload with 404 and leaves the public list unchanged', async () => {
    const before = await api('get', teacher);
    const count = objects.size;
    await upload(otherTeacher).expect(404);
    expect(await list()).toEqual(before.body);
    expect(objects.size).toBe(count);
  });

  it.each([false, true])(
    'keeps students in scope and grants no parent material access (adultMode=%s)',
    async (adultMode) => {
      await prisma.classroom.update({ where: { id: classroom }, data: { adultMode } });
      try {
        const material = await create();
        await api('get', student).expect(200);
        await api('get', student, classroom, `/${material.id}/download`).expect(200);
        await api('get', parent).expect(adultMode ? 404 : 403);
        await api('get', parent, classroom, `/${material.id}/download`).expect(
          adultMode ? 404 : 403,
        );
        await api('get', parent, classroom, `/${randomUUID()}/download`).expect(
          adultMode ? 404 : 403,
        );
        const before = await list();
        const count = objects.size;
        await upload(parent).expect(adultMode ? 404 : 403);
        await api('delete', parent, classroom, `/${material.id}`).expect(adultMode ? 404 : 403);
        await api('delete', parent, classroom, `/${randomUUID()}`).expect(adultMode ? 404 : 403);
        expect(await list()).toEqual(before);
        expect(objects.size).toBe(count);
      } finally {
        await prisma.classroom.update({ where: { id: classroom }, data: { adultMode: false } });
      }
    },
  );

  it('applies the #26 resource boundary to direct and object-origin download IDs', async () => {
    const local = await create();
    const foreign = await create(otherTeacher, foreignClassroom);
    await assertResourceAuthorization({
      request: (materialId, interaction) => {
        const call = api('get', student, classroom, `/${materialId}/download`);
        return interaction ? call.query(interaction) : call;
      },
      allowedResourceId: local.id,
      foreignResourceId: foreign.id,
      interaction: { classroomId: classroom, studentId: student, objectId: 'material-shelf' },
      deniedStatus: 404,
      assertAllowed: (response) => {
        expect(response.body).toHaveProperty('url');
      },
      assertDenied: (response) => {
        expect(response.body).not.toHaveProperty('url');
      },
    });
    await api('delete', teacher, classroom, `/${foreign.id}`).expect(404);
    await api('delete', student, classroom, `/${foreign.id}`).expect(404);
    await api('get', otherTeacher, foreignClassroom, `/${foreign.id}/download`).expect(200);
  });

  it.each([
    ['empty', Buffer.alloc(0), 'lesson.pdf', 'application/pdf'],
    ['spoofed PDF', Buffer.from('<script>synthetic</script>'), 'lesson.pdf', 'application/pdf'],
    ['MIME mismatch', pdf, 'lesson.png', 'image/png'],
    ['unsupported bytes', Buffer.from('synthetic plain text'), 'lesson.txt', 'text/plain'],
    ['unsafe filename', pdf, 'bad<script>.pdf', 'application/pdf'],
    ['dotless filename', pdf, 'pdf', 'application/pdf'],
  ] as const)('rejects %s without public-list or object changes', async (_, bytes, name, mime) => {
    const before = await api('get', teacher);
    const count = objects.size;
    const response = await upload(teacher, classroom, bytes, name, mime).expect(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.objectContaining({ field: 'file' })],
    });
    expect(await list()).toEqual(before.body);
    expect(objects.size).toBe(count);
  });

  it('accepts PNG bytes, not merely PDF declarations', async () => {
    const response = await upload(teacher, classroom, png, 'diagram.png', 'image/png').expect(201);
    expect(response.body).toMatchObject({
      filename: 'diagram.png',
      contentType: 'image/png',
      sizeBytes: png.length,
    });
  });

  it('accepts exactly 10 MiB and rejects 10 MiB + 1 before storage', async () => {
    const exact = Buffer.alloc(MAX_BYTES, 32);
    pdf.copy(exact);
    await upload(teacher, classroom, exact).expect(201);
    const before = await list();
    const count = objects.size;
    const oversized = Buffer.concat([exact, Buffer.from('x')]);
    await upload(teacher, classroom, oversized).expect(413);
    expect(await list()).toEqual(before);
    expect(objects.size).toBe(count);
  });

  it.each(['missing', 'duplicate', 'unexpected field'])(
    'rejects %s multipart file count before storage',
    async (kind) => {
      const before = await api('get', teacher);
      const count = objects.size;
      let call = api('post', teacher);
      if (kind === 'missing') call = call.field('title', 'No file');
      else {
        call = call.attach('file', pdf, { filename: 'lesson.pdf', contentType: 'application/pdf' });
        call = call.attach(kind === 'duplicate' ? 'file' : 'extra', pdf, {
          filename: 'extra.pdf',
          contentType: 'application/pdf',
        });
      }
      await call.expect(400);
      expect(await list()).toEqual(before.body);
      expect(objects.size).toBe(count);
    },
  );

  it('logical removal blocks fresh downloads and preserves the stored object', async () => {
    const material = await create();
    const before = await list();
    await api('delete', student, classroom, `/${material.id}`).expect(403);
    expect(await list()).toEqual(before);
    await api('delete', otherTeacher, classroom, `/${material.id}`).expect(404);
    expect(await list()).toEqual(before);
    const count = objects.size;
    await api('delete', teacher, classroom, `/${material.id}`).expect(204);
    await api('delete', teacher, classroom, `/${material.id}`).expect(404);
    expect(
      (await list(student)).items.some((item: { id: string }) => item.id === material.id),
    ).toBe(false);
    await api('get', student, classroom, `/${material.id}/download`).expect(404);
    expect(objects.size).toBe(count);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('handles concurrent uploads, listings, and competing removals safely', async () => {
    const [upA, upB, listed] = await Promise.all([
      upload(teacher, classroom, pdf, 'concurrent-a.pdf', 'application/pdf'),
      upload(teacher, classroom, png, 'concurrent-b.png', 'image/png'),
      api('get', student),
    ]);
    expect(upA.status).toBe(201);
    expect(upB.status).toBe(201);
    expect(upA.body.id).not.toBe(upB.body.id);
    expect(listed.status).toBe(200);

    const [del1, del2] = await Promise.all([
      api('delete', teacher, classroom, `/${upA.body.id}`),
      api('delete', teacher, classroom, `/${upA.body.id}`),
    ]);
    expect([del1.status, del2.status].sort((a, b) => a - b)).toEqual([204, 404]);
  });

  it.each(['jpg', 'jpeg'])('accepts JPEG signature with the .%s extension', async (extension) => {
    // Synthetic signature fixture, not a claim that full image decoding is performed.
    const bytes = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
    const response = await upload(
      teacher,
      classroom,
      bytes,
      `photo.${extension}`,
      'image/jpeg',
    ).expect(201);
    expect(response.body).toMatchObject({ contentType: 'image/jpeg', sizeBytes: bytes.length });
  });

  it('rejects a correct signature with a misleading extension or overlong filename', async () => {
    const before = await api('get', teacher);
    const count = objects.size;
    await upload(teacher, classroom, pdf, 'lesson.png').expect(400);
    await upload(teacher, classroom, pdf, `${'a'.repeat(117)}.pdf`).expect(400);
    expect(await list()).toEqual(before.body);
    expect(objects.size).toBe(count);
  });

  it('paginates active materials deterministically and bounds list parameters', async () => {
    await create();
    await create();
    const first = await api('get', student).query({ pageSize: 1, sort: 'createdAt' }).expect(200);
    const second = await api('get', student)
      .query({ pageSize: 1, page: 2, sort: 'createdAt' })
      .expect(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 1, total: expect.any(Number) });
    expect(first.body.items).toHaveLength(1);
    expect(second.body.items).toHaveLength(1);
    expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
    const ordered = await api('get', student)
      .query({ pageSize: 100, sort: 'createdAt' })
      .expect(200);
    expect(ordered.body.items.slice(0, 2).map((item: { id: string }) => item.id)).toEqual([
      first.body.items[0].id,
      second.body.items[0].id,
    ]);
    await api('get', student).query({ pageSize: 101 }).expect(400);
    await api('get', student).query({ page: 0 }).expect(400);
    await api('get', student).query({ sort: 'objectKey' }).expect(400);
  });

  it('rechecks current membership before listing and signing downloads', async () => {
    const material = await create();
    await api('get', student, classroom, `/${material.id}/download`).expect(200);
    const signedCalls = vi.mocked(storage.getSignedDownloadUrl).mock.calls.length;
    await prisma.classroomMembership.updateMany({
      where: { classroomId: classroom, userId: student },
      data: { state: 'INACTIVE' },
    });
    try {
      await api('get', student).expect(404);
      await api('get', student, classroom, `/${material.id}/download`).expect(404);
      expect(vi.mocked(storage.getSignedDownloadUrl).mock.calls).toHaveLength(signedCalls);
    } finally {
      await prisma.classroomMembership.updateMany({
        where: { classroomId: classroom, userId: student },
        data: { state: 'ACTIVE' },
      });
    }
  });

  it('returns a safe storage failure without publishing a material', async () => {
    const before = await api('get', teacher);
    const count = objects.size;
    vi.mocked(storage.put).mockRejectedValueOnce(new Error('Synthetic private storage diagnostic'));
    const response = await upload().expect(503);
    expect(JSON.stringify(response.body)).not.toContain('Synthetic private storage diagnostic');
    expect(await list()).toEqual(before.body);
    expect(objects.size).toBe(count);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('preserves a possible private orphan on failed database persistence', async () => {
    const before = await api('get', teacher);
    const count = objects.size;
    failCreateBeforePersistence = true;
    try {
      const response = await upload().expect(503);
      expect(failCreateBeforePersistence).toBe(false);
      expect(JSON.stringify(response.body)).not.toContain('Synthetic persistence diagnostic');
      expect(await list()).toEqual(before.body);
      expect(objects.size).toBe(count + 1);
      expect(storage.delete).not.toHaveBeenCalled();
    } finally {
      failCreateBeforePersistence = false;
    }
  });

  it('never deletes the stored object when persistence commits but acknowledgement fails', async () => {
    const before = await list();
    const count = objects.size;
    loseCreateAcknowledgement = true;
    try {
      await upload().expect(503);
      expect(loseCreateAcknowledgement).toBe(false);
      const after = await list();
      expect(after.total).toBe(before.total + 1);
      const material = after.items.find(
        (item: { id: string }) => !before.items.some((old: { id: string }) => old.id === item.id),
      );
      expect(material).toBeDefined();
      await api('get', student, classroom, `/${material.id}/download`).expect(200);
      expect(objects.size).toBe(count + 1);
      expect(storage.delete).not.toHaveBeenCalled();
    } finally {
      loseCreateAcknowledgement = false;
    }
  });

  it('does not leak signing diagnostics or cache a signed URL', async () => {
    const material = await create();
    vi.mocked(storage.getSignedDownloadUrl).mockRejectedValueOnce(
      new Error('Synthetic signing diagnostic'),
    );
    const response = await api('get', student, classroom, `/${material.id}/download`).expect(503);
    expect(JSON.stringify(response.body)).not.toContain('Synthetic signing diagnostic');
    const signed = await api('get', student, classroom, `/${material.id}/download`).expect(200);
    expect(signed.headers['cache-control']).toBe('no-store');
    expect(storage.getSignedDownloadUrl).toHaveBeenLastCalledWith(
      `materials/${classroom}/${material.id}`,
      { expiresInSeconds: 300 },
    );
  });

  it.each([owner, admin, schoolTeacher])(
    'keeps school staff %s out of independent classrooms',
    async (actor) => {
      const before = await api('get', teacher);
      const count = objects.size;
      await api('get', actor).expect(404);
      await upload(actor).expect(404);
      expect(await list()).toEqual(before.body);
      expect(objects.size).toBe(count);
    },
  );

  it('returns 404 for malformed resource and classroom identifiers', async () => {
    const material = await create();
    await api('get', student, classroom, '/not-a-uuid/download').expect(404);
    await api('get', student, 'not-a-uuid', `/${material.id}/download`).expect(404);
    await api('delete', teacher, 'not-a-uuid', `/${material.id}`).expect(404);
    await api('get', student, 'not-a-uuid').expect(404);
  });

  it('rejects missing authentication on each public operation', async () => {
    const base = `/classrooms/${classroom}/materials`;
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer()).post(base).attach('file', pdf, 'lesson.pdf').expect(401);
    await request(app.getHttpServer()).get(`${base}/${randomUUID()}/download`).expect(401);
    await request(app.getHttpServer()).delete(`${base}/${randomUUID()}`).expect(401);
  });
});
