import type { DailyReviewSectionDto } from './daily-review.dto';

/**
 * Daily-review summary generation boundary (HU-BOT-003, rules/ai-bot-and-daily-briefing.md).
 * The feature depends on this port, never on a concrete provider: the default
 * Bedrock adapter can be replaced or faked in tests without touching delivery.
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
}

/** Injection token for the {@link DailyReviewInferencePort} implementation. */
export const DAILY_REVIEW_INFERENCE_PORT = Symbol('DAILY_REVIEW_INFERENCE_PORT');
