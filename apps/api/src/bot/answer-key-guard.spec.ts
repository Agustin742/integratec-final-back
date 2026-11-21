import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { AnswerKeyGuardService } from './answer-key-guard.service';

describe('AnswerKeyGuardService', () => {
  const classroomId = randomUUID();

  function createGuard(correctLabels: string[]) {
    const findMany = vi.fn(async () => correctLabels.map((label) => ({ label })));
    const prisma = {
      option: { findMany },
    } as unknown as PrismaService;
    return { guard: new AnswerKeyGuardService(prisma), findMany };
  }

  it('passes normal study answers untouched with outcome answered', async () => {
    const { guard } = createGuard(['Adenosine triphosphate']);
    const result = await guard.inspect(
      classroomId,
      'What does the chapter say about energy transfer?',
      'Review the section on cellular metabolism and think about how molecules carry energy.',
    );
    expect(result).toEqual({
      answer:
        'Review the section on cellular metabolism and think about how molecules carry energy.',
      outcome: 'answered',
    });
  });

  it('marks clean guiding answers to solution-seeking requests as guided_only', async () => {
    const { guard } = createGuard(['Mitochondria produces ATP']);
    const result = await guard.inspect(
      classroomId,
      'Give me the correct answer to question 2 of the quiz!',
      'Try comparing the organelle functions described on page 2 before selecting an option.',
    );
    expect(result.outcome).toBe('guided_only');
    expect(result.answer).toContain('Try comparing the organelle functions');
  });

  it('replaces leaked distinctive correct option labels or explicit answer revelations', async () => {
    const { guard } = createGuard(['Chloroplasts convert light energy into glucose', 'Mitosis']);

    const leakedDistinctive = await guard.inspect(
      classroomId,
      'Explain photosynthesis',
      'Remember that Chloroplasts convert light energy into glucose during this process.',
    );
    expect(leakedDistinctive.outcome).toBe('guided_only');
    expect(leakedDistinctive.answer).not.toContain(
      'Chloroplasts convert light energy into glucose',
    );

    const leakedShortExplicit = await guard.inspect(
      classroomId,
      'Which option is right?',
      'La respuesta correcta es Mitosis según la guía.',
    );
    expect(leakedShortExplicit.outcome).toBe('guided_only');
    expect(leakedShortExplicit.answer).not.toContain('Mitosis');
  });
});
