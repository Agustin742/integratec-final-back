import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ClassroomRole,
  MembershipState,
  PrismaClient,
  RegistrationPath,
  SchoolRole,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../auth/auth.module';
import { SessionVerifier, type VerifiedSession } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_INITIAL_DESK_COUNT,
  DEFAULT_PET_NAME,
  DEFAULT_PET_SPECIES,
} from './classrooms.constants';
import { ClassroomsModule } from './classrooms.module';
import { ClassroomsService } from './classrooms.service';

describe('Classrooms PostgreSQL Integration Tests (HU-AUL-001)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const createdUserIds: string[] = [];
  const createdSchoolIds: string[] = [];
  const createdClassroomIds: string[] = [];

  let schoolA: { id: string };
  let schoolB: { id: string };

  let independentTeacher: { id: string };
  let schoolOwner: { id: string };
  let schoolAdmin: { id: string };
  let schoolTeacher1: { id: string };
  let schoolTeacher2: { id: string };
  let otherSchoolOwner: { id: string };
  let studentUser: { id: string };
  let parentUser: { id: string };
  let strangerUser: { id: string };

  const tokenForUser = (userId: string) => `Bearer test-user:${userId}`;

  beforeAll(async () => {
    const globalProcess = (
      globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    const dbUrl =
      globalProcess?.env?.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public';

    prisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });
    await prisma.$connect();

    const config = {
      ...authTestConfig(),
      databaseUrl: dbUrl,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), PrismaModule, AuthModule, ClassroomsModule],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: vi.fn(async (header?: string): Promise<VerifiedSession> => {
          if (header?.startsWith('Bearer test-user:')) {
            const userId = header.replace('Bearer test-user:', '').trim();
            return {
              userId,
              sessionId: '00000000-0000-4000-8000-000000000001',
            };
          }
          throw new UnauthorizedException();
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    const appPrisma = app.get(PrismaService);
    await appPrisma.$connect();
    // Open several pooled connections up front: establishing them is slow on some hosts and
    // the concurrent-creation test would otherwise spend its transaction wait budget on it.
    await Promise.all(Array.from({ length: 6 }, () => appPrisma.$queryRaw`SELECT 1`));

    const ts = Date.now();

    const createUser = async (prefix: string, path: RegistrationPath) => {
      const user = await prisma.user.create({
        data: {
          email: `cls.${prefix}.${ts}@example.edu.ar`,
          passwordHash: 'dummy-hash-for-integration-tests',
          displayName: `${prefix} User`,
          registrationPath: path,
        },
      });
      createdUserIds.push(user.id);
      return user;
    };

    independentTeacher = await createUser('ind.teacher', RegistrationPath.INDEPENDENT_TEACHER);
    schoolOwner = await createUser('school.owner', RegistrationPath.SCHOOL);
    schoolAdmin = await createUser('school.admin', RegistrationPath.SCHOOL);
    schoolTeacher1 = await createUser('school.t1', RegistrationPath.SCHOOL);
    schoolTeacher2 = await createUser('school.t2', RegistrationPath.SCHOOL);
    otherSchoolOwner = await createUser('other.owner', RegistrationPath.SCHOOL);
    studentUser = await createUser('student', RegistrationPath.SCHOOL);
    parentUser = await createUser('parent', RegistrationPath.SCHOOL);
    strangerUser = await createUser('stranger', RegistrationPath.INDEPENDENT_TEACHER);

    schoolA = await prisma.school.create({
      data: {
        name: `Colegio A ${ts}`,
        slug: `colegio-a-${ts}`,
        timeZone: 'America/Argentina/Buenos_Aires',
      },
    });
    createdSchoolIds.push(schoolA.id);

    schoolB = await prisma.school.create({
      data: {
        name: `Colegio B ${ts}`,
        slug: `colegio-b-${ts}`,
        timeZone: 'America/Argentina/Buenos_Aires',
      },
    });
    createdSchoolIds.push(schoolB.id);

    await prisma.schoolMember.createMany({
      data: [
        {
          schoolId: schoolA.id,
          userId: schoolOwner.id,
          role: SchoolRole.OWNER,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: schoolA.id,
          userId: schoolAdmin.id,
          role: SchoolRole.ADMIN,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: schoolA.id,
          userId: schoolTeacher1.id,
          role: SchoolRole.TEACHER,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: schoolA.id,
          userId: schoolTeacher2.id,
          role: SchoolRole.TEACHER,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: schoolB.id,
          userId: otherSchoolOwner.id,
          role: SchoolRole.OWNER,
          state: MembershipState.ACTIVE,
        },
      ],
    });
  }, 20000);

  afterAll(async () => {
    if (prisma) {
      if (createdClassroomIds.length > 0) {
        await prisma.parentLink.deleteMany({
          where: { classroomId: { in: createdClassroomIds } },
        });
        await prisma.desk.deleteMany({
          where: { classroomId: { in: createdClassroomIds } },
        });
        await prisma.classroomPet.deleteMany({
          where: { classroomId: { in: createdClassroomIds } },
        });
        await prisma.classroomMembership.deleteMany({
          where: { classroomId: { in: createdClassroomIds } },
        });
        await prisma.classroom.deleteMany({
          where: { id: { in: createdClassroomIds } },
        });
      }

      if (createdSchoolIds.length > 0) {
        await prisma.schoolMember.deleteMany({
          where: { schoolId: { in: createdSchoolIds } },
        });
        await prisma.school.deleteMany({
          where: { id: { in: createdSchoolIds } },
        });
      }

      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }

      await prisma.$disconnect();
    }
    await app?.close();
  }, 20000);

  describe('POST /classrooms — Creation & Atomic Provisioning', () => {
    it('creates an independent teacher classroom atomically with default pet, 12 desks (1..12), and default control flags', async () => {
      const res = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(independentTeacher.id))
        .send({
          name: '  Taller de Programación  ',
          subject: '  Algoritmos y Estructuras de Datos  ',
        })
        .expect(201);

      createdClassroomIds.push(res.body.id);

      expect(res.body).toMatchObject({
        name: 'Taller de Programación',
        subject: 'Algoritmos y Estructuras de Datos',
        schoolId: null,
        independentTeacherId: independentTeacher.id,
        adultMode: false,
        chatMuted: false,
        collaborationLocked: false,
        gamesDisabled: false,
        deskCount: DEFAULT_INITIAL_DESK_COUNT,
        pet: {
          name: DEFAULT_PET_NAME,
          species: DEFAULT_PET_SPECIES,
          level: 1,
          experience: 0,
        },
        myRole: 'TEACHER',
      });
      expect(res.body.capabilities).toContain('configure_classroom');
      expect(res.body.capabilities).not.toContain('manage_school');

      // Verify persisted rows in PostgreSQL
      const dbDesks = await prisma.desk.findMany({
        where: { classroomId: res.body.id },
        orderBy: { deskIndex: 'asc' },
      });
      expect(dbDesks).toHaveLength(DEFAULT_INITIAL_DESK_COUNT);
      expect(dbDesks.map((d) => d.deskIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(dbDesks.every((d) => d.membershipId === null)).toBe(true);

      const dbPet = await prisma.classroomPet.findUnique({
        where: { classroomId: res.body.id },
      });
      expect(dbPet).not.toBeNull();
      expect(dbPet?.name).toBe(DEFAULT_PET_NAME);
      expect(dbPet?.species).toBe(DEFAULT_PET_SPECIES);
    });

    it('creates a school classroom for School Owner and Admin without creating ClassroomMembership rows', async () => {
      const ownerRes = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(schoolOwner.id))
        .send({
          name: '1° Año A - Ciencias Naturales',
          subject: 'Biología',
        })
        .expect(201);

      createdClassroomIds.push(ownerRes.body.id);

      expect(ownerRes.body.schoolId).toBe(schoolA.id);
      expect(ownerRes.body.independentTeacherId).toBeNull();
      expect(ownerRes.body.myRole).toBe('OWNER');
      expect(ownerRes.body.capabilities).toContain('manage_school');
      expect(ownerRes.body.capabilities).toContain('configure_classroom');

      const ownerMemberships = await prisma.classroomMembership.findMany({
        where: { classroomId: ownerRes.body.id, userId: schoolOwner.id },
      });
      expect(ownerMemberships).toHaveLength(0);

      const adminRes = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(schoolAdmin.id))
        .send({
          name: '1° Año B - Lengua',
          schoolId: schoolA.id,
        })
        .expect(201);

      createdClassroomIds.push(adminRes.body.id);

      expect(adminRes.body.schoolId).toBe(schoolA.id);
      expect(adminRes.body.independentTeacherId).toBeNull();
      expect(adminRes.body.myRole).toBe('ADMIN');
      expect(adminRes.body.capabilities).not.toContain('manage_school');
      expect(adminRes.body.capabilities).toContain('configure_classroom');

      const adminMemberships = await prisma.classroomMembership.findMany({
        where: { classroomId: adminRes.body.id, userId: schoolAdmin.id },
      });
      expect(adminMemberships).toHaveLength(0);
    });

    it('creates a school classroom for School Teacher and records active TEACHER ClassroomMembership', async () => {
      const teacherRes = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(schoolTeacher1.id))
        .send({
          name: '4° Año A - Matemática',
          subject: 'Análisis Matemático',
        })
        .expect(201);

      createdClassroomIds.push(teacherRes.body.id);

      expect(teacherRes.body.schoolId).toBe(schoolA.id);
      expect(teacherRes.body.independentTeacherId).toBeNull();
      expect(teacherRes.body.myRole).toBe('TEACHER');

      const memberships = await prisma.classroomMembership.findMany({
        where: { classroomId: teacherRes.body.id, userId: schoolTeacher1.id },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe(ClassroomRole.TEACHER);
      expect(memberships[0].state).toBe(MembershipState.ACTIVE);
    });

    it('enforces transactional atomicity: rolls back Classroom and Pet if desk creation fails', async () => {
      const classroomsService = app.get(ClassroomsService);
      const prismaService = app.get(PrismaService);
      const rollbackName = `Atomic Rollback Classroom ${Date.now()}`;

      const originalTx = prismaService.$transaction.bind(prismaService);
      const txSpy = vi
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (cb: unknown) => {
          return originalTx(async (tx) => {
            await (cb as (client: typeof tx) => Promise<unknown>)(tx);
            throw new Error('Simulated failure after desk provisioning');
          });
        });

      try {
        await expect(
          classroomsService.create(independentTeacher.id, {
            name: rollbackName,
          }),
        ).rejects.toThrow('Simulated failure after desk provisioning');
      } finally {
        txSpy.mockRestore();
      }

      const orphanClassroom = await prisma.classroom.findFirst({
        where: { name: rollbackName },
      });
      expect(orphanClassroom).toBeNull();
    });

    it('handles concurrent classroom creations cleanly via Promise.all without race failures', async () => {
      const [res1, res2, res3] = await Promise.all([
        request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', tokenForUser(independentTeacher.id))
          .send({ name: 'Concurrent Aula 1', subject: 'Química' }),
        request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', tokenForUser(independentTeacher.id))
          .send({ name: 'Concurrent Aula 2', subject: 'Física' }),
        request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', tokenForUser(schoolTeacher2.id))
          .send({ name: 'Concurrent Aula 3', subject: 'Geografía' }),
      ]);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res3.status).toBe(201);

      createdClassroomIds.push(res1.body.id, res2.body.id, res3.body.id);

      expect(new Set([res1.body.id, res2.body.id, res3.body.id]).size).toBe(3);
      expect(res1.body.deskCount).toBe(DEFAULT_INITIAL_DESK_COUNT);
      expect(res2.body.deskCount).toBe(DEFAULT_INITIAL_DESK_COUNT);
      expect(res3.body.deskCount).toBe(DEFAULT_INITIAL_DESK_COUNT);
    });
  });

  describe('Authorization, Role Isolation, Adult Mode & Listing', () => {
    let teacher1ClassroomId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(schoolTeacher1.id))
        .send({
          name: 'Aula Aislamiento T1',
          subject: 'Física Experimental',
          adultMode: false,
        })
        .expect(201);

      teacher1ClassroomId = created.body.id;
      createdClassroomIds.push(teacher1ClassroomId);

      // Enroll studentUser and link parentUser in teacher1ClassroomId
      await prisma.classroomMembership.create({
        data: {
          classroomId: teacher1ClassroomId,
          userId: studentUser.id,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
      });

      await prisma.parentLink.create({
        data: {
          classroomId: teacher1ClassroomId,
          parentId: parentUser.id,
          childId: studentUser.id,
          state: MembershipState.ACTIVE,
        },
      });
    });

    it('returns 404 NOT_FOUND on non-UUID :id for GET /classrooms/:id and PATCH /classrooms/:id', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/classrooms/not-a-valid-uuid')
        .set('Authorization', tokenForUser(schoolOwner.id))
        .expect(404);
      expect(getRes.body.error.code).toBe('NOT_FOUND');

      const patchRes = await request(app.getHttpServer())
        .patch('/classrooms/not-a-valid-uuid')
        .set('Authorization', tokenForUser(schoolOwner.id))
        .send({ name: 'Nuevo Nombre' })
        .expect(404);
      expect(patchRes.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 NOT_FOUND when another teacher in the same school or another school accesses or updates the classroom', async () => {
      await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(schoolTeacher2.id))
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(schoolTeacher2.id))
        .send({ chatMuted: true })
        .expect(404);

      await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(otherSchoolOwner.id))
        .expect(404);

      await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(strangerUser.id))
        .expect(404);
    });

    it('returns 403 FORBIDDEN when an enrolled Student or linked Parent attempts PATCH /classrooms/:id', async () => {
      const studentPatch = await request(app.getHttpServer())
        .patch(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(studentUser.id))
        .send({ gamesDisabled: true })
        .expect(403);
      expect(studentPatch.body.error.code).toBe('FORBIDDEN');

      const parentPatch = await request(app.getHttpServer())
        .patch(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(parentUser.id))
        .send({ chatMuted: true })
        .expect(403);
      expect(parentPatch.body.error.code).toBe('FORBIDDEN');
    });

    it('returns accurate myRole and capabilities on GET /classrooms/:id for Owner, Admin, Teacher, Student, and Parent', async () => {
      const ownerGet = await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(schoolOwner.id))
        .expect(200);
      expect(ownerGet.body.myRole).toBe('OWNER');
      expect(ownerGet.body.capabilities).toContain('manage_school');
      expect(ownerGet.body.capabilities).toContain('configure_classroom');

      const adminGet = await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(schoolAdmin.id))
        .expect(200);
      expect(adminGet.body.myRole).toBe('ADMIN');
      expect(adminGet.body.capabilities).toContain('configure_classroom');

      const teacherGet = await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(schoolTeacher1.id))
        .expect(200);
      expect(teacherGet.body.myRole).toBe('TEACHER');
      expect(teacherGet.body.capabilities).toContain('configure_classroom');

      const studentGet = await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(studentUser.id))
        .expect(200);
      expect(studentGet.body.myRole).toBe('STUDENT');
      expect(studentGet.body.capabilities).toContain('participate_activities');
      expect(studentGet.body.capabilities).not.toContain('configure_classroom');

      const parentGet = await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(parentUser.id))
        .expect(200);
      expect(parentGet.body.myRole).toBe('PARENT');
      expect(parentGet.body.capabilities).toEqual(['view_metrics', 'message_teacher']);
    });

    it('updates classroom settings via PATCH /classrooms/:id and preserves ParentLink rows in DB when toggling adultMode to true while denying parent access', async () => {
      const patchRes = await request(app.getHttpServer())
        .patch(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(schoolTeacher1.id))
        .send({
          name: 'Aula Aislamiento T1 (Adultos)',
          subject: 'Física Moderna',
          adultMode: true,
          chatMuted: true,
          collaborationLocked: true,
          gamesDisabled: true,
        })
        .expect(200);

      expect(patchRes.body).toMatchObject({
        id: teacher1ClassroomId,
        name: 'Aula Aislamiento T1 (Adultos)',
        subject: 'Física Moderna',
        adultMode: true,
        chatMuted: true,
        collaborationLocked: true,
        gamesDisabled: true,
      });

      // Verify ParentLink row is preserved in DB per rules/classrooms-and-roles.md
      const dbParentLinks = await prisma.parentLink.findMany({
        where: { classroomId: teacher1ClassroomId, parentId: parentUser.id },
      });
      expect(dbParentLinks).toHaveLength(1);
      expect(dbParentLinks[0].state).toBe(MembershipState.ACTIVE);

      // Verify parent is immediately denied access (404) on GET /classrooms/:id and excluded from GET /me/classrooms
      await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(parentUser.id))
        .expect(404);

      const parentList = await request(app.getHttpServer())
        .get('/me/classrooms')
        .set('Authorization', tokenForUser(parentUser.id))
        .expect(200);
      expect(parentList.body.items).toHaveLength(0);

      // Switch adultMode back to false and verify parent regains access
      await request(app.getHttpServer())
        .patch(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(schoolOwner.id))
        .send({ adultMode: false })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/classrooms/${teacher1ClassroomId}`)
        .set('Authorization', tokenForUser(parentUser.id))
        .expect(200);
    });

    it('lists only accessible classrooms on GET /me/classrooms and GET /classrooms with pagination and ordering', async () => {
      // Independent teacher has 3 classrooms created in this suite
      const page1Desc = await request(app.getHttpServer())
        .get('/me/classrooms?page=1&pageSize=2&sort=-createdAt')
        .set('Authorization', tokenForUser(independentTeacher.id))
        .expect(200);

      expect(page1Desc.body.page).toBe(1);
      expect(page1Desc.body.pageSize).toBe(2);
      expect(page1Desc.body.total).toBe(3);
      expect(page1Desc.body).not.toHaveProperty('totalPages');
      expect(page1Desc.body.items).toHaveLength(2);
      expect(page1Desc.body.items.every((c: { myRole: string }) => c.myRole === 'TEACHER')).toBe(
        true,
      );

      const page2Desc = await request(app.getHttpServer())
        .get('/classrooms?page=2&pageSize=2&sort=-createdAt')
        .set('Authorization', tokenForUser(independentTeacher.id))
        .expect(200);

      expect(page2Desc.body.items).toHaveLength(1);

      const allAsc = await request(app.getHttpServer())
        .get('/me/classrooms?page=1&pageSize=10&sort=createdAt')
        .set('Authorization', tokenForUser(independentTeacher.id))
        .expect(200);

      const combinedDesc = [...page1Desc.body.items, ...page2Desc.body.items] as {
        id: string;
        createdAt: string;
      }[];
      const expectedAscIds = [...combinedDesc]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((i) => i.id);

      expect(allAsc.body.items.map((i: { id: string }) => i.id)).toEqual(expectedAscIds);

      // Student sees only the 1 classroom they are enrolled in
      const studentList = await request(app.getHttpServer())
        .get('/me/classrooms')
        .set('Authorization', tokenForUser(studentUser.id))
        .expect(200);

      expect(studentList.body.total).toBe(1);
      expect(studentList.body.items[0].id).toBe(teacher1ClassroomId);
      expect(studentList.body.items[0].myRole).toBe('STUDENT');

      // School Owner sees all 5 classrooms of schoolA (and 0 independent classrooms)
      const ownerList = await request(app.getHttpServer())
        .get('/me/classrooms')
        .set('Authorization', tokenForUser(schoolOwner.id))
        .expect(200);

      expect(ownerList.body.total).toBe(5);
      expect(
        ownerList.body.items.every(
          (i: { schoolId: string; myRole: string }) =>
            i.schoolId === schoolA.id && i.myRole === 'OWNER',
        ),
      ).toBe(true);
    });
  });

  describe('Create authorization through the shared access service (no existence leak, no partial writes)', () => {
    let multiSchoolTeacher: { id: string };
    let schoolPathWithoutMembership: { id: string };
    let independentTeacherAlsoStudent: { id: string };
    let lostSchoolTeacher: { id: string };
    let schoolBClassroomId: string;

    const NONEXISTENT_SCHOOL_ID = '00000000-0000-4000-8000-00000000dead';

    const makeUser = async (prefix: string, path: RegistrationPath) => {
      const user = await prisma.user.create({
        data: {
          email: `cls.${prefix}.${Date.now()}.${Math.round(Math.random() * 1e6)}@example.edu.ar`,
          passwordHash: 'dummy-hash-for-integration-tests',
          displayName: `${prefix} User`,
          registrationPath: path,
        },
      });
      createdUserIds.push(user.id);
      return user;
    };

    const writeSnapshot = async (actorId: string, probeName: string) => ({
      probeClassrooms: await prisma.classroom.count({ where: { name: probeName } }),
      actorIndependentClassrooms: await prisma.classroom.count({
        where: { independentTeacherId: actorId },
      }),
      schoolClassrooms: await prisma.classroom.count({
        where: { schoolId: { in: [schoolA.id, schoolB.id] } },
      }),
      actorMemberships: await prisma.classroomMembership.count({ where: { userId: actorId } }),
      probePets: await prisma.classroomPet.count({ where: { classroom: { name: probeName } } }),
      probeDesks: await prisma.desk.count({ where: { classroom: { name: probeName } } }),
    });

    const postExpectingRejection = async (
      actorId: string,
      body: Record<string, unknown>,
      status: number,
    ) => {
      const before = await writeSnapshot(actorId, body.name as string);
      const res = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(actorId))
        .send(body)
        .expect(status);
      const after = await writeSnapshot(actorId, body.name as string);
      expect(after).toEqual(before);
      return res;
    };

    const envelopeWithoutCorrelation = (body: { error: Record<string, unknown> }) => {
      return { ...body.error, correlationId: undefined };
    };

    beforeAll(async () => {
      multiSchoolTeacher = await makeUser('multi.teacher', RegistrationPath.SCHOOL);
      schoolPathWithoutMembership = await makeUser('school.nomember', RegistrationPath.SCHOOL);
      independentTeacherAlsoStudent = await makeUser(
        'ind.also.student',
        RegistrationPath.INDEPENDENT_TEACHER,
      );
      lostSchoolTeacher = await makeUser('lost.teacher', RegistrationPath.SCHOOL);

      await prisma.schoolMember.createMany({
        data: [
          {
            schoolId: schoolA.id,
            userId: multiSchoolTeacher.id,
            role: SchoolRole.TEACHER,
            state: MembershipState.ACTIVE,
          },
          {
            schoolId: schoolB.id,
            userId: multiSchoolTeacher.id,
            role: SchoolRole.TEACHER,
            state: MembershipState.ACTIVE,
          },
          {
            schoolId: schoolB.id,
            userId: lostSchoolTeacher.id,
            role: SchoolRole.TEACHER,
            state: MembershipState.INACTIVE,
          },
        ],
      });

      const schoolBClassroom = await prisma.classroom.create({
        data: { name: `Aula Escuela B ${Date.now()}`, schoolId: schoolB.id },
      });
      schoolBClassroomId = schoolBClassroom.id;
      createdClassroomIds.push(schoolBClassroomId);

      await prisma.classroomMembership.createMany({
        data: [
          {
            classroomId: schoolBClassroomId,
            userId: independentTeacherAlsoStudent.id,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
          {
            classroomId: schoolBClassroomId,
            userId: lostSchoolTeacher.id,
            role: ClassroomRole.TEACHER,
            state: MembershipState.ACTIVE,
          },
        ],
      });
    });

    it('answers an unrelated existing school and a nonexistent school identically (404) for students and parents, writing nothing', async () => {
      // studentUser / parentUser are only related to school A; school B is existing but unrelated.
      for (const actor of [studentUser, parentUser]) {
        const unrelated = await postExpectingRejection(
          actor.id,
          { name: `Leak probe unrelated ${actor.id}`, schoolId: schoolB.id },
          404,
        );
        const missing = await postExpectingRejection(
          actor.id,
          { name: `Leak probe missing ${actor.id}`, schoolId: NONEXISTENT_SCHOOL_ID },
          404,
        );

        expect(unrelated.body.error.code).toBe('NOT_FOUND');
        expect(envelopeWithoutCorrelation(unrelated.body)).toEqual(
          envelopeWithoutCorrelation(missing.body),
        );
      }
    });

    it('answers 403 and writes nothing only for a student or parent related to that school', async () => {
      const student = await postExpectingRejection(
        studentUser.id,
        { name: 'Related student probe', schoolId: schoolA.id },
        403,
      );
      expect(student.body.error.code).toBe('FORBIDDEN');

      const parent = await postExpectingRejection(
        parentUser.id,
        { name: 'Related parent probe', schoolId: schoolA.id },
        403,
      );
      expect(parent.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects a student and a parent omitting schoolId with 403 and writes nothing', async () => {
      await postExpectingRejection(studentUser.id, { name: 'Student omitted probe' }, 403);
      await postExpectingRejection(parentUser.id, { name: 'Parent omitted probe' }, 403);
    });

    it('lets an independent teacher who is also enrolled as a student elsewhere create their own classroom', async () => {
      const res = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(independentTeacherAlsoStudent.id))
        .send({ name: 'Taller del docente-estudiante' })
        .expect(201);
      createdClassroomIds.push(res.body.id);

      expect(res.body).toMatchObject({
        schoolId: null,
        independentTeacherId: independentTeacherAlsoStudent.id,
        myRole: 'TEACHER',
      });
    });

    it('answers a SCHOOL-path user without any active membership with 404 (not the students-and-parents message) and writes nothing', async () => {
      const res = await postExpectingRejection(
        schoolPathWithoutMembership.id,
        { name: 'No membership probe' },
        404,
      );
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('requires an explicit schoolId (400 VALIDATION_FAILED on schoolId) when the user belongs to several schools, writing nothing', async () => {
      const res = await postExpectingRejection(
        multiSchoolTeacher.id,
        { name: 'Ambiguous school probe' },
        400,
      );

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([
        { field: 'schoolId', messages: [expect.any(String)] },
      ]);
    });

    it('creates in the explicitly selected school for a multi-membership user and records a TEACHER membership there', async () => {
      const res = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(multiSchoolTeacher.id))
        .send({ name: 'Aula explícita Escuela B', schoolId: schoolB.id })
        .expect(201);
      createdClassroomIds.push(res.body.id);

      expect(res.body).toMatchObject({
        schoolId: schoolB.id,
        independentTeacherId: null,
        myRole: 'TEACHER',
      });
      const membership = await prisma.classroomMembership.findFirst({
        where: { classroomId: res.body.id, userId: multiSchoolTeacher.id },
      });
      expect(membership?.role).toBe(ClassroomRole.TEACHER);
    });

    it('denies a school Teacher of A, and the Owner and Admin of A, creating in school B with 404 and no writes', async () => {
      for (const actor of [schoolTeacher1, schoolOwner, schoolAdmin]) {
        const res = await postExpectingRejection(
          actor.id,
          { name: `Cross school probe ${actor.id}`, schoolId: schoolB.id },
          404,
        );
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('keeps list and detail in agreement on myRole and capabilities for every visible classroom', async () => {
      const actors = [
        schoolOwner,
        schoolAdmin,
        schoolTeacher1,
        studentUser,
        parentUser,
        independentTeacher,
        independentTeacherAlsoStudent,
        multiSchoolTeacher,
        otherSchoolOwner,
      ];

      for (const actor of actors) {
        const listed = await request(app.getHttpServer())
          .get('/me/classrooms?pageSize=100')
          .set('Authorization', tokenForUser(actor.id))
          .expect(200);
        const listedAlias = await request(app.getHttpServer())
          .get('/classrooms?pageSize=100')
          .set('Authorization', tokenForUser(actor.id))
          .expect(200);
        expect(listedAlias.body.items).toEqual(listed.body.items);

        for (const item of listed.body.items as {
          id: string;
          myRole: string;
          capabilities: string[];
        }[]) {
          const detail = await request(app.getHttpServer())
            .get(`/classrooms/${item.id}`)
            .set('Authorization', tokenForUser(actor.id))
            .expect(200);
          expect(detail.body.myRole).toBe(item.myRole);
          expect(detail.body.capabilities).toEqual(item.capabilities);
        }
      }
      // Many sequential HTTP round trips; the default 5 s timeout flakes under full-suite load.
    }, 20_000);

    it('never lists a classroom for which no role resolves (no fall-open to STUDENT) and the detail agrees with 404', async () => {
      // Active TEACHER classroom membership but the school membership is INACTIVE: no authority.
      const listed = await request(app.getHttpServer())
        .get('/me/classrooms')
        .set('Authorization', tokenForUser(lostSchoolTeacher.id))
        .expect(200);
      expect(listed.body.items).toEqual([]);
      expect(listed.body.total).toBe(0);

      await request(app.getHttpServer())
        .get(`/classrooms/${schoolBClassroomId}`)
        .set('Authorization', tokenForUser(lostSchoolTeacher.id))
        .expect(404);
    });
  });

  describe('Shared pagination contract and classroom text hygiene', () => {
    let pager: { id: string };
    const pagerClassroomIds: string[] = [];
    const TIE_CREATED_AT = new Date('2026-01-01T10:00:00.000Z');

    const auth = () => tokenForUser(pager.id);

    const classroomRows = async () =>
      prisma.classroom.findMany({ where: { independentTeacherId: pager.id } });

    beforeAll(async () => {
      pager = await prisma.user.create({
        data: {
          email: `cls.pager.${Date.now()}@example.edu.ar`,
          passwordHash: 'dummy-hash-for-integration-tests',
          displayName: 'pager User',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        },
      });
      createdUserIds.push(pager.id);

      // Two rows share createdAt and name so only the id tiebreaker keeps their order stable.
      const specs = [
        { name: 'Bravo', createdAt: new Date('2026-01-01T09:00:00.000Z') },
        { name: 'Alfa', createdAt: TIE_CREATED_AT },
        { name: 'Alfa', createdAt: TIE_CREATED_AT },
        { name: 'Charlie', createdAt: TIE_CREATED_AT },
        { name: 'Delta', createdAt: new Date('2026-01-01T11:00:00.000Z') },
      ];
      for (const spec of specs) {
        const row = await prisma.classroom.create({
          data: { ...spec, independentTeacherId: pager.id },
        });
        pagerClassroomIds.push(row.id);
        createdClassroomIds.push(row.id);
      }
    });

    describe.each(['/me/classrooms', '/classrooms'])('GET %s', (path) => {
      const get = (query: string) =>
        request(app.getHttpServer()).get(`${path}${query}`).set('Authorization', auth());

      it('returns the shared envelope with default createdAt descending order', async () => {
        const res = await get('').expect(200);

        expect(Object.keys(res.body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
        expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 5 });
        expect(res.body.items.map((i: { name: string }) => i.name)[0]).toBe('Delta');
        expect(res.body.items.at(-1).name).toBe('Bravo');
      });

      it.each([
        ['name', ['Alfa', 'Alfa', 'Bravo', 'Charlie', 'Delta']],
        ['-name', ['Delta', 'Charlie', 'Bravo', 'Alfa', 'Alfa']],
      ])('orders by ?sort=%s', async (sort, expected) => {
        const res = await get(`?sort=${sort}`).expect(200);
        expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(expected);
      });

      it('keeps rows with equal sort keys stable across pages (id tiebreaker)', async () => {
        const seen: string[] = [];
        for (const page of [1, 2, 3]) {
          const res = await get(`?sort=name&page=${page}&pageSize=2`).expect(200);
          expect(res.body).toMatchObject({ page, pageSize: 2, total: 5 });
          seen.push(...res.body.items.map((i: { id: string }) => i.id));
        }
        expect(new Set(seen).size).toBe(5);
        const full = await get('?sort=name&pageSize=100').expect(200);
        expect(seen).toEqual(full.body.items.map((i: { id: string }) => i.id));
      });

      it('returns an empty page past the end with the real total', async () => {
        const res = await get('?page=9&pageSize=2').expect(200);
        expect(res.body).toEqual({ items: [], page: 9, pageSize: 2, total: 5 });
      });

      it.each([
        'page=0',
        'page=10001',
        'pageSize=0',
        'pageSize=101',
        'sort=myRole',
        'sort=-schoolId',
        'limit=2',
        'order=asc',
      ])('rejects ?%s with 400 VALIDATION_FAILED', async (query) => {
        const res = await get(`?${query}`).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      });
    });

    describe('name and subject hygiene (no writes on rejection)', () => {
      const BAD: [string, string][] = [
        ['zero-width space', '\u200B'],
        ['ZWNJ/ZWJ only', '\u200C\u200D'],
        ['soft hyphen', '\u00AD'],
        ['BOM', '\uFEFF'],
        ['newline inside', 'Aula\nB'],
        ['line separator', 'Aula\u2028B'],
        ['paragraph separator', 'Aula\u2029B'],
      ];

      it.each(BAD)('rejects %s as name or subject on create, writing nothing', async (_l, bad) => {
        const before = (await classroomRows()).length;
        await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', auth())
          .send({ name: bad })
          .expect(400);
        await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', auth())
          .send({ name: 'Aula visible', subject: bad })
          .expect(400);
        expect(await classroomRows()).toHaveLength(before);
      });

      it.each(BAD)(
        'rejects %s as name or subject on PATCH, leaving the row untouched',
        async (_l, bad) => {
          const target = pagerClassroomIds[0];
          const before = await prisma.classroom.findUniqueOrThrow({ where: { id: target } });
          for (const field of ['name', 'subject']) {
            await request(app.getHttpServer())
              .patch(`/classrooms/${target}`)
              .set('Authorization', auth())
              .send({ [field]: bad })
              .expect(400);
          }
          const after = await prisma.classroom.findUniqueOrThrow({ where: { id: target } });
          expect(after).toEqual(before);
        },
      );

      it('rejects an empty PATCH body with 400 VALIDATION_FAILED and does not bump updatedAt', async () => {
        const target = pagerClassroomIds[1];
        const before = await prisma.classroom.findUniqueOrThrow({ where: { id: target } });

        const res = await request(app.getHttpServer())
          .patch(`/classrooms/${target}`)
          .set('Authorization', auth())
          .send({})
          .expect(400);

        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        const after = await prisma.classroom.findUniqueOrThrow({ where: { id: target } });
        expect(after.updatedAt).toEqual(before.updatedAt);
      });

      it('rejects an empty subject after trimming on create and PATCH, writing nothing', async () => {
        const target = pagerClassroomIds[2];
        const before = await prisma.classroom.findUniqueOrThrow({ where: { id: target } });
        const count = (await classroomRows()).length;
        await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', auth())
          .send({ name: 'Aula visible', subject: '   ' })
          .expect(400);
        await request(app.getHttpServer())
          .patch(`/classrooms/${target}`)
          .set('Authorization', auth())
          .send({ subject: '   ' })
          .expect(400);
        expect(await classroomRows()).toHaveLength(count);
        expect(await prisma.classroom.findUniqueOrThrow({ where: { id: target } })).toEqual(before);
      });

      it('accepts ordinary Unicode names and clears subject with null', async () => {
        const created = await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', auth())
          .send({
            name: '3\u00B0 A\u00F1o B \u2013 \u6570\u5B66 \uD83D\uDC69\u200D\uD83C\uDFEB',
            subject: 'Matem\u00E1tica',
          })
          .expect(201);
        createdClassroomIds.push(created.body.id);
        expect(created.body.name).toBe(
          '3\u00B0 A\u00F1o B \u2013 \u6570\u5B66 \uD83D\uDC69\u200D\uD83C\uDFEB',
        );

        const patched = await request(app.getHttpServer())
          .patch(`/classrooms/${created.body.id}`)
          .set('Authorization', auth())
          .send({ name: '\u00C1lgebra', subject: null })
          .expect(200);
        expect(patched.body).toMatchObject({ name: '\u00C1lgebra', subject: null });
      });
    });
  });
});
