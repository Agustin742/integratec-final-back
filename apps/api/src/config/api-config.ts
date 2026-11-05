import { z } from 'zod';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/**
 * Typed, validated configuration of the API.
 *
 * Durations are exposed as whole seconds (suffix `Seconds`); the environment
 * accepts `<integer><unit>` with unit `s`, `m`, `h` or `d` (for example `15m`).
 */
export interface ApiConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  invitationTtlSeconds: number;
  outboxPollIntervalSeconds: number;
  outboxMaxAttempts: number;
  internalServiceSecret: string;
  allowedOrigins: string[];
}

export interface ConfigIssue {
  variable: string;
  message: string;
}

/**
 * Thrown when the environment is invalid. The message lists every offending
 * variable by name with a short reason and never includes variable values.
 */
export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly ConfigIssue[]) {
    super(
      [
        'Invalid configuration. Fix the following environment variables:',
        ...issues.map((issue) => `  - ${issue.variable}: ${issue.message}`),
      ].join('\n'),
    );
    this.name = 'ConfigValidationError';
  }
}

const SECONDS_PER_UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
const DURATION_MESSAGE = 'must be a positive duration such as 30s, 15m, 12h or 7d';
const ORIGINS_MESSAGE =
  'must be a comma-separated list of http(s) origins without path, e.g. https://app.example.com';

const required = { error: 'is required' };

const duration = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .pipe(
      z
        .string()
        .regex(/^\d+[smhd]$/, DURATION_MESSAGE)
        .transform((value) => Number.parseInt(value, 10) * SECONDS_PER_UNIT[value.slice(-1)])
        .pipe(z.number().min(1, DURATION_MESSAGE)),
    );

const isPostgresUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
};

const isHttpOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
};

const envSchema = z.object({
  NODE_ENV: z
    .enum(NODE_ENVIRONMENTS, { error: `must be one of: ${NODE_ENVIRONMENTS.join(', ')}` })
    .default('development'),
  PORT: z
    .string()
    .default('3000')
    .pipe(
      z
        .string()
        .regex(/^\d+$/, 'must be an integer between 1 and 65535')
        .transform(Number)
        .pipe(
          z
            .number()
            .min(1, 'must be an integer between 1 and 65535')
            .max(65535, 'must be an integer between 1 and 65535'),
        ),
    ),
  DATABASE_URL: z
    .string(required)
    .refine(isPostgresUrl, 'must be a postgres:// or postgresql:// URL with a host'),
  JWT_ACCESS_TTL: duration('15m'),
  REFRESH_TOKEN_TTL: duration('7d'),
  INVITATION_TTL: duration('7d'),
  OUTBOX_POLL_INTERVAL: duration('5s'),
  OUTBOX_MAX_ATTEMPTS: z
    .string()
    .default('5')
    .pipe(
      z
        .string()
        .regex(/^\d+$/, 'must be an integer between 1 and 20')
        .transform(Number)
        .pipe(
          z
            .number()
            .min(1, 'must be an integer between 1 and 20')
            .max(20, 'must be an integer between 1 and 20'),
        ),
    ),
  INTERNAL_SERVICE_SECRET: z.string(required).min(32, 'must be at least 32 characters'),
  ALLOWED_ORIGINS: z
    .string(required)
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .refine((origins) => origins.length > 0 && origins.every(isHttpOrigin), ORIGINS_MESSAGE),
});

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Blank values are treated as unset so `FOO=` behaves like a missing variable. */
const withoutBlanks = (env: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '',
    ),
  );

/** Pure and side-effect free: validates `env` and returns the typed config or throws. */
export function loadApiConfig(env: Env): ApiConfig {
  const result = envSchema.safeParse(withoutBlanks(env));

  if (!result.success) {
    const seen = new Set<string>();
    const issues: ConfigIssue[] = [];
    for (const issue of result.error.issues) {
      const variable = String(issue.path[0] ?? 'environment');
      if (!seen.has(variable)) {
        seen.add(variable);
        issues.push({ variable, message: issue.message });
      }
    }
    throw new ConfigValidationError(issues);
  }

  const values = result.data;
  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    databaseUrl: values.DATABASE_URL,
    accessTokenTtlSeconds: values.JWT_ACCESS_TTL,
    refreshTokenTtlSeconds: values.REFRESH_TOKEN_TTL,
    invitationTtlSeconds: values.INVITATION_TTL,
    outboxPollIntervalSeconds: values.OUTBOX_POLL_INTERVAL,
    outboxMaxAttempts: values.OUTBOX_MAX_ATTEMPTS,
    internalServiceSecret: values.INTERNAL_SERVICE_SECRET,
    allowedOrigins: values.ALLOWED_ORIGINS,
  };
}
