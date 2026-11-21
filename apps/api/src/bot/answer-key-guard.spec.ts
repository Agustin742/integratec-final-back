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

  it('blocks short option giveaways like "It\'s mitosis" and casual letter reveals', async () => {
    const { guard } = createGuard(['Mitosis']);

    const shortDirect = await guard.inspect(
      classroomId,
      'What cell division process matches question 1?',
      "It's mitosis.",
    );
    expect(shortDirect.outcome).toBe('guided_only');
    expect(shortDirect.answer).not.toMatch(/mitosis/i);

    for (const leaky of [
      'The answer is B.',
      'Go with C for this one.',
      'Elegí la opción A según el resumen.',
      'Marcá la D.',
      "It's B.",
    ]) {
      const result = await guard.inspect(classroomId, 'Help me with question 3', leaky);
      expect(result.outcome).toBe('guided_only');
      expect(result.answer).not.toBe(leaky);
    }
  });

  it('blocks paraphrased long correct options via significant-token overlap', async () => {
    const { guard } = createGuard(['Chloroplasts convert light energy into glucose']);
    const paraphrased = await guard.inspect(
      classroomId,
      'Explain how plants store solar energy',
      'Inside chloroplasts, light energy is converted directly into glucose molecules.',
    );
    expect(paraphrased.outcome).toBe('guided_only');
    expect(paraphrased.answer).not.toContain('glucose');
  });

  it('replaces non-guiding assertive answers to solution-seeking requests while keeping Socratic guidance', async () => {
    const { guard } = createGuard(['Mitosis']);

    const assertive = await guard.inspect(
      classroomId,
      'Solve this homework question for me',
      'The result is 42 because you multiply 6 by 7.',
    );
    expect(assertive.outcome).toBe('guided_only');
    expect(assertive.answer).not.toContain('42');

    const solutionMentioningShortOption = await guard.inspect(
      classroomId,
      'Which option is right for question 2?',
      'Think carefully about mitosis and compare it with the diagram.',
    );
    expect(solutionMentioningShortOption.outcome).toBe('guided_only');
    expect(solutionMentioningShortOption.answer).not.toMatch(/mitosis/i);

    const socratic = await guard.inspect(
      classroomId,
      'Give me the final answer to question 2!',
      'Compare the two phases described on page 4. Which process keeps the chromosome count unchanged?',
    );
    expect(socratic.outcome).toBe('guided_only');
    expect(socratic.answer).toContain('Compare the two phases');
  });
});
