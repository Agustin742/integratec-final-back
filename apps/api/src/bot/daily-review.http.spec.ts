import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  ClassroomRole,
  MaterialIndexState,
  RegistrationPath,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { toLocalDay } from '../gamification/local-day';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import {
  DAILY_REVIEW_INFERENCE_PORT,
  type DailyReviewInferencePort,
} from './daily-review-inference.port';

const databaseUrl = loadIsolatedTestDatabaseUrl();

// Public HTTP + real isolated PostgreSQL + faked session verification. No real
// sessions, environment-file loader, or provider network: the inference port is
// not exercised by the delivery semantics covered here (it gets its own specs
// with a fake provider in the composition and question slices).
describe('daily review delivery — issue #42 / HU-BOT-003', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const [
    teacher,
    student,
    reloadStudent,
    concurrentStudent,
    boundaryStudent,
    parent,
    stranger,
    examStudent,
    composeStudent,
    composeTeacher,
    generatedStudent,
    failedStudent,
    nullStudent,
    queueStudent,
    questionStudent,
    wrongStudent,
    capStudent,
    raceStudent,
    genFailStudent,
    invalidStudent,
    noMaterialStudent,
  ] = Array.from({ length: 21 }, () => randomUUID());
  const [
    classroom,
    reloadClassroom,
    concurrentClassroom,
    boundaryClassroom,
    examClassroom,
    composeClassroom,
    teachClassroom,
    generatedClassroom,
    failedClassroom,
    nullClassroom,
    questionClassroom,
    genFailClassroom,
    invalidClassroom,
    noMaterialClassroom,
  ] = Array.from({ length: 14 }, () => randomUUID());
  const users: string[] = [
    teacher,
    student,
    reloadStudent,
    concurrentStudent,
    boundaryStudent,
    parent,
    stranger,
    examStudent,
    composeStudent,
    composeTeacher,
    generatedStudent,
    failedStudent,
    nullStudent,
    queueStudent,
    questionStudent,
    wrongStudent,
    capStudent,
    raceStudent,
    genFailStudent,
    invalidStudent,
    noMaterialStudent,
  ];

  const path = () => '/users/me/daily-review';
  const get = (actor: string | null) => {
    const call = request(app.getHttpServer()).get(path());
    return actor === null ? call : call.set('Authorization', `Bearer daily-review:${actor}`);
  };
  const postAnswer = (actor: string, body: { questionId: string; answer: string }) =>
    request(app.getHttpServer())
      .post(`${path()}/daily-question`)
      .set('Authorization', `Bearer daily-review:${actor}`)
      .send(body);
  const deliveries = (userId: string) => prisma.dailyReviewDelivery.count({ where: { userId } });
  const qualifyingDays = (userId: string) =>
    prisma.streakQualifyingDay.count({ where: { studentId: userId } });

  // Fake provider port (rules/ai-bot-and-daily-briefing.md: provider calls in tests
  // MUST use fakes). Summary default is the invalid-output path; two users exercise
  // the generated and the throwing paths. The question path has its own default plus
  // null/invalid users so delivery and question semantics stay observable.
  const GENERATED_SUMMARY = 'Tenés dos actividades pendientes y una nota nueva.';
  const QUESTION = {
    prompt: '¿Cuál organelo realiza la fotosíntesis?',
    options: ['Cloroplasto', 'Mitocondria'],
    correctOption: 'Cloroplasto',
    materialTitle: 'Guía de fotosíntesis.pdf',
  };
  const inferenceFake: DailyReviewInferencePort = {
    generateSummary: async (input) => {
      if (input.userId === generatedStudent) return GENERATED_SUMMARY;
      if (input.userId === failedStudent) throw new Error('synthetic provider outage');
      return null;
    },
    generateDailyQuestion: async (input) => {
      if (input.userId === genFailStudent) return null;
      if (input.userId === invalidStudent) {
        // Hard-validation case: correctOption not among the options.
        return { ...QUESTION, correctOption: 'Núcleo' };
      }
      return { ...QUESTION };
    },
  };

  // Assigned in beforeAll with fixed offsets so ordering assertions are deterministic.
  let pendingFirstDue = new Date();
  let pendingSecondDue = new Date();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl, dailyQuestionMaxAttempts: 3 }))],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (!header?.startsWith('Bearer daily-review:')) throw new UnauthorizedException();
          const userId = header.slice('Bearer daily-review:'.length);
          if (!users.includes(userId)) throw new UnauthorizedException();
          return { userId, sessionId: randomUUID() };
        },
      })
      .overrideProvider(DAILY_REVIEW_INFERENCE_PORT)
      .useValue(inferenceFake)
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);

    const now = new Date();
    // Fixed instants so section ordering assertions are deterministic.
    pendingFirstDue = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    pendingSecondDue = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const gradedDueAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const gradedAt = new Date(now.getTime() - 30_000);
    const announcementAt = new Date(now.getTime() - 60_000);
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: 'Synthetic daily-review participant',
          email: `daily-review-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          classroom,
          reloadClassroom,
          concurrentClassroom,
          boundaryClassroom,
          examClassroom,
        ].map((id) => ({ id, name: `Daily review ${id}`, independentTeacherId: teacher })),
      });
      await tx.classroom.createMany({
        data: [
          { id: composeClassroom, name: 'Biología 3°B', independentTeacherId: teacher },
          { id: teachClassroom, name: 'Química 5°A', independentTeacherId: composeTeacher },
          { id: generatedClassroom, name: 'Matemática 1°C', independentTeacherId: teacher },
          { id: failedClassroom, name: 'Historia 2°A', independentTeacherId: teacher },
          { id: nullClassroom, name: 'Geografía 4°B', independentTeacherId: teacher },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroom, userId: student, role: ClassroomRole.STUDENT },
          { classroomId: reloadClassroom, userId: reloadStudent, role: ClassroomRole.STUDENT },
          {
            classroomId: concurrentClassroom,
            userId: concurrentStudent,
            role: ClassroomRole.STUDENT,
          },
          {
            classroomId: boundaryClassroom,
            userId: boundaryStudent,
            role: ClassroomRole.STUDENT,
          },
          { classroomId: examClassroom, userId: examStudent, role: ClassroomRole.STUDENT },
          { classroomId: composeClassroom, userId: composeStudent, role: ClassroomRole.STUDENT },
          { classroomId: teachClassroom, userId: queueStudent, role: ClassroomRole.STUDENT },
          {
            classroomId: generatedClassroom,
            userId: generatedStudent,
            role: ClassroomRole.STUDENT,
          },
          { classroomId: failedClassroom, userId: failedStudent, role: ClassroomRole.STUDENT },
          { classroomId: nullClassroom, userId: nullStudent, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.create({
        data: { classroomId: classroom, parentId: parent, childId: student },
      });
      await tx.activity.create({
        data: {
          classroomId: examClassroom,
          createdById: teacher,
          type: ActivityType.EXAM,
          format: ActivityFormat.MULTIPLE_CHOICE,
          state: ActivityState.PUBLISHED,
          title: 'Synthetic exam in progress',
          dueAt: new Date(now.getTime() + 30 * 60 * 1000),
          opensAt: new Date(now.getTime() - 30 * 60 * 1000),
          publishedAt: now,
          maxScore: 100,
        },
      });
      // Composition fixtures (S2): two pending activities (nearest first), one
      // graded submission and one newer announcement in the compose student's classroom.
      await tx.activity.createMany({
        data: [
          {
            classroomId: composeClassroom,
            createdById: teacher,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            title: 'TP Fotosíntesis',
            dueAt: pendingFirstDue,
            publishedAt: now,
            maxScore: 10,
          },
          {
            classroomId: composeClassroom,
            createdById: teacher,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            title: 'Lectura del capítulo 4',
            dueAt: pendingSecondDue,
            publishedAt: now,
            maxScore: 10,
          },
        ],
      });
      const gradedActivity = await tx.activity.create({
        data: {
          classroomId: composeClassroom,
          createdById: teacher,
          type: ActivityType.TP,
          format: ActivityFormat.FILE,
          state: ActivityState.PUBLISHED,
          title: 'Leyes de Newton',
          dueAt: gradedDueAt,
          publishedAt: now,
          maxScore: 10,
        },
        select: { id: true },
      });
      const gradedSubmission = await tx.submission.create({
        data: {
          activityId: gradedActivity.id,
          studentId: composeStudent,
          submittedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          idempotencyKey: randomUUID(),
        },
        select: { id: true },
      });
      await tx.grade.create({
        data: {
          submissionId: gradedSubmission.id,
          graderId: teacher,
          score: 8,
          feedback: 'Bien resuelto.',
          activityTitle: 'Leyes de Newton',
          maxScore: 10,
          pointsAwarded: 8,
          typeWeight: 1,
          weightMultiplier: 1,
          gradedAt,
        },
      });
      await tx.announcement.create({
        data: {
          classroomId: composeClassroom,
          authorId: teacher,
          title: 'Viaje al museo',
          content: 'Synthetic reminder about the museum trip next week.',
          createdAt: announcementAt,
        },
      });
      // Teacher fixtures: one ungraded submission in the queue and one announcement.
      const queueActivity = await tx.activity.create({
        data: {
          classroomId: teachClassroom,
          createdById: composeTeacher,
          type: ActivityType.TP,
          format: ActivityFormat.FILE,
          state: ActivityState.PUBLISHED,
          title: 'Parcial de química',
          dueAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
          publishedAt: now,
          maxScore: 10,
        },
        select: { id: true },
      });
      await tx.submission.create({
        data: {
          activityId: queueActivity.id,
          studentId: queueStudent,
          submittedAt: new Date(now.getTime() - 45 * 60 * 1000),
          idempotencyKey: randomUUID(),
        },
      });
      await tx.announcement.create({
        data: {
          classroomId: teachClassroom,
          authorId: composeTeacher,
          title: 'Recordatorio de laboratorio',
          content: 'Synthetic lab reminder.',
          createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        },
      });
      // Daily-question fixtures (S3/S7): classrooms with enabled bot material, so the
      // question students, the race student and the failure students have a source.
      await tx.classroom.createMany({
        data: [
          { id: questionClassroom, name: 'Botánica 6°A', independentTeacherId: teacher },
          { id: genFailClassroom, name: 'Física 4°C', independentTeacherId: teacher },
          { id: invalidClassroom, name: 'Historia 5°B', independentTeacherId: teacher },
          { id: noMaterialClassroom, name: 'Música 1°A', independentTeacherId: teacher },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: questionClassroom, userId: questionStudent, role: ClassroomRole.STUDENT },
          { classroomId: questionClassroom, userId: wrongStudent, role: ClassroomRole.STUDENT },
          { classroomId: questionClassroom, userId: capStudent, role: ClassroomRole.STUDENT },
          { classroomId: questionClassroom, userId: raceStudent, role: ClassroomRole.STUDENT },
          { classroomId: genFailClassroom, userId: genFailStudent, role: ClassroomRole.STUDENT },
          {
            classroomId: invalidClassroom,
            userId: invalidStudent,
            role: ClassroomRole.STUDENT,
          },
          {
            classroomId: noMaterialClassroom,
            userId: noMaterialStudent,
            role: ClassroomRole.STUDENT,
          },
        ],
      });
      const enableBotMaterial = async (classroomId: string, filename: string) => {
        const config = await tx.botConfig.create({
          data: { classroomId },
          select: { id: true },
        });
        const material = await tx.studyMaterial.create({
          data: {
            classroomId,
            authorId: teacher,
            objectKey: `synthetic/${classroomId}/${randomUUID()}`,
            filename,
            contentType: 'application/pdf',
            sizeBytes: 1024,
          },
          select: { id: true },
        });
        await tx.allowedMaterial.create({
          data: {
            botConfigId: config.id,
            classroomId,
            materialId: material.id,
            indexState: MaterialIndexState.INDEXED,
          },
        });
      };
      await enableBotMaterial(questionClassroom, 'Guía de fotosíntesis.pdf');
      await enableBotMaterial(genFailClassroom, 'Apunte de ondas.pdf');
      await enableBotMaterial(invalidClassroom, 'Revolución de Mayo.pdf');
    });
  }, 30_000);
  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication', async () => {
    await get(null).expect(401);
  });

  it('delivers the review once on the first authenticated student access of the local day', async () => {
    const response = await get(student).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'STUDENT',
      contentKind: 'structured',
      summary: null,
      sections: [],
      dailyQuestion: null,
    });
    expect(await deliveries(student)).toBe(1);
    const [delivery] = await prisma.dailyReviewDelivery.findMany({
      where: { userId: student },
    });
    expect(delivery.contentKind).toBe('STRUCTURED');
    expect(delivery.localDay).toBe(toLocalDay(new Date()));
  });

  it('answers not_due on reload within the same local day and keeps exactly one delivery', async () => {
    await get(reloadStudent).expect(200);
    const second = await get(reloadStudent).expect(200);
    expect(second.body).toEqual({ status: 'not_due' });
    expect(await deliveries(reloadStudent)).toBe(1);
  });

  it('delivers exactly once under concurrent first connections', async () => {
    const responses = await Promise.all([
      get(concurrentStudent),
      get(concurrentStudent),
      get(concurrentStudent),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const statuses = responses.map((r) => r.body.status).sort();
    expect(statuses).toEqual(['due', 'not_due', 'not_due']);
    expect(await deliveries(concurrentStudent)).toBe(1);
  });

  it('a delivered past local day does not block today (Buenos Aires day boundary)', async () => {
    const yesterday = toLocalDay(new Date(Date.now() - 36 * 60 * 60 * 1000));
    await prisma.dailyReviewDelivery.create({
      data: { userId: boundaryStudent, localDay: yesterday, contentKind: 'STRUCTURED' },
    });
    const response = await get(boundaryStudent).expect(200);
    expect(response.body.status).toBe('due');
    expect(await deliveries(boundaryStudent)).toBe(2);
  });

  it('parents never receive the review and consume no delivery', async () => {
    const response = await get(parent).expect(200);
    expect(response.body).toEqual({ status: 'not_due' });
    expect(await deliveries(parent)).toBe(0);
  });

  it('a user with no classroom access receives not_due', async () => {
    const response = await get(stranger).expect(200);
    expect(response.body).toEqual({ status: 'not_due' });
    expect(await deliveries(stranger)).toBe(0);
  });

  it('teachers receive the review with TEACHER audience and no daily question', async () => {
    const response = await get(teacher).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'TEACHER',
      dailyQuestion: null,
    });
    expect(await deliveries(teacher)).toBe(1);
  });

  it('a student with an exam in progress does not consume the delivery', async () => {
    const response = await get(examStudent).expect(200);
    expect(response.body).toEqual({ status: 'not_due' });
    expect(await deliveries(examStudent)).toBe(0);
  });

  it('composes the student review from activities, grades and announcements', async () => {
    const response = await get(composeStudent).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'STUDENT',
      contentKind: 'structured',
      summary: null,
      dailyQuestion: null,
    });
    expect(response.body.sections).toEqual([
      {
        kind: 'pending',
        items: [
          {
            kind: 'pending_activity',
            title: 'TP Fotosíntesis',
            classroomName: 'Biología 3°B',
            dueAt: pendingFirstDue.toISOString(),
            detail: null,
          },
          {
            kind: 'pending_activity',
            title: 'Lectura del capítulo 4',
            classroomName: 'Biología 3°B',
            dueAt: pendingSecondDue.toISOString(),
            detail: null,
          },
        ],
      },
      {
        kind: 'news',
        items: [
          {
            kind: 'recent_grade',
            title: 'Leyes de Newton',
            classroomName: 'Biología 3°B',
            dueAt: null,
            detail: '8/10',
          },
          {
            kind: 'announcement',
            title: 'Viaje al museo',
            classroomName: 'Biología 3°B',
            dueAt: null,
            detail: null,
          },
        ],
      },
    ]);
    expect(await deliveries(composeStudent)).toBe(1);
  });

  it('composes the teacher review from the ungraded queue and announcements', async () => {
    const response = await get(composeTeacher).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'TEACHER',
      contentKind: 'structured',
      summary: null,
      dailyQuestion: null,
    });
    expect(response.body.sections).toEqual([
      {
        kind: 'pending',
        items: [
          {
            kind: 'teacher_review',
            title: 'Parcial de química',
            classroomName: 'Química 5°A',
            dueAt: null,
            detail: null,
          },
        ],
      },
      {
        kind: 'news',
        items: [
          {
            kind: 'announcement',
            title: 'Recordatorio de laboratorio',
            classroomName: 'Química 5°A',
            dueAt: null,
            detail: null,
          },
        ],
      },
    ]);
    expect(await deliveries(composeTeacher)).toBe(1);
  });

  it('returns the generated summary and records a GENERATED delivery', async () => {
    const response = await get(generatedStudent).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'STUDENT',
      contentKind: 'generated',
      summary: GENERATED_SUMMARY,
    });
    expect(await deliveries(generatedStudent)).toBe(1);
    const [delivery] = await prisma.dailyReviewDelivery.findMany({
      where: { userId: generatedStudent },
    });
    expect(delivery.contentKind).toBe('GENERATED');
    // Privacy decision L3: the generated text is never persisted anywhere else.
    expect(delivery).not.toHaveProperty('summary');
  });

  it('falls back to the structured review when the provider call throws', async () => {
    const response = await get(failedStudent).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'STUDENT',
      contentKind: 'structured',
      summary: null,
      dailyQuestion: null,
    });
    expect(await deliveries(failedStudent)).toBe(1);
    const [delivery] = await prisma.dailyReviewDelivery.findMany({
      where: { userId: failedStudent },
    });
    expect(delivery.contentKind).toBe('STRUCTURED');
  });

  it('falls back to the structured review on invalid provider output', async () => {
    const response = await get(nullStudent).expect(200);
    expect(response.body).toMatchObject({
      status: 'due',
      audience: 'STUDENT',
      contentKind: 'structured',
      summary: null,
    });
    expect(await deliveries(nullStudent)).toBe(1);
    const [delivery] = await prisma.dailyReviewDelivery.findMany({
      where: { userId: nullStudent },
    });
    expect(delivery.contentKind).toBe('STRUCTURED');
  });

  it('generates and persists the daily question on the student first GET', async () => {
    const response = await get(questionStudent).expect(200);
    expect(response.body).toMatchObject({ status: 'due', audience: 'STUDENT' });
    // Exact shape: the answer key must never be serialized to the student.
    expect(response.body.dailyQuestion).toEqual({
      id: expect.any(String),
      prompt: QUESTION.prompt,
      options: QUESTION.options,
      materialTitle: QUESTION.materialTitle,
    });
    const question = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { userId_localDay: { userId: questionStudent, localDay: toLocalDay(new Date()) } },
    });
    expect(question.id).toBe(response.body.dailyQuestion.id);
    expect(question.correctOption).toBe(QUESTION.correctOption);
    expect(question.answeredAt).toBeNull();
  });

  it('credits the streak once on a correct answer and marks the day answered', async () => {
    const question = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { userId_localDay: { userId: questionStudent, localDay: toLocalDay(new Date()) } },
      select: { id: true },
    });
    // Trim-tolerant comparison: whitespace never flips a correct answer.
    const response = await postAnswer(questionStudent, {
      questionId: question.id,
      answer: ` ${QUESTION.correctOption} `,
    }).expect(200);
    expect(response.body.correct).toBe(true);
    expect(typeof response.body.feedback).toBe('string');
    expect(response.body.feedback.length).toBeGreaterThan(0);
    expect(response.body.streak).toEqual({
      currentStreak: 1,
      bestStreak: 1,
      lastQualifiedDate: toLocalDay(new Date()),
    });
    expect(await qualifyingDays(questionStudent)).toBe(1);
    const [qualifying] = await prisma.streakQualifyingDay.findMany({
      where: { studentId: questionStudent },
    });
    expect(qualifying.source).toBe('DAILY_REVIEW_ANSWERED');
    const answered = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { id: question.id },
      select: { answeredAt: true },
    });
    expect(answered.answeredAt).not.toBeNull();
  });

  it('answers 409 CONFLICT on a repeat answer the same local day and keeps one credit', async () => {
    const question = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { userId_localDay: { userId: questionStudent, localDay: toLocalDay(new Date()) } },
      select: { id: true },
    });
    const response = await postAnswer(questionStudent, {
      questionId: question.id,
      answer: QUESTION.correctOption,
    }).expect(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(await qualifyingDays(questionStudent)).toBe(1);
  });

  it('does not credit a wrong answer and stays retryable', async () => {
    // First authenticated access of the day: generates and stores the question.
    await get(wrongStudent).expect(200);
    const question = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { userId_localDay: { userId: wrongStudent, localDay: toLocalDay(new Date()) } },
      select: { id: true },
    });
    const wrong = await postAnswer(wrongStudent, {
      questionId: question.id,
      answer: QUESTION.options[1],
    }).expect(200);
    expect(wrong.body.correct).toBe(false);
    expect(typeof wrong.body.feedback).toBe('string');
    expect(wrong.body.streak).toEqual({
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDate: null,
    });
    expect(await qualifyingDays(wrongStudent)).toBe(0);
    const afterWrong = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { id: question.id },
      select: { attempts: true },
    });
    expect(afterWrong.attempts).toBe(1);

    const corrected = await postAnswer(wrongStudent, {
      questionId: question.id,
      answer: QUESTION.correctOption,
    }).expect(200);
    expect(corrected.body.correct).toBe(true);
    expect(await qualifyingDays(wrongStudent)).toBe(1);
  });

  it('answers 429 and no credit once the attempt budget is spent', async () => {
    // First authenticated access of the day: generates and stores the question.
    await get(capStudent).expect(200);
    const question = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { userId_localDay: { userId: capStudent, localDay: toLocalDay(new Date()) } },
      select: { id: true },
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wrong = await postAnswer(capStudent, {
        questionId: question.id,
        answer: QUESTION.options[1],
      }).expect(200);
      expect(wrong.body.correct).toBe(false);
    }
    // Even the correct option is refused once the budget is spent.
    const capped = await postAnswer(capStudent, {
      questionId: question.id,
      answer: QUESTION.correctOption,
    }).expect(429);
    expect(capped.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(await qualifyingDays(capStudent)).toBe(0);
  });

  it('answers 404 for foreign question ids, malformed ids and parents', async () => {
    const foreign = await postAnswer(questionStudent, {
      questionId: randomUUID(),
      answer: QUESTION.correctOption,
    }).expect(404);
    expect(foreign.body.error.code).toBe('NOT_FOUND');

    const malformed = await postAnswer(questionStudent, {
      questionId: 'not-a-uuid',
      answer: QUESTION.correctOption,
    }).expect(404);
    expect(malformed.body.error.code).toBe('NOT_FOUND');

    const asParent = await postAnswer(parent, {
      questionId: randomUUID(),
      answer: QUESTION.correctOption,
    }).expect(404);
    expect(asParent.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.dailyReviewQuestion.count({ where: { userId: parent } })).toBe(0);
  });

  it('answers exactly one 200 correct under concurrent correct answers', async () => {
    // First authenticated access of the day: generates and stores the question.
    await get(raceStudent).expect(200);
    const question = await prisma.dailyReviewQuestion.findUniqueOrThrow({
      where: { userId_localDay: { userId: raceStudent, localDay: toLocalDay(new Date()) } },
      select: { id: true },
    });
    const responses = await Promise.all([
      postAnswer(raceStudent, { questionId: question.id, answer: QUESTION.correctOption }),
      postAnswer(raceStudent, { questionId: question.id, answer: QUESTION.correctOption }),
      postAnswer(raceStudent, { questionId: question.id, answer: QUESTION.correctOption }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const winner = responses.find((r) => r.status === 200);
    expect(winner?.body.correct).toBe(true);
    expect(await qualifyingDays(raceStudent)).toBe(1);
  });

  it('delivers without a daily question when generation fails', async () => {
    const response = await get(genFailStudent).expect(200);
    expect(response.body).toMatchObject({ status: 'due', audience: 'STUDENT' });
    expect(response.body.dailyQuestion).toBeNull();
    expect(await deliveries(genFailStudent)).toBe(1);
    expect(await prisma.dailyReviewQuestion.count({ where: { userId: genFailStudent } })).toBe(0);
  });

  it('rejects an invalid generated question without persisting it', async () => {
    const response = await get(invalidStudent).expect(200);
    expect(response.body).toMatchObject({ status: 'due', audience: 'STUDENT' });
    expect(response.body.dailyQuestion).toBeNull();
    expect(await prisma.dailyReviewQuestion.count({ where: { userId: invalidStudent } })).toBe(0);
  });

  it('delivers no daily question without enabled material', async () => {
    const response = await get(noMaterialStudent).expect(200);
    expect(response.body).toMatchObject({ status: 'due', audience: 'STUDENT' });
    expect(response.body.dailyQuestion).toBeNull();
    // The port is never called when there is no material to build a question from.
    expect(await prisma.dailyReviewQuestion.count({ where: { userId: noMaterialStudent } })).toBe(
      0,
    );
  });
});
