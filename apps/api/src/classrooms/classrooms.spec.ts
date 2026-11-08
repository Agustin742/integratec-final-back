import {
  ForbiddenException,
  type INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClassroomRole, MembershipState, RegistrationPath, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
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

const ACTOR_TEACHER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_OWNER_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_SCHOOL_TEACHER_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR_STUDENT_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR_PARENT_ID = '66666666-6666-4666-8666-666666666666';
const SCHOOL_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_SCHOOL_ID = '88888888-8888-4888-8888-888888888888';
const CLASSROOM_ID = '99999999-9999-4999-8999-999999999999';
const PET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('ClassroomsModule & ClassroomsService (HU-AUL-001)', () => {
  describe('HTTP Contract, Auth Guard & Validation Pipe', () => {
    let app: INestApplication;
    let mockClassroomsService: {
      create: ReturnType<typeof vi.fn>;
      findOne: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      listForActor: ReturnType<typeof vi.fn>;
    };

    const mockSession: VerifiedSession = {
      userId: ACTOR_TEACHER_ID,
      sessionId: SESSION_ID,
    };

    beforeAll(async () => {
      vi.spyOn(PrismaService.prototype, '$connect').mockImplementation(async () => {});
      vi.spyOn(PrismaService.prototype, '$disconnect').mockImplementation(async () => {});

      mockClassroomsService = {
        create: vi.fn(),
        findOne: vi.fn(),
        update: vi.fn(),
        listForActor: vi.fn(),
      };

      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [
          ApiConfigModule.forRoot(authTestConfig()),
          PrismaModule,
          AuthModule,
          ClassroomsModule,
        ],
      })
        .overrideProvider(SessionVerifier)
        .useValue({
          verifyAuthorizationHeader: vi.fn(async (header?: string) => {
            if (header === 'Bearer valid-token') {
              return mockSession;
            }
            throw new UnauthorizedException();
          }),
        })
        .overrideProvider(ClassroomsService)
        .useValue(mockClassroomsService)
        .compile();

      app = moduleRef.createNestApplication();
      configureHttp(app, { logSink: () => undefined });
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe('Authentication Guard (401 Unauthorized when unauthenticated)', () => {
      it('rejects unauthenticated POST /classrooms with 401 UNAUTHENTICATED', async () => {
        const res = await request(app.getHttpServer())
          .post('/classrooms')
          .send({ name: 'Aula 1' })
          .expect(401);

        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('rejects unauthenticated GET /classrooms with 401 UNAUTHENTICATED', async () => {
        const res = await request(app.getHttpServer()).get('/classrooms').expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('rejects unauthenticated GET /me/classrooms with 401 UNAUTHENTICATED', async () => {
        const res = await request(app.getHttpServer()).get('/me/classrooms').expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('rejects unauthenticated GET /classrooms/:id with 401 UNAUTHENTICATED', async () => {
        const res = await request(app.getHttpServer())
          .get(`/classrooms/${CLASSROOM_ID}`)
          .expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });

      it('rejects unauthenticated PATCH /classrooms/:id with 401 UNAUTHENTICATED', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/classrooms/${CLASSROOM_ID}`)
          .send({ name: 'Updated' })
          .expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      });
    });

    describe('DTO Validation (400 VALIDATION_FAILED)', () => {
      it('rejects POST /classrooms when name is missing or whitespace-only', async () => {
        const res = await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', 'Bearer valid-token')
          .send({ name: '   ' })
          .expect(400);

        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
        );
      });

      it('rejects POST /classrooms when name exceeds 120 characters', async () => {
        const res = await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', 'Bearer valid-token')
          .send({ name: 'A'.repeat(121) })
          .expect(400);

        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
        );
      });

      it('rejects POST /classrooms when subject is whitespace-only or exceeds 200 characters', async () => {
        const emptySubj = await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', 'Bearer valid-token')
          .send({ name: 'Aula Válida', subject: '   ' })
          .expect(400);

        expect(emptySubj.body.error.code).toBe('VALIDATION_FAILED');
        expect(emptySubj.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'subject' })]),
        );

        const longSubj = await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', 'Bearer valid-token')
          .send({ name: 'Aula Válida', subject: 'S'.repeat(201) })
          .expect(400);

        expect(longSubj.body.error.code).toBe('VALIDATION_FAILED');
        expect(longSubj.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'subject' })]),
        );
      });

      it('rejects POST /classrooms when schoolId is not a valid UUID', async () => {
        const res = await request(app.getHttpServer())
          .post('/classrooms')
          .set('Authorization', 'Bearer valid-token')
          .send({ name: 'Aula Válida', schoolId: 'not-a-uuid' })
          .expect(400);

        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'schoolId' })]),
        );
      });

      it('rejects PATCH /classrooms/:id when boolean control flags are not booleans or unknown fields are sent', async () => {
        const invalidBool = await request(app.getHttpServer())
          .patch(`/classrooms/${CLASSROOM_ID}`)
          .set('Authorization', 'Bearer valid-token')
          .send({ chatMuted: 'yes' })
          .expect(400);

        expect(invalidBool.body.error.code).toBe('VALIDATION_FAILED');
        expect(invalidBool.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'chatMuted' })]),
        );

        const unknownField = await request(app.getHttpServer())
          .patch(`/classrooms/${CLASSROOM_ID}`)
          .set('Authorization', 'Bearer valid-token')
          .send({ unknownProp: true })
          .expect(400);

        expect(unknownField.body.error.code).toBe('VALIDATION_FAILED');
      });

      it.each([
        ['page=0', 'page'],
        ['page=-2', 'page'],
        ['page=abc', 'page'],
        ['limit=0', 'limit'],
        ['limit=101', 'limit'],
        ['order=random', 'order'],
      ])(
        'rejects GET /me/classrooms?%s with 400 VALIDATION_FAILED on %s',
        async (queryStr, field) => {
          const res = await request(app.getHttpServer())
            .get(`/me/classrooms?${queryStr}`)
            .set('Authorization', 'Bearer valid-token')
            .expect(400);

          expect(res.body.error.code).toBe('VALIDATION_FAILED');
          expect(res.body.error.details).toEqual(
            expect.arrayContaining([expect.objectContaining({ field })]),
          );
        },
      );
    });
  });

  describe('ClassroomsService Unit Tests', () => {
    let service: ClassroomsService;
    let accessService: AccessVerificationService;
    let mockPrisma: {
      user: { findUnique: ReturnType<typeof vi.fn> };
      school: { findFirst: ReturnType<typeof vi.fn> };
      schoolMember: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
      classroom: {
        create: ReturnType<typeof vi.fn>;
        findFirst: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
        count: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
      classroomPet: { create: ReturnType<typeof vi.fn> };
      desk: { createMany: ReturnType<typeof vi.fn> };
      classroomMembership: {
        create: ReturnType<typeof vi.fn>;
        findFirst: ReturnType<typeof vi.fn>;
      };
      parentLink: { findMany: ReturnType<typeof vi.fn> };
      $transaction: ReturnType<typeof vi.fn>;
    };

    const now = new Date('2026-11-07T20:00:00.000Z');

    beforeEach(() => {
      mockPrisma = {
        user: { findUnique: vi.fn() },
        school: { findFirst: vi.fn() },
        schoolMember: { findFirst: vi.fn(), findMany: vi.fn() },
        classroom: {
          create: vi.fn(),
          findFirst: vi.fn(),
          findMany: vi.fn(),
          count: vi.fn(),
          update: vi.fn(),
        },
        classroomPet: { create: vi.fn() },
        desk: { createMany: vi.fn() },
        classroomMembership: { create: vi.fn(), findFirst: vi.fn() },
        parentLink: { findMany: vi.fn() },
        $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
          cb(mockPrisma),
        ),
      };

      accessService = new AccessVerificationService(mockPrisma as unknown as PrismaService);
      service = new ClassroomsService(mockPrisma as unknown as PrismaService, accessService);
    });

    describe('create()', () => {
      it('throws 401 Unauthorized when actorUserId is not a valid UUID', async () => {
        await expect(service.create('not-a-uuid', { name: 'Aula' })).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('throws 404 NotFound when schoolId is not a valid UUID', async () => {
        await expect(
          service.create(ACTOR_OWNER_ID, { name: 'Aula', schoolId: 'invalid-uuid' }),
        ).rejects.toThrow(NotFoundException);
      });

      it('creates an independent teacher classroom atomically with default pet, 12 desks (1..12), and default controls', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: ACTOR_TEACHER_ID,
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          schoolMemberships: [],
          classroomMemberships: [],
          parentOfLinks: [],
          _count: { independentClassrooms: 0 },
        });

        mockPrisma.classroom.create.mockResolvedValue({
          id: CLASSROOM_ID,
          name: 'Aula Particular Física',
          subject: 'Física I',
          schoolId: null,
          independentTeacherId: ACTOR_TEACHER_ID,
          adultMode: false,
          chatMuted: false,
          collaborationLocked: false,
          gamesDisabled: false,
          createdAt: now,
          updatedAt: now,
        });

        mockPrisma.classroomPet.create.mockResolvedValue({
          id: PET_ID,
          classroomId: CLASSROOM_ID,
          name: DEFAULT_PET_NAME,
          species: DEFAULT_PET_SPECIES,
          level: 1,
          experience: 0,
        });

        mockPrisma.desk.createMany.mockResolvedValue({ count: DEFAULT_INITIAL_DESK_COUNT });

        const result = await service.create(ACTOR_TEACHER_ID, {
          name: 'Aula Particular Física',
          subject: 'Física I',
        });

        expect(result).toEqual({
          id: CLASSROOM_ID,
          name: 'Aula Particular Física',
          subject: 'Física I',
          schoolId: null,
          independentTeacherId: ACTOR_TEACHER_ID,
          adultMode: false,
          chatMuted: false,
          collaborationLocked: false,
          gamesDisabled: false,
          deskCount: DEFAULT_INITIAL_DESK_COUNT,
          pet: {
            id: PET_ID,
            name: DEFAULT_PET_NAME,
            species: DEFAULT_PET_SPECIES,
            level: 1,
            experience: 0,
          },
          myRole: 'TEACHER',
          capabilities: expect.arrayContaining([
            'configure_classroom',
            'invite_members',
            'publish_content',
          ]),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        expect(mockPrisma.desk.createMany).toHaveBeenCalledWith({
          data: Array.from({ length: DEFAULT_INITIAL_DESK_COUNT }, (_, idx) => ({
            classroomId: CLASSROOM_ID,
            deskIndex: idx + 1,
          })),
        });
        expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
      });

      it('creates a school classroom for School OWNER without creating a ClassroomMembership row', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: ACTOR_OWNER_ID,
          registrationPath: RegistrationPath.SCHOOL,
          schoolMemberships: [{ schoolId: SCHOOL_ID, role: SchoolRole.OWNER }],
          classroomMemberships: [],
          parentOfLinks: [],
          _count: { independentClassrooms: 0 },
        });

        mockPrisma.classroom.create.mockResolvedValue({
          id: CLASSROOM_ID,
          name: '1° Año A',
          subject: null,
          schoolId: SCHOOL_ID,
          independentTeacherId: null,
          adultMode: false,
          chatMuted: false,
          collaborationLocked: false,
          gamesDisabled: false,
          createdAt: now,
          updatedAt: now,
        });

        mockPrisma.classroomPet.create.mockResolvedValue({
          id: PET_ID,
          classroomId: CLASSROOM_ID,
          name: DEFAULT_PET_NAME,
          species: DEFAULT_PET_SPECIES,
          level: 1,
          experience: 0,
        });

        mockPrisma.desk.createMany.mockResolvedValue({ count: DEFAULT_INITIAL_DESK_COUNT });

        const result = await service.create(ACTOR_OWNER_ID, { name: '1° Año A' });

        expect(result.schoolId).toBe(SCHOOL_ID);
        expect(result.independentTeacherId).toBeNull();
        expect(result.myRole).toBe('OWNER');
        expect(result.capabilities).toContain('manage_school');
        expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
      });

      it('creates a school classroom for School ADMIN without creating a ClassroomMembership row', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: ACTOR_ADMIN_ID,
          registrationPath: RegistrationPath.SCHOOL,
          schoolMemberships: [{ schoolId: SCHOOL_ID, role: SchoolRole.ADMIN }],
          classroomMemberships: [],
          parentOfLinks: [],
          _count: { independentClassrooms: 0 },
        });

        mockPrisma.classroom.create.mockResolvedValue({
          id: CLASSROOM_ID,
          name: '2° Año A',
          subject: null,
          schoolId: SCHOOL_ID,
          independentTeacherId: null,
          adultMode: false,
          chatMuted: false,
          collaborationLocked: false,
          gamesDisabled: false,
          createdAt: now,
          updatedAt: now,
        });

        mockPrisma.classroomPet.create.mockResolvedValue({
          id: PET_ID,
          classroomId: CLASSROOM_ID,
          name: DEFAULT_PET_NAME,
          species: DEFAULT_PET_SPECIES,
          level: 1,
          experience: 0,
        });

        mockPrisma.desk.createMany.mockResolvedValue({ count: DEFAULT_INITIAL_DESK_COUNT });

        const result = await service.create(ACTOR_ADMIN_ID, { name: '2° Año A' });

        expect(result.schoolId).toBe(SCHOOL_ID);
        expect(result.myRole).toBe('ADMIN');
        expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
      });

      it('creates a school classroom for School TEACHER and records ClassroomMembership(TEACHER)', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: ACTOR_SCHOOL_TEACHER_ID,
          registrationPath: RegistrationPath.SCHOOL,
          schoolMemberships: [{ schoolId: SCHOOL_ID, role: SchoolRole.TEACHER }],
          classroomMemberships: [],
          parentOfLinks: [],
          _count: { independentClassrooms: 0 },
        });

        mockPrisma.classroom.create.mockResolvedValue({
          id: CLASSROOM_ID,
          name: '3° Año C',
          subject: 'Historia',
          schoolId: SCHOOL_ID,
          independentTeacherId: null,
          adultMode: false,
          chatMuted: false,
          collaborationLocked: false,
          gamesDisabled: false,
          createdAt: now,
          updatedAt: now,
        });

        mockPrisma.classroomPet.create.mockResolvedValue({
          id: PET_ID,
          classroomId: CLASSROOM_ID,
          name: DEFAULT_PET_NAME,
          species: DEFAULT_PET_SPECIES,
          level: 1,
          experience: 0,
        });

        mockPrisma.desk.createMany.mockResolvedValue({ count: DEFAULT_INITIAL_DESK_COUNT });
        mockPrisma.classroomMembership.create.mockResolvedValue({ id: 'mem-1' });

        const result = await service.create(ACTOR_SCHOOL_TEACHER_ID, {
          name: '3° Año C',
          subject: 'Historia',
        });

        expect(result.schoolId).toBe(SCHOOL_ID);
        expect(result.myRole).toBe('TEACHER');
        expect(mockPrisma.classroomMembership.create).toHaveBeenCalledWith({
          data: {
            classroomId: CLASSROOM_ID,
            userId: ACTOR_SCHOOL_TEACHER_ID,
            role: ClassroomRole.TEACHER,
            state: MembershipState.ACTIVE,
          },
        });
      });

      it('rejects a student attempting to create a classroom with 403 Forbidden', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: ACTOR_STUDENT_ID,
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          schoolMemberships: [],
          classroomMemberships: [
            {
              classroomId: CLASSROOM_ID,
              role: ClassroomRole.STUDENT,
              classroom: { schoolId: SCHOOL_ID },
            },
          ],
          parentOfLinks: [],
          _count: { independentClassrooms: 0 },
        });

        await expect(service.create(ACTOR_STUDENT_ID, { name: 'Student Aula' })).rejects.toThrow(
          ForbiddenException,
        );
        expect(mockPrisma.classroom.create).not.toHaveBeenCalled();
      });

      it('rejects a parent attempting to create a classroom with 403 Forbidden', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: ACTOR_PARENT_ID,
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          schoolMemberships: [],
          classroomMemberships: [],
          parentOfLinks: [
            {
              classroomId: CLASSROOM_ID,
              classroom: { schoolId: SCHOOL_ID },
            },
          ],
          _count: { independentClassrooms: 0 },
        });

        await expect(service.create(ACTOR_PARENT_ID, { name: 'Parent Aula' })).rejects.toThrow(
          ForbiddenException,
        );
        expect(mockPrisma.classroom.create).not.toHaveBeenCalled();
      });

      it('rejects a staff member of School A attempting to create a classroom in School B with 404 NotFound', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
          id: ACTOR_OWNER_ID,
          registrationPath: RegistrationPath.SCHOOL,
          schoolMemberships: [{ schoolId: SCHOOL_ID, role: SchoolRole.OWNER }],
          classroomMemberships: [],
          parentOfLinks: [],
          _count: { independentClassrooms: 0 },
        });
        mockPrisma.school.findFirst.mockResolvedValue({ id: OTHER_SCHOOL_ID });

        await expect(
          service.create(ACTOR_OWNER_ID, { name: 'Cross School Aula', schoolId: OTHER_SCHOOL_ID }),
        ).rejects.toThrow(NotFoundException);
        expect(mockPrisma.classroom.create).not.toHaveBeenCalled();
      });
    });

    describe('findOne() & update()', () => {
      it('returns 404 NotFound when classroomId is not a valid UUID on findOne and update', async () => {
        await expect(service.findOne(ACTOR_TEACHER_ID, 'not-a-uuid')).rejects.toThrow(
          NotFoundException,
        );
        await expect(
          service.update(ACTOR_TEACHER_ID, 'not-a-uuid', { name: 'Updated' }),
        ).rejects.toThrow(NotFoundException);
      });

      it('returns 403 Forbidden when a student or parent attempts to update classroom settings', async () => {
        mockPrisma.classroom.findFirst.mockResolvedValue({
          id: CLASSROOM_ID,
          schoolId: SCHOOL_ID,
          independentTeacherId: null,
          name: 'Aula 1',
          adultMode: false,
        });
        mockPrisma.school.findFirst.mockResolvedValue({ id: SCHOOL_ID });
        mockPrisma.schoolMember.findFirst.mockResolvedValue(null);
        mockPrisma.classroomMembership.findFirst.mockResolvedValue({
          role: ClassroomRole.STUDENT,
        });

        await expect(
          service.update(ACTOR_STUDENT_ID, CLASSROOM_ID, { chatMuted: true }),
        ).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.classroom.update).not.toHaveBeenCalled();
      });
    });
  });
});
