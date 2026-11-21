import { Injectable } from '@nestjs/common';
import { ActivityFormat, ActivityState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type GuardedBotOutcome = 'answered' | 'guided_only';

export interface AnswerKeyInspectionResult {
  answer: string;
  outcome: GuardedBotOutcome;
}

const SAFE_ANTICHEAT_GUIDANCE =
  'I cannot share final answers or solution keys for classroom activities. Review the cited study material, explain the approach you have in mind, and I will help check your reasoning step by step.';

const REVELATION_CUE_PATTERN =
  /\b(correct answer|right answer|the answer is|right option|correct option|solution is|respuesta correcta|la correcta es|la respuesta es|opci[oó]n correcta)\b/i;

const KEY_LETTER_REVEAL_PATTERN =
  /(?:correct\s+(?:answer|option)|respuesta\s+correcta|opci[oó]n\s+correcta)\s*(?:is|es|:|-)?\s*[A-D1-4]\b/i;

const SOLUTION_SEEKING_PATTERN =
  /\b(solve this|solve it for me|give me the (?:(?:correct |right |final )?(?:answer|answers|option)|solution)|which option is (?:right|correct)|what is the (?:correct |right |final )?answer|do my homework|resuelve|resolv[eé](?:me|lo)|dame la (?:respuesta|opci[oó]n|soluci[oó]n)(?: correcta| final)?|cu[aá]l es la (?:opci[oó]n |respuesta )?correcta|cual es la (?:opcion |respuesta )?correcta|hac[eé](?:me)? mi tarea)\b/i;

const DISTINCTIVE_OPTION_MIN_LENGTH = 15;
const SHORT_OPTION_MIN_LENGTH = 3;

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Post-generation anti-cheat output guard. Loads published multiple-choice
 * correct option labels strictly on the server (never passed to the model or
 * logs) and replaces any leaked answer key with safe study guidance.
 */
@Injectable()
export class AnswerKeyGuardService {
  constructor(private readonly prisma: PrismaService) {}

  async inspect(
    classroomId: string,
    question: string,
    answer: string,
  ): Promise<AnswerKeyInspectionResult> {
    const correctOptions = await this.prisma.option.findMany({
      where: {
        isCorrect: true,
        question: {
          activity: {
            classroomId,
            format: ActivityFormat.MULTIPLE_CHOICE,
            state: ActivityState.PUBLISHED,
            deletedAt: null,
          },
        },
      },
      select: { label: true },
    });

    if (KEY_LETTER_REVEAL_PATTERN.test(answer)) {
      return { answer: SAFE_ANTICHEAT_GUIDANCE, outcome: 'guided_only' };
    }

    const normalizedAnswer = normalizeText(answer);
    const hasRevelationCue = REVELATION_CUE_PATTERN.test(answer);

    for (const option of correctOptions) {
      const normalizedOption = normalizeText(option.label);
      if (normalizedOption.length < SHORT_OPTION_MIN_LENGTH) continue;

      if (
        normalizedOption.length >= DISTINCTIVE_OPTION_MIN_LENGTH &&
        normalizedAnswer.includes(normalizedOption)
      ) {
        return { answer: SAFE_ANTICHEAT_GUIDANCE, outcome: 'guided_only' };
      }

      if (hasRevelationCue && normalizedAnswer.includes(normalizedOption)) {
        return { answer: SAFE_ANTICHEAT_GUIDANCE, outcome: 'guided_only' };
      }
    }

    if (SOLUTION_SEEKING_PATTERN.test(question)) {
      return { answer, outcome: 'guided_only' };
    }

    return { answer, outcome: 'answered' };
  }
}
