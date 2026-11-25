import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { authTestConfig } from './testing/auth-test-config';

describe('INVITEE Public API Onboarding Integration (Issue #133)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdUserIds: string[] = [];
  const createdSchoolIds: string[] = [];
  const createdClassroomIds: string[] = [];

  let teacherToken = '';
  let targetClassroomId = '';
  let foreignClassroomId = '';

  const registerAndLoginTeacher = async (
    prefix: string,
    path: RegistrationPath,
    schoolName?: string,
  ): Promise<{ userId: string; accessToken: string; schoolId?: string }> => {
    const email = `invitee.e2e.${prefix}.${Date.now()}@example.edu.ar`;
    const password = 'TeacherPassword123!';
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        displayName: `Docente ${prefix}`,
        path,
        ...(schoolName ? { schoolName } : {}),
      })
      .expect(201);

    createdUserIds.push(regRes.body.id);
    if (regRes.body.school?.id) {
      createdSchoolIds.push(regRes.body.school.id);
    }

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return {
      userId: regRes.body.id,
      accessToken: loginRes.body.accessToken,
      schoolId: regRes.body.school?.id,
    };
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig())],
    }).compile();

    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.$connect();

    const targetTeacher = await registerAndLoginTeacher(
      'target-teacher',
      RegistrationPath.INDEPENDENT_TEACHER,
    );
    teacherToken = targetTeacher.accessToken;

    const targetRoomRes = await request(app.getHttpServer())
      .post('/classrooms')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ name: 'Matemática 3ro INVITEE', subject: 'Álgebra' })
      .expect(201);
    targetClassroomId = targetRoomRes.body.id;
    createdClassroomIds.push(targetClassroomId);

    const foreignOwner = await registerAndLoginTeacher(
      'foreign-owner',
      RegistrationPath.SCHOOL,
      `Colegio Externo ${Date.now()}`,
    );
    const foreignRoomRes = await request(app.getHttpServer())
      .post('/classrooms')
      .set('Authorization', `Bearer ${foreignOwner.accessToken}`)
      .send({ name: 'Aula Ajena', schoolId: foreignOwner.schoolId })
      .expect(201);
    foreignClassroomId = foreignRoomRes.body.id;
    createdClassroomIds.push(foreignClassroomId);
  }, 30_000);

  afterAll(async () => {
    if (prisma) {
      if (createdUserIds.length > 0) {
        await prisma.notificationDelivery.deleteMany({
          where: { notification: { recipientId: { in: createdUserIds } } },
        });
        await prisma.notification.deleteMany({
          where: { recipientId: { in: createdUserIds } },
        });
      }

      if (createdClassroomIds.length > 0) {
        await prisma.joinCodeUsage.deleteMany({
          where: { invitation: { classroomId: { in: createdClassroomIds } } },
        });
        await prisma.invitation.deleteMany({
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
        await prisma.session.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.avatarConfiguration.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    }

    await app?.close();
  });

  it('issues working protected-API session on INVITEE registration with zero initial privileges until redeeming a join code', async () => {
    const email = `invitee.code.${Date.now()}@example.edu.ar`;
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password: 'StudentPassword123!',
        displayName: 'Alumno JoinCode',
        path: RegistrationPath.INVITEE,
      })
      .expect(201);

    createdUserIds.push(regRes.body.id);
    const accessToken = regRes.body.session?.accessToken as string;
    expect(typeof accessToken).toBe('string');

    // Returned credentials work immediately on protected endpoints.
    const meRes = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(meRes.body).toMatchObject({
      id: regRes.body.id,
      email,
      displayName: 'Alumno JoinCode',
    });

    const initialClassrooms = await request(app.getHttpServer())
      .get('/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(initialClassrooms.body.items).toEqual([]);

    // Zero initial privileges: cannot create classrooms or view unrelated/unjoined classrooms.
    await request(app.getHttpServer())
      .post('/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Unauthorized Room' })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/classrooms/${foreignClassroomId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/classrooms/${targetClassroomId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    // Redeem a valid join code using the registration session directly.
    const joinCodeRes = await request(app.getHttpServer())
      .post(`/classrooms/${targetClassroomId}/join-code`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ maxUses: 5, expiresInSeconds: 3600 })
      .expect(201);

    const joinRes = await request(app.getHttpServer())
      .post('/classrooms/join')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: joinCodeRes.body.code })
      .expect(201);

    expect(joinRes.body).toMatchObject({
      classroomId: targetClassroomId,
      role: 'STUDENT',
    });

    // Joined classroom is readable only with STUDENT role; unrelated classrooms and staff endpoints remain denied.
    const detailRes = await request(app.getHttpServer())
      .get(`/classrooms/${targetClassroomId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(detailRes.body.myRole).toBe('STUDENT');
    expect(detailRes.body.capabilities).not.toContain('configure_classroom');

    await request(app.getHttpServer())
      .get(`/classrooms/${foreignClassroomId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post('/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Still Unauthorized' })
      .expect(403);
  });

  it('permits redeeming a valid email invitation directly with the registration session and grants only STUDENT role in that classroom', async () => {
    const invitedEmail = `invitee.email.${Date.now()}@example.edu.ar`;
    const invRes = await request(app.getHttpServer())
      .post(`/classrooms/${targetClassroomId}/invitations`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ email: invitedEmail, role: 'STUDENT' })
      .expect(201);

    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: invitedEmail,
        password: 'StudentPassword123!',
        displayName: 'Alumna Invitada',
        path: RegistrationPath.INVITEE,
      })
      .expect(201);

    createdUserIds.push(regRes.body.id);
    const accessToken = regRes.body.session?.accessToken as string;
    expect(typeof accessToken).toBe('string');

    const acceptRes = await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ token: invRes.body.token })
      .expect(200);

    expect(acceptRes.body).toMatchObject({
      classroomId: targetClassroomId,
      role: 'STUDENT',
    });

    const detailRes = await request(app.getHttpServer())
      .get(`/classrooms/${targetClassroomId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(detailRes.body.myRole).toBe('STUDENT');

    await request(app.getHttpServer())
      .get(`/classrooms/${foreignClassroomId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post('/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Still Unauthorized' })
      .expect(403);
  });
});
