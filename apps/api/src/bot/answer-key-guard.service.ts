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
  /\b(correct answer|right answer|the answer is|answer is|right option|correct option|solution is|the result is|go with|choose|pick|select|mark|it'?s|it is|that'?s|that is|therefore|respuesta correcta|la correcta es|la respuesta es|opci[oó]n correcta|la soluci[oó]n es|el resultado es|eleg[ií]|marc[aá]|seleccion[aá]|quedate con|por lo tanto|es la|es)\b/i;

const KEY_LETTER_REVEAL_PATTERN =
  /(?:\b(?:(?:the\s+)?(?:correct\s+|right\s+|final\s+)?(?:answer|option|choice|letter)\s*(?:is|would\s+be|:|-)\s*(?:option\s+|choice\s+|letter\s+)?[A-F1-6]\b|(?:go\s+with|choose|pick|select|mark)\s+(?:option\s+|choice\s+|letter\s+)?[A-F1-6]\b|(?:it'?s|it\s+is|that'?s)\s+(?:option\s+|choice\s+|letter\s+)?[A-F]\b|(?:la\s+)?(?:respuesta|opci[oó]n|letra)(?:\s+correcta)?\s*(?:es|ser[ií]a|:|-)\s*(?:la\s+)?(?:opci[oó]n\s+)?[A-F1-6]\b|(?:eleg[ií]|marc[aá]|seleccion[aá]|quedate\s+con)\s+(?:la\s+)?(?:opci[oó]n\s+)?[A-F1-6]\b|es\s+la\s+(?:opci[oó]n\s+)?[A-F1-6]\b))/i;

const SOLUTION_SEEKING_PATTERN =
  /\b(solve this|solve it for me|give me the (?:(?:correct |right |final )?(?:answer|answers|option)|solution)|which option is (?:right|correct)|what is the (?:correct |right |final )?answer|do my homework|resuelve|resolv[eé](?:me|lo)|dame la (?:respuesta|opci[oó]n|soluci[oó]n)(?: correcta| final)?|cu[aá]l es la (?:opci[oó]n |respuesta )?correcta|cual es la (?:opcion |respuesta )?correcta|hac[eé](?:me)? mi tarea)\b/i;

const GUIDING_LANGUAGE_PATTERN =
  /\?|\b(try|compare|review|think about|consider|check|look at|re-?read|hint|step by step|prob[aá]|compar[aá]|revis[aá]|pens[aá]|consider[aá]|mir[aá]|fijate|rele[eé]|pista|paso a paso)\b/i;

const DISTINCTIVE_OPTION_MIN_LENGTH = 15;
const SHORT_OPTION_MIN_LENGTH = 3;
const PARAPHRASE_MIN_TOKENS = 4;
const PARAPHRASE_TOKEN_OVERLAP_RATIO = 0.75;

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'into',
  'onto',
  'over',
  'under',
  'about',
  'have',
  'does',
  'para',
  'como',
  'pero',
  'sobre',
  'entre',
  'hacia',
  'desde',
  'donde',
  'cuando',
  'porque',
  'una',
  'unos',
  'unas',
  'los',
  'las',
  'del',
  'con',
  'por',
  'que',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(normalizedHaystack: string, normalizedNeedle: string): boolean {
  if (!normalizedNeedle) return false;
  const pattern = new RegExp(`(?:^| )${escapeRegExp(normalizedNeedle)}(?:$| )`);
  return pattern.test(normalizedHaystack);
}

function extractSignificantTokens(normalizedText: string): string[] {
  const unique = new Set<string>();
  for (const token of normalizedText.split(' ')) {
    if (token.length >= 4 && !STOPWORDS.has(token)) {
      unique.add(token);
    }
  }
  return [...unique];
}

function hasParaphraseOverlap(normalizedAnswer: string, normalizedOption: string): boolean {
  const optionTokens = extractSignificantTokens(normalizedOption);
  if (optionTokens.length < PARAPHRASE_MIN_TOKENS) {
    return false;
  }
  const answerTokens = new Set(extractSignificantTokens(normalizedAnswer));
  let matched = 0;
  for (const token of optionTokens) {
    if (answerTokens.has(token)) {
      matched += 1;
    }
  }
  return matched / optionTokens.length >= PARAPHRASE_TOKEN_OVERLAP_RATIO;
}

/**
 * Post-generation anti-cheat output guard. Loads published multiple-choice
 * correct option labels strictly on the server (never passed to the model or
 * logs) and replaces any leaked answer key, letter reveal, paraphrase, or
 * non-guiding solution response with safe study guidance.
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
    const isSolutionSeeking = SOLUTION_SEEKING_PATTERN.test(question);

    for (const option of correctOptions) {
      const normalizedOption = normalizeText(option.label);
      if (normalizedOption.length < SHORT_OPTION_MIN_LENGTH) continue;

      if (
        normalizedOption.length >= DISTINCTIVE_OPTION_MIN_LENGTH &&
        (normalizedAnswer.includes(normalizedOption) ||
          hasParaphraseOverlap(normalizedAnswer, normalizedOption))
      ) {
        return { answer: SAFE_ANTICHEAT_GUIDANCE, outcome: 'guided_only' };
      }

      if (
        (hasRevelationCue || isSolutionSeeking) &&
        containsWholePhrase(normalizedAnswer, normalizedOption)
      ) {
        return { answer: SAFE_ANTICHEAT_GUIDANCE, outcome: 'guided_only' };
      }
    }

    if (isSolutionSeeking) {
      const readsAsGuidance = GUIDING_LANGUAGE_PATTERN.test(answer) && !hasRevelationCue;
      if (!readsAsGuidance) {
        return { answer: SAFE_ANTICHEAT_GUIDANCE, outcome: 'guided_only' };
      }
      return { answer, outcome: 'guided_only' };
    }

    return { answer, outcome: 'answered' };
  }
}
