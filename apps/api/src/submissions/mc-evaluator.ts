import { Prisma } from '@prisma/client';
import { UUID_PATTERN } from '../access/access-verification.service';
import { conflict } from '../http/conflict';
import { RequestValidationException } from '../http/validation';

/** One parsed `{ questionId, optionId }` pair from the `answers` multipart field. */
export interface ParsedMcAnswer {
  questionId: string;
  optionId: string;
}

/** Validated answers plus the server-computed score, ready to persist with the submission. */
export interface McEvaluation {
  autoScore: number;
  rows: { questionId: string; optionId: string; position: number }[];
}

interface AnswerViolation {
  messages: string[];
}

function answersValidation(violations: AnswerViolation[]): never {
  throw new RequestValidationException(
    violations.map((violation) => ({ field: 'answers', ...violation })),
  );
}

/**
 * Parses and shape-validates the JSON-encoded `answers` field of a multiple-choice submission.
 * The client supplies the chosen option per question; whether those ids belong to the activity
 * is checked later inside the submit transaction, against committed question data.
 */
export function parseMcAnswers(raw: string | undefined): ParsedMcAnswer[] {
  if (raw === undefined || raw.length === 0) {
    answersValidation([
      { messages: ['answers is required and must be a JSON array of question/option pairs'] },
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    answersValidation([{ messages: ['answers must be valid JSON'] }]);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    answersValidation([
      { messages: ['answers must be a non-empty JSON array of question/option pairs'] },
    ]);
  }
  const answers: ParsedMcAnswer[] = [];
  const seenQuestions = new Set<string>();
  for (const item of parsed) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !UUID_PATTERN.test(String((item as Record<string, unknown>).questionId)) ||
      !UUID_PATTERN.test(String((item as Record<string, unknown>).optionId))
    ) {
      answersValidation([
        { messages: ['each answer must be an object with uuid questionId and optionId'] },
      ]);
    }
    const answer = item as { questionId: string; optionId: string };
    if (seenQuestions.has(answer.questionId)) {
      answersValidation([{ messages: [`duplicated answer for question ${answer.questionId}`] }]);
    }
    seenQuestions.add(answer.questionId);
    answers.push({ questionId: answer.questionId, optionId: answer.optionId });
  }
  return answers;
}

/**
 * Validates the answers against the activity's committed questions and computes the auto-graded
 * score. Exactly one submission exists per (activity, student), so each stored answer reflects
 * one chosen option per question: unanswered and wrong questions count as incorrect, and the
 * score is `round(correct / questions * maxScore)` on the activity's 0-100 scale. Correct answers
 * never leave this function's caller bounds: `isCorrect` is read here and never serialized.
 */
export async function evaluateMcAnswers(
  tx: Prisma.TransactionClient,
  activityId: string,
  answers: readonly ParsedMcAnswer[],
  maxScore: number,
): Promise<McEvaluation> {
  const questions = await tx.question.findMany({
    where: { activityId },
    select: { id: true, options: { select: { id: true, isCorrect: true } } },
    orderBy: { position: 'asc' },
  });
  if (questions.length === 0) {
    throw conflict('activity', 'This activity has no questions to answer');
  }
  const optionsByQuestion = new Map(
    questions.map((question) => [
      question.id,
      new Map(question.options.map((option) => [option.id, option.isCorrect])),
    ]),
  );

  let correct = 0;
  for (const answer of answers) {
    const options = optionsByQuestion.get(answer.questionId);
    const isCorrect = options?.get(answer.optionId);
    if (options === undefined || isCorrect === undefined) {
      answersValidation([
        {
          messages: [
            `answer ${answer.optionId} does not belong to question ${answer.questionId} of this activity`,
          ],
        },
      ]);
    }
    if (isCorrect) correct += 1;
  }
  const autoScore = Math.round((correct / questions.length) * maxScore);
  return {
    autoScore,
    rows: answers.map((answer, position) => ({
      questionId: answer.questionId,
      optionId: answer.optionId,
      position,
    })),
  };
}
