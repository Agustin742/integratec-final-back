import { randomUUID } from 'node:crypto';
import { type INestApplication, Logger, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  ClassroomRole,
  RegistrationPath,
  SchoolRole,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { STORAGE_PORT, type StoragePort } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';
import {
  AiProviderUnavailableError,
  CHAT_MODEL_PORT,
  EMBEDDING_MODEL_PORT,
  type ChatCompletionRequest,
  type ChatModelPort,
  type EmbeddingModelPort,
} from './ai-provider.ports';
import { BotMaterialsService } from './bot-materials.service';
import { buildMinimalPdf } from './testing/material-fixtures';

const databaseUrl = loadIsolatedTestDatabaseUrl();

function topicVector(text: string): number[] {
  const lower = text.toLowerCase();
  const vec = new Array<number>(768).fill(0);
  if (lower.includes('photosynthesis') || lower.includes('chloroplast')) vec[0] = 1;
  else vec[5] = 1;
  return vec;
}

describe('Study Guide Bot HTTP — issue #41 / HU-BOT-002', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let botMaterials: BotMaterialsService;

  const [
    teacher,
    student,
    departedStudent,
    parent,
    stranger,
    otherTeacher,
    owner,
    admin,
    schoolTeacher,
    otherSchoolTeacher,
  ] = Array.from({ length: 10 }, () => randomUUID());

  const [classroom, foreignClassroom, schoolClassroom, adultClassroom, emptyClassroom, school] =
    Array.from({ length: 6 }, () => randomUUID());

  const [materialId, foreignMaterialId, schoolMaterialId, draftExamId, tpId] = Array.from(
    { length: 5 },
    () => randomUUID(),
  );

  const users: string[] = [
    teacher,
    student,
    departedStudent,
    parent,
    stranger,
    otherTeacher,
    owner,
    admin,
    schoolTeacher,
    otherSchoolTeacher,
  ];

  const storageObjects = new Map<string, { body: Uint8Array; contentType: string }>();
  const capturedChatRequests: ChatCompletionRequest[] = [];
  let chatScript:
    | ((req: ChatCompletionRequest, step: number) => ReturnType<ChatModelPort['chatCompletion']>)
    | undefined;
  let chatStep = 0;

  const fakeStorage: StoragePort = {
    put: async (key, body, options) => {
      storageObjects.set(key, { body: Uint8Array.from(body), contentType: options.contentType });
    },
    get: async (key) => {
      const entry = storageObjects.get(key);
      if (!entry) throw new Error('Missing object');
      return entry;
    },
    delete: async () => undefined,
    getSignedDownloadUrl: async () => 'https://storage.example.invalid/signed',
  };

  const fakeEmbeddings: EmbeddingModelPort = {
    embed: async (texts) => ({
      vectors: texts.map(topicVector),
      totalTokens: texts.length * 8,
    }),
  };

  const fakeChat: ChatModelPort = {
    chatCompletion: async (req) => {
      capturedChatRequests.push(req);
      chatStep += 1;
      if (chatScript) {
        return chatScript(req, chatStep);
      }
      const hasToolResult = req.messages.some((message) => message.role === 'tool');
      if (!hasToolResult) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'call_rag_1',
              name: 'search_allowed_material',
              argumentsJson: JSON.stringify({ query: 'photosynthesis chloroplasts' }),
            },
          ],
          usage: { promptTokens: 40, completionTokens: 12 },
        };
      }
      return {
        content: 'Look at the enabled study guide about chloroplasts absorbing sunlight.',
        toolCalls: [],
        usage: { promptTokens: 90, completionTokens: 18 },
      };
    },
  };

  const api = (
    method: 'get' | 'post',
    actor: string | null,
    targetClassroom: string = classroom,
  ) => {
    const path =
      method === 'get'
        ? `/classrooms/${targetClassroom}/bot/status`
        : `/classrooms/${targetClassroom}/bot/messages`;
    const req = request(app.getHttpServer())[method](path);
    return actor ? req.set('Authorization', `Bearer bot-ask:${actor}`) : req;
  };

  beforeAll(async () => {
    storageObjects.set(`materials/${classroom}/${materialId}`, {
      body: buildMinimalPdf(['Photosynthesis converts sunlight inside plant chloroplasts.']),
      contentType: 'application/pdf',
    });
    storageObjects.set(`materials/${foreignClassroom}/${foreignMaterialId}`, {
      body: buildMinimalPdf(['Foreign classroom algebra guide.']),
      contentType: 'application/pdf',
    });
    storageObjects.set(`materials/${schoolClassroom}/${schoolMaterialId}`, {
      body: buildMinimalPdf(['Photosynthesis school unit notes.']),
      contentType: 'application/pdf',
    });

    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot(
          authTestConfig({
            databaseUrl,
            aiBotRateLimitWindowSeconds: 60,
            aiBotRateLimitUserMax: 40,
            aiBotRateLimitClassroomMax: 60,
            aiBotRateLimitGlobalMax: 120,
          }),
        ),
      ],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (!header?.startsWith('Bearer bot-ask:')) throw new UnauthorizedException();
          const userId = header.slice('Bearer bot-ask:'.length);
          if (!users.includes(userId)) throw new UnauthorizedException();
          return { userId, sessionId: randomUUID() };
        },
      })
      .overrideProvider(STORAGE_PORT)
      .useValue(fakeStorage)
      .overrideProvider(EMBEDDING_MODEL_PORT)
      .useValue(fakeEmbeddings)
      .overrideProvider(CHAT_MODEL_PORT)
      .useValue(fakeChat)
      .compile();

    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();

    prisma = app.get(PrismaService);
    botMaterials = app.get(BotMaterialsService);

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: 'Synthetic Bot Participant',
          email: `bot-ask-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.school.create({
        data: { id: school, name: 'Bot School', slug: `bot-ask-${school}` },
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
          { id: classroom, name: 'Bot Ask Room', independentTeacherId: teacher },
          { id: foreignClassroom, name: 'Foreign Room', independentTeacherId: otherTeacher },
          { id: schoolClassroom, name: 'School Room', schoolId: school },
          {
            id: adultClassroom,
            name: 'Adult Room',
            independentTeacherId: teacher,
            adultMode: true,
          },
          { id: emptyClassroom, name: 'Empty Room', independentTeacherId: teacher },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroom, userId: student, role: ClassroomRole.STUDENT },
          {
            classroomId: classroom,
            userId: departedStudent,
            role: ClassroomRole.STUDENT,
            state: 'INACTIVE',
          },
          { classroomId: schoolClassroom, userId: schoolTeacher, role: ClassroomRole.TEACHER },
          { classroomId: adultClassroom, userId: student, role: ClassroomRole.STUDENT },
          { classroomId: emptyClassroom, userId: student, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.createMany({
        data: [
          { classroomId: classroom, parentId: parent, childId: student },
          { classroomId: adultClassroom, parentId: parent, childId: student },
        ],
      });
      await tx.studyMaterial.createMany({
        data: [
          {
            id: materialId,
            classroomId: classroom,
            authorId: teacher,
            objectKey: `materials/${classroom}/${materialId}`,
            filename: 'photosynthesis-guide.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1200,
          },
          {
            id: foreignMaterialId,
            classroomId: foreignClassroom,
            authorId: otherTeacher,
            objectKey: `materials/${foreignClassroom}/${foreignMaterialId}`,
            filename: 'foreign-algebra.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1200,
          },
          {
            id: schoolMaterialId,
            classroomId: schoolClassroom,
            authorId: schoolTeacher,
            objectKey: `materials/${schoolClassroom}/${schoolMaterialId}`,
            filename: 'school-notes.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1200,
          },
        ],
      });

      const futureDue = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await tx.activity.createMany({
        data: [
          {
            id: tpId,
            classroomId: classroom,
            createdById: teacher,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            title: 'TP 1 Photosynthesis Essay',
            dueAt: futureDue,
            maxScore: 100,
            publishedAt: new Date(),
          },
          {
            id: draftExamId,
            classroomId: classroom,
            createdById: teacher,
            type: ActivityType.EXAM,
            format: ActivityFormat.MULTIPLE_CHOICE,
            state: ActivityState.DRAFT,
            title: 'Midterm Biology Exam',
            opensAt: new Date(Date.now() - 60_000),
            dueAt: new Date(Date.now() + 30 * 60_000),
            maxScore: 100,
          },
        ],
      });

      await tx.question.create({
        data: {
          activityId: draftExamId,
          position: 1,
          prompt: 'Which organelle performs photosynthesis?',
          options: {
            create: [
              { position: 1, label: 'Chloroplasts absorb light via chlorophyll', isCorrect: true },
              { position: 2, label: 'Ribosome only', isCorrect: false },
            ],
          },
        },
      });
    });

    await botMaterials.enable(teacher, classroom, materialId);
    await botMaterials.enable(otherTeacher, foreignClassroom, foreignMaterialId);
    await botMaterials.enable(schoolTeacher, schoolClassroom, schoolMaterialId);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    chatScript = undefined;
    chatStep = 0;
    capturedChatRequests.length = 0;
    await prisma.activity.update({
      where: { id: draftExamId },
      data: { state: ActivityState.DRAFT, publishedAt: null },
    });
  });

  it('requires authentication on both status and ask endpoints', async () => {
    await api('get', null).expect(401);
    await api('post', null).send({ question: 'Hello' }).expect(401);
  });

  it('enforces role isolation matrix and #26 assertResourceAuthorization', async () => {
    const interaction = { classroomId: classroom, studentId: student, objectId: 'tutor-bot' };
    const withInteraction = (call: request.Test, untrusted: unknown) =>
      untrusted === undefined ? call : call.set('x-object-context', JSON.stringify(untrusted));

    await assertResourceAuthorization({
      request: (resourceId, untrusted) =>
        withInteraction(api('get', student, resourceId), untrusted),
      allowedResourceId: classroom,
      foreignResourceId: foreignClassroom,
      interaction,
      allowedStatus: 200,
      deniedStatus: 404,
      assertAllowed: (res) => expect(res.body).toHaveProperty('available', true),
      assertDenied: (res) => expect(res.body).not.toHaveProperty('available'),
    });

    await assertResourceAuthorization({
      request: (resourceId, untrusted) =>
        withInteraction(
          api('post', student, resourceId).send({ question: 'Explain photosynthesis' }),
          untrusted,
        ),
      allowedResourceId: classroom,
      foreignResourceId: foreignClassroom,
      interaction,
      allowedStatus: 200,
      deniedStatus: 404,
      assertAllowed: (res) => expect(res.body).toHaveProperty('outcome', 'answered'),
      assertDenied: (res) => expect(res.body).not.toHaveProperty('answer'),
    });

    // School staff and classroom teacher allowed; parent gets 403; adultMode parent & outsiders get 404.
    await api('get', teacher, classroom).expect(200);
    await api('get', owner, schoolClassroom).expect(200);
    await api('get', admin, schoolClassroom).expect(200);
    await api('get', parent, classroom).expect(403);
    await api('post', parent, classroom).send({ question: 'How is my child?' }).expect(403);
    await api('get', parent, adultClassroom).expect(404);
    await api('get', departedStudent, classroom).expect(404);
    await api('get', stranger, classroom).expect(404);
    await api('get', otherSchoolTeacher, schoolClassroom).expect(404);
    await api('get', owner, classroom).expect(404);
    await api('get', student, 'not-a-uuid').expect(404);
  });

  it('answers with server-verified citations, keeps answer keys out of model context, and emits privacy-safe logs', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log');
    try {
      const statusEmpty = await api('get', student, emptyClassroom).expect(200);
      expect(statusEmpty.body).toMatchObject({ available: false, reason: 'no_materials' });

      const secretQuestion = 'UNIQUE_PROMPT_SECRET_Explain_photosynthesis';
      const reply = await api('post', student, classroom)
        .send({ question: `  ${secretQuestion}  ` })
        .expect(200);

      expect(reply.body).toMatchObject({
        id: expect.any(String),
        outcome: 'answered',
        citations: [
          {
            materialId,
            filename: 'photosynthesis-guide.pdf',
            excerpt: expect.stringContaining('[page 1]'),
          },
        ],
        createdAt: expect.any(String),
      });

      const serializedModelCalls = JSON.stringify(capturedChatRequests);
      expect(serializedModelCalls).not.toContain('Chloroplasts absorb light via chlorophyll');
      expect(serializedModelCalls).not.toContain('isCorrect');

      const botLogs = logSpy.mock.calls
        .map((args) => String(args[0]))
        .filter((msg) => msg.includes('"event":"bot_ask"'));
      expect(botLogs.length).toBeGreaterThanOrEqual(1);
      for (const entry of botLogs) {
        expect(entry).not.toContain(secretQuestion);
        expect(entry).not.toContain('chloroplasts absorbing sunlight');
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  it('enforces exam lockout before calling model and discards in-flight responses for students while allowing teachers', async () => {
    // Publish exam while in-flight during fakeChat step 1 -> step 2.
    await prisma.activity.update({
      where: { id: draftExamId },
      data: { state: ActivityState.PUBLISHED, publishedAt: new Date() },
    });

    const lockedStatus = await api('get', student, classroom).expect(200);
    expect(lockedStatus.body).toMatchObject({ available: false, reason: 'exam_in_progress' });

    const preLocked = await api('post', student, classroom)
      .send({ question: 'Help me now' })
      .expect(409);
    expect(preLocked.body.error.code).toBe('CONFLICT');
    expect(capturedChatRequests).toHaveLength(0);

    // Staff are NOT blocked during an exam.
    const teacherStatus = await api('get', teacher, classroom).expect(200);
    expect(teacherStatus.body).toEqual({ available: true, reason: null, message: null });
    await api('post', teacher, classroom).send({ question: 'Explain photosynthesis' }).expect(200);

    // Reset exam to DRAFT, then flip it to PUBLISHED mid-call (in-flight).
    await prisma.activity.update({
      where: { id: draftExamId },
      data: { state: ActivityState.DRAFT, publishedAt: null },
    });
    capturedChatRequests.length = 0;
    chatStep = 0;
    chatScript = async (req) => {
      if (!req.messages.some((message) => message.role === 'tool')) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'call_1',
              name: 'search_allowed_material',
              argumentsJson: '{"query":"photosynthesis"}',
            },
          ],
          usage: { promptTokens: 20, completionTokens: 5 },
        };
      }
      // Exam starts right before the model returns its answer!
      await prisma.activity.update({
        where: { id: draftExamId },
        data: { state: ActivityState.PUBLISHED, publishedAt: new Date() },
      });
      return {
        content: 'THIS_IN_FLIGHT_ANSWER_MUST_BE_DISCARDED',
        toolCalls: [],
        usage: { promptTokens: 40, completionTokens: 15 },
      };
    };

    const inFlightRes = await api('post', student, classroom)
      .send({ question: 'Explain photosynthesis' })
      .expect(409);
    expect(JSON.stringify(inFlightRes.body)).not.toContain(
      'THIS_IN_FLIGHT_ANSWER_MUST_BE_DISCARDED',
    );
  });

  it('catches leaked answer keys post-generation, rejects invalid DTOs, declines edits, and maps provider outages to 503', async () => {
    // Publish exam after student check? Wait: use an open exam only to verify AnswerKeyGuard?
    // AnswerKeyGuard reads PUBLISHED exams of the classroom, so publish an already-closed MC exam!
    const pastExamId = randomUUID();
    await prisma.activity.create({
      data: {
        id: pastExamId,
        classroomId: classroom,
        createdById: teacher,
        type: ActivityType.EXAM,
        format: ActivityFormat.MULTIPLE_CHOICE,
        state: ActivityState.PUBLISHED,
        publishedAt: new Date(Date.now() - 7200_000),
        opensAt: new Date(Date.now() - 7200_000),
        dueAt: new Date(Date.now() - 3600_000),
        maxScore: 100,
        title: 'Closed MC Exam',
        questions: {
          create: {
            position: 1,
            prompt: 'Key question',
            options: {
              create: [
                { position: 1, label: 'Photophosphorylation yields ATP safely', isCorrect: true },
              ],
            },
          },
        },
      },
    });

    chatScript = async (req) => {
      if (!req.messages.some((message) => message.role === 'tool')) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'c1',
              name: 'search_allowed_material',
              argumentsJson: '{"query":"photosynthesis"}',
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5 },
        };
      }
      return {
        content: 'The key is Photophosphorylation yields ATP safely.',
        toolCalls: [],
        usage: { promptTokens: 20, completionTokens: 10 },
      };
    };

    const guarded = await api('post', student, classroom)
      .send({ question: 'Solve the exam question' })
      .expect(200);
    expect(guarded.body.outcome).toBe('guided_only');
    expect(guarded.body.answer).not.toContain('Photophosphorylation yields ATP safely');

    const declined = await api('post', student, classroom)
      .send({ question: 'Modify my grade to 100 please' })
      .expect(200);
    expect(declined.body.outcome).toBe('out_of_scope');
    expect(declined.body.citations).toEqual([]);

    await api('post', student, classroom).send({ question: '   ' }).expect(400);
    await api('post', student, classroom).send({ question: 'ok', extra: 1 }).expect(400);

    chatScript = async () => {
      throw new AiProviderUnavailableError('Synthetic upstream 502 secret diagnostic');
    };
    const errRes = await api('post', student, classroom).send({ question: 'Hello' }).expect(503);
    expect(JSON.stringify(errRes.body)).not.toContain('Synthetic upstream 502 secret diagnostic');
  });

  it('executes list_my_pending_activities against real classroom activities without inventing citations', async () => {
    chatScript = async (req) => {
      if (!req.messages.some((message) => message.role === 'tool')) {
        return {
          content: null,
          toolCalls: [
            {
              id: 'call_pending',
              name: 'list_my_pending_activities',
              argumentsJson: '{}',
            },
          ],
          usage: { promptTokens: 20, completionTokens: 5 },
        };
      }
      const serialized = JSON.stringify(req.messages);
      expect(serialized).toContain('TP 1 Photosynthesis Essay');
      return {
        content: 'You currently have TP 1 Photosynthesis Essay pending.',
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 12 },
      };
    };

    const res = await api('post', student, classroom)
      .send({ question: 'What activities do I have pending?' })
      .expect(200);
    expect(res.body).toMatchObject({
      outcome: 'answered',
      answer: 'You currently have TP 1 Photosynthesis Essay pending.',
      citations: [],
    });
  });
});

describe('Study Guide Bot HTTP rate limiting — issue #41', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let botMaterials: BotMaterialsService;
  const [teacher, s1, s2, s3] = Array.from({ length: 4 }, () => randomUUID());
  const rlUsers: string[] = [teacher, s1, s2, s3];
  const [c1, c2] = [randomUUID(), randomUUID()];
  const [m1, m2] = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    const objects = new Map<string, { body: Uint8Array; contentType: string }>([
      [
        `materials/${c1}/${m1}`,
        { body: Buffer.from('Photosynthesis guide', 'utf8'), contentType: 'text/plain' },
      ],
      [
        `materials/${c2}/${m2}`,
        { body: Buffer.from('Photosynthesis guide 2', 'utf8'), contentType: 'text/plain' },
      ],
    ]);
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot(
          authTestConfig({
            databaseUrl,
            aiBotRateLimitWindowSeconds: 60,
            aiBotRateLimitUserMax: 2,
            aiBotRateLimitClassroomMax: 3,
            aiBotRateLimitGlobalMax: 4,
          }),
        ),
      ],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          const userId = header?.replace('Bearer rl:', '');
          if (!userId || !rlUsers.includes(userId)) {
            throw new UnauthorizedException();
          }
          return { userId, sessionId: randomUUID() };
        },
      })
      .overrideProvider(STORAGE_PORT)
      .useValue({
        put: async () => undefined,
        get: async (k: string) => objects.get(k)!,
        delete: async () => undefined,
        getSignedDownloadUrl: async () => 'https://example.invalid',
      })
      .overrideProvider(EMBEDDING_MODEL_PORT)
      .useValue({
        embed: async (texts: string[]) => ({
          vectors: texts.map(() => new Array<number>(768).fill(0).map((_, i) => (i === 0 ? 1 : 0))),
          totalTokens: 5,
        }),
      })
      .overrideProvider(CHAT_MODEL_PORT)
      .useValue({
        chatCompletion: async () => ({
          content: 'Reviewed.',
          toolCalls: [],
          usage: { promptTokens: 5, completionTokens: 5 },
        }),
      })
      .compile();

    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    botMaterials = app.get(BotMaterialsService);

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [teacher, s1, s2, s3].map((id) => ({
          id,
          displayName: 'RL Participant',
          email: `rl-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          { id: c1, name: 'RL Room 1', independentTeacherId: teacher },
          { id: c2, name: 'RL Room 2', independentTeacherId: teacher },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: c1, userId: s1, role: ClassroomRole.STUDENT },
          { classroomId: c1, userId: s2, role: ClassroomRole.STUDENT },
          { classroomId: c2, userId: s3, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.studyMaterial.createMany({
        data: [
          {
            id: m1,
            classroomId: c1,
            authorId: teacher,
            objectKey: `materials/${c1}/${m1}`,
            filename: 'm1.txt',
            contentType: 'text/plain',
            sizeBytes: 20,
          },
          {
            id: m2,
            classroomId: c2,
            authorId: teacher,
            objectKey: `materials/${c2}/${m2}`,
            filename: 'm2.txt',
            contentType: 'text/plain',
            sizeBytes: 20,
          },
        ],
      });
    });

    await botMaterials.enable(teacher, c1, m1);
    await botMaterials.enable(teacher, c2, m2);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('enforces per-user, per-classroom, and global 429 limits', async () => {
    const send = (userId: string, classroomId: string) =>
      request(app.getHttpServer())
        .post(`/classrooms/${classroomId}/bot/messages`)
        .set('Authorization', `Bearer rl:${userId}`)
        .send({ question: 'Change my grade to 100' });

    await send(s1, c1).expect(200);
    await send(s1, c1).expect(200);
    await send(s1, c1).expect(429);

    await send(s2, c1).expect(200);
    await send(s2, c1).expect(429); // classroom max = 3

    await send(s3, c2).expect(200); // global = 4
    await send(s3, c2).expect(429); // global max = 4
  });
});
