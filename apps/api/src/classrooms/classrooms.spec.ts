import {
  BadRequestException,
  ForbiddenException,
  type INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccessVerificationService,
  computeClassroomCapabilities,
} from '../access/access-verification.service';
import { AuthModule } from '../auth/auth.module';
import { SessionVerifier, type VerifiedSession } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { RequestValidationException } from '../http/validation';
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
const SCHOOL_ID = '77777777-7777-4777-8777-777777777777';
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

      describe.each(['/me/classrooms', '/classrooms'])('GET %s query contract', (path) => {
        it.each([
          ['page=0', 'page'],
          ['page=-2', 'page'],
          ['page=abc', 'page'],
          ['page=10001', 'page'],
          ['pageSize=0', 'pageSize'],
          ['pageSize=101', 'pageSize'],
          ['sort=role', 'sort'],
          ['sort=-secret', 'sort'],
          ['limit=5', 'limit'],
          ['order=asc', 'order'],
        ])('rejects ?%s with 400 VALIDATION_FAILED on %s', async (queryStr, field) => {
          const res = await request(app.getHttpServer())
            .get(`${path}?${queryStr}`)
            .set('Authorization', 'Bearer valid-token')
            .expect(400);

          expect(res.body.error.code).toBe('VALIDATION_FAILED');
          expect(res.body.error.details).toEqual(
            expect.arrayContaining([expect.objectContaining({ field })]),
          );
          expect(mockClassroomsService.listForActor).not.toHaveBeenCalled();
        });

        it('defaults to page 1, pageSize 20 and createdAt descending', async () => {
          mockClassroomsService.listForActor.mockResolvedValue({
            items: [],
            page: 1,
            pageSize: 20,
            total: 0,
          });

          const res = await request(app.getHttpServer())
            .get(path)
            .set('Authorization', 'Bearer valid-token')
            .expect(200);

          expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
          expect(mockClassroomsService.listForActor).toHaveBeenCalledWith(ACTOR_TEACHER_ID, {
            page: 1,
            pageSize: 20,
            sort: { field: 'createdAt', direction: 'desc' },
          });
        });

        it.each([
          ['name', { field: 'name', direction: 'asc' }],
          ['-name', { field: 'name', direction: 'desc' }],
          ['createdAt', { field: 'createdAt', direction: 'asc' }],
        ])('maps ?sort=%s to the service', async (sort, expected) => {
          mockClassroomsService.listForActor.mockResolvedValue({
            items: [],
            page: 3,
            pageSize: 5,
            total: 0,
          });

          await request(app.getHttpServer())
            .get(`${path}?page=3&pageSize=5&sort=${sort}`)
            .set('Authorization', 'Bearer valid-token')
            .expect(200);

          expect(mockClassroomsService.listForActor).toHaveBeenCalledWith(ACTOR_TEACHER_ID, {
            page: 3,
            pageSize: 5,
            sort: expected,
          });
        });
      });

      describe('classroom name and subject hygiene', () => {
        const INVISIBLE_OR_CONTROL: [string, string][] = [
          ['zero-width space', '\u200B'],
          ['ZWNJ only', '\u200C'],
          ['ZWJ only', '\u200D'],
          ['soft hyphen', '\u00AD'],
          ['BOM', '\uFEFF'],
          ['line separator', 'Aula\u2028B'],
          ['paragraph separator', 'Aula\u2029B'],
          ['embedded newline', 'Aula\nB'],
          ['NUL', 'Aula\u0000'],
        ];

        it.each(INVISIBLE_OR_CONTROL)(
          'rejects POST /classrooms with %s as name',
          async (_label, name) => {
            const res = await request(app.getHttpServer())
              .post('/classrooms')
              .set('Authorization', 'Bearer valid-token')
              .send({ name })
              .expect(400);

            expect(res.body.error.code).toBe('VALIDATION_FAILED');
            expect(res.body.error.details).toEqual(
              expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
            );
            expect(mockClassroomsService.create).not.toHaveBeenCalled();
          },
        );

        it.each(INVISIBLE_OR_CONTROL)(
          'rejects POST /classrooms with %s as subject',
          async (_label, subject) => {
            const res = await request(app.getHttpServer())
              .post('/classrooms')
              .set('Authorization', 'Bearer valid-token')
              .send({ name: 'Aula valida', subject })
              .expect(400);

            expect(res.body.error.details).toEqual(
              expect.arrayContaining([expect.objectContaining({ field: 'subject' })]),
            );
            expect(mockClassroomsService.create).not.toHaveBeenCalled();
          },
        );

        it.each(INVISIBLE_OR_CONTROL)(
          'rejects PATCH /classrooms/:id with %s as name or subject',
          async (_label, value) => {
            for (const field of ['name', 'subject']) {
              const res = await request(app.getHttpServer())
                .patch(`/classrooms/${CLASSROOM_ID}`)
                .set('Authorization', 'Bearer valid-token')
                .send({ [field]: value })
                .expect(400);

              expect(res.body.error.code).toBe('VALIDATION_FAILED');
              expect(res.body.error.details).toEqual(
                expect.arrayContaining([expect.objectContaining({ field })]),
              );
            }
            expect(mockClassroomsService.update).not.toHaveBeenCalled();
          },
        );

        it('keeps ordinary Unicode names and subjects valid', async () => {
          mockClassroomsService.create.mockResolvedValue({ id: CLASSROOM_ID });
          mockClassroomsService.update.mockResolvedValue({ id: CLASSROOM_ID });

          await request(app.getHttpServer())
            .post('/classrooms')
            .set('Authorization', 'Bearer valid-token')
            .send({
              name: '  3\u00B0 A\u00F1o B \u2013 \u6570\u5B66  ',
              subject: 'Matem\u00E1tica y Geometr\u00EDa',
            })
            .expect(201);
          expect(mockClassroomsService.create).toHaveBeenCalledWith(
            ACTOR_TEACHER_ID,
            expect.objectContaining({
              name: '3\u00B0 A\u00F1o B \u2013 \u6570\u5B66',
              subject: 'Matem\u00E1tica y Geometr\u00EDa',
            }),
          );

          await request(app.getHttpServer())
            .patch(`/classrooms/${CLASSROOM_ID}`)
            .set('Authorization', 'Bearer valid-token')
            .send({ name: '\u00C1lgebra', subject: null })
            .expect(200);
        });

        it('rejects an empty-after-trim subject on create and update (never treated as absent)', async () => {
          await request(app.getHttpServer())
            .post('/classrooms')
            .set('Authorization', 'Bearer valid-token')
            .send({ name: 'Aula', subject: '  ' })
            .expect(400);
          await request(app.getHttpServer())
            .patch(`/classrooms/${CLASSROOM_ID}`)
            .set('Authorization', 'Bearer valid-token')
            .send({ subject: '  ' })
            .expect(400);
          expect(mockClassroomsService.create).not.toHaveBeenCalled();
          expect(mockClassroomsService.update).not.toHaveBeenCalled();
        });
      });
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
        parentLink: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
          cb(mockPrisma),
        ),
      };

      accessService = new AccessVerificationService(mockPrisma as unknown as PrismaService);
      service = new ClassroomsService(mockPrisma as unknown as PrismaService, accessService);
    });

    describe('create()', () => {
      const classroomRow = (over: Record<string, unknown>) => ({
        id: CLASSROOM_ID,
        name: 'Aula',
        subject: null,
        schoolId: null,
        independentTeacherId: null,
        adultMode: false,
        chatMuted: false,
        collaborationLocked: false,
        gamesDisabled: false,
        createdAt: now,
        updatedAt: now,
        ...over,
      });

      const stubProvisioning = (row: Record<string, unknown>) => {
        mockPrisma.classroom.create.mockResolvedValue(row);
        mockPrisma.classroomPet.create.mockResolvedValue({
          id: PET_ID,
          classroomId: CLASSROOM_ID,
          name: DEFAULT_PET_NAME,
          species: DEFAULT_PET_SPECIES,
          level: 1,
          experience: 0,
        });
        mockPrisma.desk.createMany.mockResolvedValue({ count: DEFAULT_INITIAL_DESK_COUNT });
      };

      const expectNoWrites = () => {
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        expect(mockPrisma.classroom.create).not.toHaveBeenCalled();
        expect(mockPrisma.classroomPet.create).not.toHaveBeenCalled();
        expect(mockPrisma.desk.createMany).not.toHaveBeenCalled();
        expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
      };

      it('throws 401 Unauthorized when actorUserId is not a valid UUID', async () => {
        await expect(service.create('not-a-uuid', { name: 'Aula' })).rejects.toThrow(
          UnauthorizedException,
        );
        expectNoWrites();
      });

      it('delegates the creation decision to the shared access service and writes nothing on 404', async () => {
        const resolve = vi
          .spyOn(accessService, 'resolveClassroomCreationTarget')
          .mockRejectedValue(new NotFoundException('School not found'));

        await expect(
          service.create(ACTOR_OWNER_ID, { name: 'Aula', schoolId: 'invalid-uuid' }),
        ).rejects.toThrow(NotFoundException);
        expect(resolve).toHaveBeenCalledWith(ACTOR_OWNER_ID, 'invalid-uuid');
        expectNoWrites();
      });

      it('does not query the school or the user directly: authorization lives in the access service', async () => {
        vi.spyOn(accessService, 'resolveClassroomCreationTarget').mockRejectedValue(
          new ForbiddenException('Students and parents cannot create classrooms'),
        );

        await expect(
          service.create(ACTOR_STUDENT_ID, { name: 'Aula', schoolId: SCHOOL_ID }),
        ).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.school.findFirst).not.toHaveBeenCalled();
        expectNoWrites();
      });

      it('creates an independent teacher classroom atomically with default pet, 12 desks (1..12), and default controls', async () => {
        vi.spyOn(accessService, 'resolveClassroomCreationTarget').mockResolvedValue({
          schoolId: null,
          independentTeacherId: ACTOR_TEACHER_ID,
          schoolRole: null,
          myRole: 'TEACHER',
          capabilities: computeClassroomCapabilities('TEACHER'),
        });
        stubProvisioning(
          classroomRow({
            name: 'Aula Particular Física',
            subject: 'Física I',
            independentTeacherId: ACTOR_TEACHER_ID,
          }),
        );

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

      it.each([
        [SchoolRole.OWNER, 'OWNER'],
        [SchoolRole.ADMIN, 'ADMIN'],
      ] as const)(
        'creates a school classroom for School %s without creating a ClassroomMembership row',
        async (schoolRole, myRole) => {
          vi.spyOn(accessService, 'resolveClassroomCreationTarget').mockResolvedValue({
            schoolId: SCHOOL_ID,
            independentTeacherId: null,
            schoolRole,
            myRole,
            capabilities: computeClassroomCapabilities(myRole),
          });
          stubProvisioning(classroomRow({ schoolId: SCHOOL_ID }));

          const result = await service.create(ACTOR_OWNER_ID, { name: '1° Año A' });

          expect(result.schoolId).toBe(SCHOOL_ID);
          expect(result.independentTeacherId).toBeNull();
          expect(result.myRole).toBe(myRole);
          expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
        },
      );

      it('creates a school classroom for School TEACHER and records ClassroomMembership(TEACHER)', async () => {
        vi.spyOn(accessService, 'resolveClassroomCreationTarget').mockResolvedValue({
          schoolId: SCHOOL_ID,
          independentTeacherId: null,
          schoolRole: SchoolRole.TEACHER,
          myRole: 'TEACHER',
          capabilities: computeClassroomCapabilities('TEACHER'),
        });
        stubProvisioning(classroomRow({ schoolId: SCHOOL_ID, subject: 'Historia' }));
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

      it('rejects a target that violates the exactly-one-organization invariant before writing', async () => {
        vi.spyOn(accessService, 'resolveClassroomCreationTarget').mockResolvedValue({
          schoolId: SCHOOL_ID,
          independentTeacherId: ACTOR_TEACHER_ID,
          schoolRole: SchoolRole.OWNER,
          myRole: 'OWNER',
          capabilities: computeClassroomCapabilities('OWNER'),
        });

        await expect(service.create(ACTOR_OWNER_ID, { name: 'Aula' })).rejects.toThrow(
          BadRequestException,
        );
        expectNoWrites();
      });
    });

    describe('listForActor()', () => {
      it('takes accessible classrooms, myRole and capabilities from the shared access service', async () => {
        const list = vi.spyOn(accessService, 'listAccessibleClassrooms').mockResolvedValue({
          total: 1,
          items: [
            {
              classroom: {
                id: CLASSROOM_ID,
                name: 'Aula',
                subject: null,
                schoolId: SCHOOL_ID,
                independentTeacherId: null,
                adultMode: false,
                chatMuted: false,
                collaborationLocked: false,
                gamesDisabled: false,
                deletedAt: null,
                createdAt: now,
                updatedAt: now,
              },
              myRole: 'ADMIN',
              capabilities: computeClassroomCapabilities('ADMIN'),
            },
          ],
        });

        const result = await service.listForActor(ACTOR_ADMIN_ID, {
          page: 2,
          pageSize: 5,
          sort: { field: 'name', direction: 'asc' },
        });

        expect(list).toHaveBeenCalledWith(ACTOR_ADMIN_ID, {
          skip: 5,
          take: 5,
          sort: { field: 'name', direction: 'asc' },
        });
        expect(result).toMatchObject({ page: 2, pageSize: 5, total: 1 });
        expect(result).not.toHaveProperty('limit');
        expect(result).not.toHaveProperty('totalPages');
        expect(result.items[0]).toMatchObject({
          id: CLASSROOM_ID,
          myRole: 'ADMIN',
          capabilities: computeClassroomCapabilities('ADMIN'),
        });
        expect(mockPrisma.classroom.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.schoolMember.findMany).not.toHaveBeenCalled();
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

      it('rejects an empty update with 400 VALIDATION_FAILED and performs no lookup or write', async () => {
        const failure = await service.update(ACTOR_TEACHER_ID, CLASSROOM_ID, {}).catch((e) => e);

        expect(failure).toBeInstanceOf(RequestValidationException);
        expect((failure as RequestValidationException).details).toEqual([
          { field: 'body', messages: [expect.stringContaining('at least one')] },
        ]);
        expect(mockPrisma.classroom.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.classroom.update).not.toHaveBeenCalled();
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
