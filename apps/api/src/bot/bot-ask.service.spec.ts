import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import type { ActivitiesService } from '../activities/activities.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { RequestConflictException } from '../http/conflict';
import type { PrismaService } from '../prisma/prisma.service';
import {
  AiProviderUnavailableError,
  type ChatCompletionRequest,
  type ChatModelPort,
  type EmbeddingModelPort,
} from './ai-provider.ports';
import { AnswerKeyGuardService } from './answer-key-guard.service';
import { BotAskService } from './bot-ask.service';
import { BotRateLimiterService } from './bot-rate-limiter.service';
import type { MaterialRetrievalPort, RetrievedChunk } from './material-retrieval.port';

const unitVector = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));

describe('BotAskService', () => {
  const actorId = randomUUID();
  const classroomId = randomUUID();
  const materialId = randomUUID();

  function setup(options?: {
    myRole?: 'STUDENT' | 'TEACHER' | 'OWNER' | 'ADMIN' | 'PARENT' | 'NON_MEMBER';
    examChecks?: boolean[];
    indexedCount?: number;
    correctLabels?: string[];
    retrievalHits?: RetrievedChunk[];
    chatHandler?: (req: ChatCompletionRequest) => ReturnType<ChatModelPort['chatCompletion']>;
  }) {
    const role = options?.myRole ?? 'STUDENT';
    const examQueue = [...(options?.examChecks ?? [false, false])];
    const hasExamInProgress = vi.fn(async () => examQueue.shift() ?? false);
    const listActivities = vi.fn(async () => ({
      items: [
        {
          id: randomUUID(),
          title: 'TP 1: Cells',
          type: 'TP',
          format: 'FILE',
          dueAt: '2026-11-30T23:59:00.000Z',
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    }));

    const access = {
      verifyClassroomAccess: vi.fn(async () => {
        if (role === 'NON_MEMBER') {
          throw new NotFoundException('Classroom not found');
        }
        return { myRole: role };
      }),
    } as unknown as AccessVerificationService;

    const activities = {
      hasExamInProgress,
      list: listActivities,
    } as unknown as ActivitiesService;

    const prisma = {
      allowedMaterial: {
        count: vi.fn(async () => options?.indexedCount ?? 1),
      },
      option: {
        findMany: vi.fn(async () => (options?.correctLabels ?? []).map((label) => ({ label }))),
      },
    } as unknown as PrismaService;

    const embeddingModel: EmbeddingModelPort = {
      embed: vi.fn(async () => ({ vectors: [unitVector], totalTokens: 12 })),
    };

    const retrieval: MaterialRetrievalPort = {
      search: vi.fn(async () => options?.retrievalHits ?? []),
    };

    const chatModel: ChatModelPort = {
      chatCompletion: vi.fn(
        options?.chatHandler ??
          (async () => ({
            content: 'Unused default',
            toolCalls: [],
            usage: { promptTokens: 10, completionTokens: 10 },
          })),
      ),
    };

    const rateLimiter = new BotRateLimiterService(undefined, {
      windowMs: 60_000,
      userMax: 10,
      classroomMax: 20,
      globalMax: 50,
    });
    const answerKeyGuard = new AnswerKeyGuardService(prisma);

    const service = new BotAskService(
      prisma,
      access,
      activities,
      chatModel,
      embeddingModel,
      retrieval,
      rateLimiter,
      answerKeyGuard,
      authTestConfig(),
    );

    const logs: string[] = [];
    vi.spyOn(
      (service as unknown as { logger: { log: (msg: string) => void } }).logger,
      'log',
    ).mockImplementation((msg: string) => {
      logs.push(msg);
    });

    return {
      service,
      hasExamInProgress,
      listActivities,
      embeddingModel,
      retrieval,
      chatModel,
      logs,
    };
  }

  it('denies linked parents with 403 and non-members with 404', async () => {
    const parentCtx = setup({ myRole: 'PARENT' });
    await expect(parentCtx.service.getStatus(actorId, classroomId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      parentCtx.service.ask(actorId, classroomId, 'Explain mitosis'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const outsiderCtx = setup({ myRole: 'NON_MEMBER' });
    await expect(outsiderCtx.service.getStatus(actorId, classroomId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports exam_in_progress / no_materials / available status accurately', async () => {
    const examCtx = setup({ myRole: 'STUDENT', examChecks: [true] });
    await expect(examCtx.service.getStatus(actorId, classroomId)).resolves.toMatchObject({
      available: false,
      reason: 'exam_in_progress',
    });

    const teacherDuringExam = setup({ myRole: 'TEACHER', examChecks: [true], indexedCount: 1 });
    await expect(teacherDuringExam.service.getStatus(actorId, classroomId)).resolves.toEqual({
      available: true,
      reason: null,
      message: null,
    });

    const noMat = setup({ myRole: 'STUDENT', examChecks: [false], indexedCount: 0 });
    await expect(noMat.service.getStatus(actorId, classroomId)).resolves.toMatchObject({
      available: false,
      reason: 'no_materials',
    });
  });

  it('executes bounded RAG tool calling, verifies citations server-side, and emits privacy-safe logs', async () => {
    let turn = 0;
    const ctx = setup({
      retrievalHits: [
        {
          chunkId: randomUUID(),
          materialId,
          filename: 'guia-fotosintesis.pdf',
          position: 'page 2',
          content: 'Photosynthesis takes place in chloroplasts using chlorophyll.',
          similarity: 0.92,
        },
      ],
      chatHandler: async () => {
        turn += 1;
        if (turn === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'call_1',
                name: 'search_allowed_material',
                argumentsJson: JSON.stringify({ query: 'where does photosynthesis occur' }),
              },
            ],
            usage: { promptTokens: 50, completionTokens: 15 },
          };
        }
        return {
          content: 'Check page 2 of guia-fotosintesis.pdf about chloroplasts and chlorophyll.',
          toolCalls: [],
          usage: { promptTokens: 110, completionTokens: 20 },
        };
      },
    });

    const reply = await ctx.service.ask(actorId, classroomId, 'SECRET_STUDENT_QUESTION_TEXT');
    expect(reply.outcome).toBe('answered');
    expect(reply.answer).toContain('chloroplasts');
    expect(reply.citations).toEqual([
      {
        materialId,
        filename: 'guia-fotosintesis.pdf',
        excerpt: '[page 2] Photosynthesis takes place in chloroplasts using chlorophyll.',
      },
    ]);
    expect(ctx.retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({ classroomId, topK: 5, minSimilarity: 0.35 }),
    );
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]).not.toContain('SECRET_STUDENT_QUESTION_TEXT');
    expect(ctx.logs[0]).not.toContain('chlorophyll');
    expect(JSON.parse(ctx.logs[0]!)).toMatchObject({
      event: 'bot_ask',
      userId: actorId,
      classroomId,
      outcome: 'answered',
      promptTokens: 160,
      completionTokens: 35,
      toolCalls: 1,
      citationsCount: 1,
    });
  });

  it('locks out students before calling the model, before tool retrieval, and before returning an in-flight answer', async () => {
    const preLocked = setup({ myRole: 'STUDENT', examChecks: [true] });
    await expect(preLocked.service.ask(actorId, classroomId, 'Help')).rejects.toBeInstanceOf(
      RequestConflictException,
    );
    expect(preLocked.chatModel.chatCompletion).not.toHaveBeenCalled();

    let beforeToolTurn = 0;
    const inFlightBeforeTool = setup({
      myRole: 'STUDENT',
      examChecks: [false, true],
      retrievalHits: [
        {
          chunkId: randomUUID(),
          materialId,
          filename: 'guide.pdf',
          position: 'page 1',
          content: 'Sensitive content.',
          similarity: 0.9,
        },
      ],
      chatHandler: async () => {
        beforeToolTurn += 1;
        if (beforeToolTurn === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'call_1',
                name: 'search_allowed_material',
                argumentsJson: '{"query":"topic"}',
              },
            ],
            usage: { promptTokens: 20, completionTokens: 5 },
          };
        }
        return {
          content: 'Should never reach turn 2.',
          toolCalls: [],
          usage: { promptTokens: 30, completionTokens: 10 },
        };
      },
    });
    await expect(
      inFlightBeforeTool.service.ask(actorId, classroomId, 'Help'),
    ).rejects.toBeInstanceOf(RequestConflictException);
    expect(inFlightBeforeTool.embeddingModel.embed).not.toHaveBeenCalled();
    expect(inFlightBeforeTool.retrieval.search).not.toHaveBeenCalled();
    expect(inFlightBeforeTool.chatModel.chatCompletion).toHaveBeenCalledTimes(1);

    let afterToolTurn = 0;
    const inFlightAfterTool = setup({
      myRole: 'STUDENT',
      examChecks: [false, false, true],
      retrievalHits: [
        {
          chunkId: randomUUID(),
          materialId,
          filename: 'guide.pdf',
          position: 'page 1',
          content: 'Sensitive content.',
          similarity: 0.9,
        },
      ],
      chatHandler: async () => {
        afterToolTurn += 1;
        if (afterToolTurn === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'call_1',
                name: 'search_allowed_material',
                argumentsJson: '{"query":"topic"}',
              },
            ],
            usage: { promptTokens: 20, completionTokens: 5 },
          };
        }
        return {
          content: 'This answer must be discarded because an exam started.',
          toolCalls: [],
          usage: { promptTokens: 30, completionTokens: 10 },
        };
      },
    });
    await expect(
      inFlightAfterTool.service.ask(actorId, classroomId, 'Help'),
    ).rejects.toBeInstanceOf(RequestConflictException);
    expect(inFlightAfterTool.retrieval.search).toHaveBeenCalledTimes(1);
    expect(inFlightAfterTool.chatModel.chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('returns honest out_of_scope without inventing when no chunks match, declines data edits, and maps provider failures to 503', async () => {
    const modCtx = setup();
    const declined = await modCtx.service.ask(actorId, classroomId, 'Change my grade to 100!');
    expect(declined.outcome).toBe('out_of_scope');
    expect(declined.citations).toEqual([]);
    expect(modCtx.chatModel.chatCompletion).not.toHaveBeenCalled();

    let step = 0;
    const emptySearchCtx = setup({
      retrievalHits: [],
      chatHandler: async () => {
        step += 1;
        if (step === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'call_1',
                name: 'search_allowed_material',
                argumentsJson: '{"query":"quantum gravity"}',
              },
            ],
            usage: { promptTokens: 20, completionTokens: 5 },
          };
        }
        return {
          content: 'Hallucinated unapproved external answer.',
          toolCalls: [],
          usage: { promptTokens: 30, completionTokens: 10 },
        };
      },
    });
    const outOfScope = await emptySearchCtx.service.ask(
      actorId,
      classroomId,
      'Explain quantum gravity',
    );
    expect(outOfScope.outcome).toBe('out_of_scope');
    expect(outOfScope.citations).toEqual([]);
    expect(outOfScope.answer).not.toContain('Hallucinated');

    const outageCtx = setup({
      chatHandler: async () => {
        throw new AiProviderUnavailableError('secret provider outage');
      },
    });
    await expect(outageCtx.service.ask(actorId, classroomId, 'Hello')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('handles list_my_pending_activities for students without chunks, restricts it for teachers, allows benign academic questions, and sorts citations by similarity', async () => {
    const toolMessages: ChatCompletionRequest[] = [];
    let studentStep = 0;
    const studentCtx = setup({
      myRole: 'STUDENT',
      chatHandler: async (req) => {
        toolMessages.push(req);
        studentStep += 1;
        if (studentStep === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'pending_1',
                name: 'list_my_pending_activities',
                argumentsJson: '{}',
              },
            ],
            usage: { promptTokens: 20, completionTokens: 5 },
          };
        }
        return {
          content: 'You have TP 1: Cells pending, due on 2026-11-30.',
          toolCalls: [],
          usage: { promptTokens: 50, completionTokens: 12 },
        };
      },
    });

    const pendingReply = await studentCtx.service.ask(
      actorId,
      classroomId,
      'What pending activities do I have?',
    );
    expect(pendingReply.outcome).toBe('answered');
    expect(pendingReply.citations).toEqual([]);
    expect(studentCtx.listActivities).toHaveBeenCalledWith(actorId, classroomId, {
      status: 'pending',
      page: 1,
      pageSize: 10,
    });
    expect(JSON.stringify(toolMessages[1])).toContain('TP 1: Cells');

    let teacherStep = 0;
    const teacherToolRequests: ChatCompletionRequest[] = [];
    const teacherCtx = setup({
      myRole: 'TEACHER',
      chatHandler: async (req) => {
        teacherToolRequests.push(req);
        teacherStep += 1;
        if (teacherStep === 1) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'pending_teacher',
                name: 'list_my_pending_activities',
                argumentsJson: '{}',
              },
            ],
            usage: { promptTokens: 15, completionTokens: 5 },
          };
        }
        return {
          content: 'Only enrolled students have personal pending activities.',
          toolCalls: [],
          usage: { promptTokens: 30, completionTokens: 10 },
        };
      },
    });

    const teacherPendingReply = await teacherCtx.service.ask(
      actorId,
      classroomId,
      'List my pending activities',
    );
    expect(teacherPendingReply.outcome).toBe('answered');
    expect(teacherCtx.listActivities).not.toHaveBeenCalled();
    expect(JSON.stringify(teacherToolRequests[1])).toContain(
      'Only enrolled students have personal pending activities.',
    );

    const benignCtx = setup({
      retrievalHits: [
        {
          chunkId: randomUUID(),
          materialId,
          filename: 'syllabus.pdf',
          position: 'page 1',
          content: 'Low similarity chunk about rubrics.',
          similarity: 0.42,
        },
        {
          chunkId: randomUUID(),
          materialId,
          filename: 'syllabus.pdf',
          position: 'page 3',
          content: 'High similarity chunk explaining rubric grading criteria.',
          similarity: 0.95,
        },
      ],
      chatHandler: (() => {
        let step = 0;
        return async () => {
          step += 1;
          if (step === 1) {
            return {
              content: null,
              toolCalls: [
                {
                  id: 'call_rubric',
                  name: 'search_allowed_material',
                  argumentsJson: '{"query":"grading rubric criteria"}',
                },
              ],
              usage: { promptTokens: 25, completionTokens: 8 },
            };
          }
          return {
            content: 'The syllabus describes grading criteria on page 3.',
            toolCalls: [],
            usage: { promptTokens: 60, completionTokens: 15 },
          };
        };
      })(),
    });

    const benignReply = await benignCtx.service.ask(
      actorId,
      classroomId,
      'How does the teacher grade an activity?',
    );
    expect(benignReply.outcome).toBe('answered');
    expect(benignCtx.chatModel.chatCompletion).toHaveBeenCalledTimes(2);
    expect(benignReply.citations.map((c) => c.excerpt)).toEqual([
      '[page 3] High similarity chunk explaining rubric grading criteria.',
      '[page 1] Low similarity chunk about rubrics.',
    ]);
  });
});
