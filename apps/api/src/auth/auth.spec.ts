import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('Auth / Registration (HU-AUT-001)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let isDbAvailable = false;

  beforeAll(async () => {
    // 1. Mock eager connection on boot so app.init() succeeds in environments without live DB
    vi.spyOn(PrismaService.prototype, 'onModuleInit').mockImplementation(async () => undefined);

    // 2. Setup Nest testing application with global validation and error filters
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [AuthController],
      providers: [AuthService],
    }).compile();

    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();

    // 3. Setup real Prisma connection for database verification and atomicity tests
    const globalProcess = (
      globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    const dbUrl =
      globalProcess?.env?.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public';

    prisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });

    try {
      await prisma.$connect();
      isDbAvailable = true;
      await app.get(PrismaService).$connect();
    } catch {
      isDbAvailable = false;
    }
  });

  afterAll(async () => {
    await app?.close();
    if (isDbAvailable) {
      await prisma.$disconnect();
    }
  });

  describe('Validation & Contract (HTTP)', () => {
    it('returns 400 VALIDATION_FAILED when email is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalid-email-format',
          password: 'passwordSegura123',
          displayName: 'Docente Test',
          path: RegistrationPath.INDEPENDENT_TEACHER,
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
      );
    });

    it('returns 400 VALIDATION_FAILED when password is shorter than 8 characters', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'valido@example.com',
          password: 'short',
          displayName: 'Docente Test',
          path: RegistrationPath.INDEPENDENT_TEACHER,
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
      );
    });

    it('returns 400 VALIDATION_FAILED when displayName is missing or empty', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'valido@example.com',
          password: 'passwordSegura123',
          displayName: '   ',
          path: RegistrationPath.INDEPENDENT_TEACHER,
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'displayName' })]),
      );
    });

    it('returns 400 VALIDATION_FAILED when path is SCHOOL but schoolName is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'valido@example.com',
          password: 'passwordSegura123',
          displayName: 'Director Test',
          path: RegistrationPath.SCHOOL,
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'schoolName' })]),
      );
    });

    it('returns 400 VALIDATION_FAILED when path is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'valido@example.com',
          password: 'passwordSegura123',
          displayName: 'Test User',
          path: 'INVALID_PATH',
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'path' })]),
      );
    });
  });

  describe('Database & Domain Logic (Integration)', () => {
    const createdUserIds: string[] = [];
    const createdSchoolIds: string[] = [];

    afterAll(async () => {
      if (!isDbAvailable) return;

      if (createdSchoolIds.length > 0) {
        await prisma.schoolMember.deleteMany({
          where: { schoolId: { in: createdSchoolIds } },
        });
        await prisma.school.deleteMany({
          where: { id: { in: createdSchoolIds } },
        });
      }

      if (createdUserIds.length > 0) {
        await prisma.avatarConfiguration.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    });

    it.skipIf(!isDbAvailable)(
      'registers an independent teacher atomically with hashed password and avatar config',
      async () => {
        const email = `independent.${Date.now()}@example.com`;
        const rawPassword = 'superSecretPassword123';

        const res = await request(app.getHttpServer())
          .post('/auth/register')
          .send({
            email,
            password: rawPassword,
            displayName: 'Profesor Independiente',
            path: RegistrationPath.INDEPENDENT_TEACHER,
          })
          .expect(201);

        expect(res.body.id).toBeDefined();
        expect(res.body.email).toBe(email);
        expect(res.body.displayName).toBe('Profesor Independiente');
        expect(res.body.path).toBe(RegistrationPath.INDEPENDENT_TEACHER);
        expect(res.body.school).toBeUndefined();
        expect(res.body.createdAt).toBeDefined();

        // Ensure sensitive data is NEVER returned
        expect(res.body.password).toBeUndefined();
        expect(res.body.passwordHash).toBeUndefined();

        createdUserIds.push(res.body.id);

        // Verify records in Database
        const dbUser = await prisma.user.findUnique({
          where: { id: res.body.id },
          include: { avatarConfig: true, schoolMemberships: true },
        });

        expect(dbUser).toBeDefined();
        expect(dbUser?.email).toBe(email);
        expect(dbUser?.avatarConfig).toBeDefined();
        expect(dbUser?.schoolMemberships).toHaveLength(0);

        // Verify password was hashed with bcrypt
        expect(dbUser?.passwordHash).not.toBe(rawPassword);
        expect(dbUser?.passwordHash).toMatch(/^\$2[aby]\$\d+\$/);
        const isPasswordValid = await bcrypt.compare(rawPassword, dbUser!.passwordHash);
        expect(isPasswordValid).toBe(true);
      },
    );

    it.skipIf(!isDbAvailable)(
      'registers a school path atomically with School, Owner membership and avatar config',
      async () => {
        const email = `school.owner.${Date.now()}@example.com`;
        const rawPassword = 'schoolOwnerPassword123';
        const schoolName = 'Colegio San Martín';

        const res = await request(app.getHttpServer())
          .post('/auth/register')
          .send({
            email,
            password: rawPassword,
            displayName: 'Directora San Martín',
            path: RegistrationPath.SCHOOL,
            schoolName,
          })
          .expect(201);

        expect(res.body.id).toBeDefined();
        expect(res.body.email).toBe(email);
        expect(res.body.displayName).toBe('Directora San Martín');
        expect(res.body.path).toBe(RegistrationPath.SCHOOL);
        expect(res.body.school).toBeDefined();
        expect(res.body.school.name).toBe(schoolName);
        expect(res.body.school.slug).toMatch(/^colegio-san-martin/);
        expect(res.body.school.timeZone).toBe('America/Argentina/Buenos_Aires');

        createdUserIds.push(res.body.id);
        createdSchoolIds.push(res.body.school.id);

        // Verify records in Database
        const dbUser = await prisma.user.findUnique({
          where: { id: res.body.id },
          include: {
            avatarConfig: true,
            schoolMemberships: {
              include: { school: true },
            },
          },
        });

        expect(dbUser).toBeDefined();
        expect(dbUser?.avatarConfig).toBeDefined();
        expect(dbUser?.schoolMemberships).toHaveLength(1);
        expect(dbUser?.schoolMemberships[0].role).toBe('OWNER');
        expect(dbUser?.schoolMemberships[0].state).toBe('ACTIVE');
        expect(dbUser?.schoolMemberships[0].school.name).toBe(schoolName);
        expect(dbUser?.schoolMemberships[0].school.timeZone).toBe('America/Argentina/Buenos_Aires');
      },
    );

    it.skipIf(!isDbAvailable)(
      'rejects duplicate email after normalization (case-insensitive) with 409 CONFLICT',
      async () => {
        const baseEmail = `unique.student.${Date.now()}@example.com`;

        // 1. Initial registration
        const firstRes = await request(app.getHttpServer())
          .post('/auth/register')
          .send({
            email: baseEmail,
            password: 'passwordSegura123',
            displayName: 'Alumno Primero',
            path: RegistrationPath.INDEPENDENT_TEACHER,
          })
          .expect(201);

        createdUserIds.push(firstRes.body.id);

        // 2. Duplicate registration with different casing and whitespace
        const duplicateRes = await request(app.getHttpServer())
          .post('/auth/register')
          .send({
            email: `  ${baseEmail.toUpperCase()}  `,
            password: 'anotherPassword123',
            displayName: 'Alumno Duplicado',
            path: RegistrationPath.INDEPENDENT_TEACHER,
          })
          .expect(409);

        expect(duplicateRes.body.error.code).toBe('CONFLICT');
      },
    );

    it.skipIf(!isDbAvailable)(
      'enforces atomicity: rolls back all changes if any part of the transaction fails (failure injection)',
      async () => {
        const failingEmail = `atomic.fail.${Date.now()}@example.com`;
        const authService = app.get(AuthService);
        const prismaService = app.get(PrismaService);

        // Intercept $transaction on the injected PrismaService used by AuthService
        const originalTx = prismaService.$transaction.bind(prismaService);
        const transactionSpy = vi
          .spyOn(prismaService, '$transaction')
          .mockImplementation(async (callback: unknown) => {
            return originalTx(async (tx) => {
              // Let the callback execute, but intercept and inject failure after user creation
              await (callback as (client: typeof tx) => Promise<unknown>)(tx);
              throw new Error('Simulated failure during transaction commit');
            });
          });

        try {
          await expect(
            authService.register({
              email: failingEmail,
              password: 'passwordSegura123',
              displayName: 'Usuario Atómico',
              path: RegistrationPath.INDEPENDENT_TEACHER,
            }),
          ).rejects.toThrow('Simulated failure during transaction commit');
        } finally {
          transactionSpy.mockRestore();
        }

        // Assert that User was NOT persisted due to transaction rollback
        const persistedUser = await prisma.user.findFirst({
          where: { email: failingEmail },
        });

        expect(persistedUser).toBeNull();
      },
    );
  });
});
