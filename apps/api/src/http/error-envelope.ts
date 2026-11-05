/**
 * Stable machine-readable error codes. Clients branch on these, never on the
 * human-readable message, so existing values must not change meaning.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** One invalid field: its dotted path (nested fields included) and what is wrong with it. */
export interface ErrorDetail {
  field: string;
  messages: string[];
}

/** The single error body returned by every failing endpoint. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    correlationId: string;
  };
}

/** Header carrying the correlation id, in requests and responses. */
export const CORRELATION_ID_HEADER = 'x-request-id';
