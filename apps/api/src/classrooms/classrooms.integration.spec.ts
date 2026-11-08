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
    await app.get(PrismaService).$connect();

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
    studentUser = await createUser('student', RegistrationPath.INDEPENDENT_TEACHER);
    parentUser = await createUser('parent', RegistrationPath.INDEPENDENT_TEACHER);
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

    it('rejects Student and Parent attempting POST /classrooms with 403 FORBIDDEN', async () => {
      const studentRes = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(studentUser.id))
        .send({ name: 'Aula Estudiante Prohibida' })
        .expect(403);
      expect(studentRes.body.error.code).toBe('FORBIDDEN');

      const parentRes = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(parentUser.id))
        .send({ name: 'Aula Padre Prohibida', schoolId: schoolA.id })
        .expect(403);
      expect(parentRes.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff of School A attempting to create a classroom in School B with 404 NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/classrooms')
        .set('Authorization', tokenForUser(schoolOwner.id))
        .send({ name: 'Intrusión Escuela B', schoolId: schoolB.id })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
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
        .get('/me/classrooms?page=1&limit=2&order=desc')
        .set('Authorization', tokenForUser(independentTeacher.id))
        .expect(200);

      expect(page1Desc.body.page).toBe(1);
      expect(page1Desc.body.limit).toBe(2);
      expect(page1Desc.body.total).toBe(3);
      expect(page1Desc.body.totalPages).toBe(2);
      expect(page1Desc.body.items).toHaveLength(2);
      expect(page1Desc.body.items.every((c: { myRole: string }) => c.myRole === 'TEACHER')).toBe(
        true,
      );

      const page2Desc = await request(app.getHttpServer())
        .get('/classrooms?page=2&limit=2&order=desc')
        .set('Authorization', tokenForUser(independentTeacher.id))
        .expect(200);

      expect(page2Desc.body.items).toHaveLength(1);

      const allAsc = await request(app.getHttpServer())
        .get('/me/classrooms?page=1&limit=10&order=asc')
        .set('Authorization', tokenForUser(independentTeacher.id))
        .expect(200);

      expect(allAsc.body.items.map((i: { id: string }) => i.id)).toEqual(
        [...page1Desc.body.items, ...page2Desc.body.items]
          .map((i: { id: string }) => i.id)
          .reverse(),
      );

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
});
