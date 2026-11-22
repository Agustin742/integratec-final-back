import type { DailyReviewSectionDto } from './daily-review.dto';

/**
 * Daily-review summary generation boundary (HU-BOT-003, rules/ai-bot-and-daily-briefing.md).
 * The feature depends on this port, never on a concrete provider: the default
 * external AI provider adapter can be replaced or faked in tests without touching delivery.
 *
 * The input carries ONLY composed section data the user may already see (titles,
 * classroom names, due dates) through the same application services REST uses,
 * so no id, email, answer key or data outside the user's accessible classrooms
 * can reach the provider.
 */
export interface DailyReviewInferenceInput {
  /** Acting user, used for bounded diagnostics only (never logged with content). */
  userId: string;
  audience: 'STUDENT' | 'TEACHER';
  sections: DailyReviewSectionDto[];
}

export interface DailyReviewInferencePort {
  /**
   * Produces the review's summary wording, or `null` for ANY failure cause
   * (provider error, timeout, throttle, invalid or oversized output), which the
   * caller turns into the structured fallback. Implementations MUST fail closed.
   */
  generateSummary(input: DailyReviewInferenceInput): Promise<string | null>;
  /**
   * Produces the daily question from enabled material, or `null` for ANY failure
   * cause. The caller hard-validates the result before persisting anything: the
   * answer key travels only between this port and the persisted row, never to a
   * response DTO.
   */
  generateDailyQuestion(input: DailyQuestionInferenceInput): Promise<GeneratedDailyQuestion | null>;
}

/** One enabled material the question may be built from: title + owning classroom. */
export interface DailyQuestionMaterial {
  classroomName: string;
  title: string;
}

/** Input to the daily-question generator: enabled material titles only. */
export interface DailyQuestionInferenceInput {
  /** Acting user, used for bounded diagnostics only (never logged with content). */
  userId: string;
  materials: DailyQuestionMaterial[];
}

/** Provider output for the daily question; validated hard by the caller. */
export interface GeneratedDailyQuestion {
  prompt: string;
  options: string[];
  correctOption: string;
  materialTitle: string | null;
}

/** Contract bounds, mirrored from the delivery contract and the persistence columns. */
export const DAILY_QUESTION_PROMPT_MAX_CHARS = 280;
export const DAILY_QUESTION_OPTION_MAX_CHARS = 120;
export const DAILY_QUESTION_OPTIONS_MIN = 2;
export const DAILY_QUESTION_OPTIONS_MAX = 6;

/**
 * Hard validation of the provider output before ANYTHING is persisted: the model
 * is untrusted, so every bound of the delivery contract is checked here and an
 * invalid question is exactly as good as no question (`null`, no row). Trims
 * every field first, so the persisted answer key compares cleanly with trimmed
 * submissions.
 */
export function normalizeGeneratedQuestion(
  generated: GeneratedDailyQuestion,
): GeneratedDailyQuestion | null {
  const prompt = generated.prompt.trim();
  const options = generated.options.map((option) => option.trim());
  const correctOption = generated.correctOption.trim();
  const materialTitle = generated.materialTitle === null ? null : generated.materialTitle.trim();

  if (prompt.length === 0 || prompt.length > DAILY_QUESTION_PROMPT_MAX_CHARS) return null;
  if (options.length < DAILY_QUESTION_OPTIONS_MIN || options.length > DAILY_QUESTION_OPTIONS_MAX) {
    return null;
  }
  if (
    options.some((option) => option.length === 0 || option.length > DAILY_QUESTION_OPTION_MAX_CHARS)
  ) {
    return null;
  }
  // Duplicate options would make several answers equally valid.
  if (new Set(options).size !== options.length) return null;
  if (!options.includes(correctOption)) return null;
  if (
    materialTitle !== null &&
    (materialTitle.length === 0 || materialTitle.length > DAILY_QUESTION_OPTION_MAX_CHARS)
  ) {
    return null;
  }
  return { prompt, options, correctOption, materialTitle };
}

/** Injection token for the {@link DailyReviewInferencePort} implementation. */
export const DAILY_REVIEW_INFERENCE_PORT = Symbol('DAILY_REVIEW_INFERENCE_PORT');
