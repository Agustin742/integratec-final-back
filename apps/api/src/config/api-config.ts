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
  /**
   * Window after a refresh token is rotated in which presenting it again is treated as a
   * benign retry (parallel tabs, lost response) instead of reuse. 0 disables it.
   */
  refreshReuseGraceSeconds: number;
  /** How long an emailed password reset link stays valid. */
  passwordResetTtlSeconds: number;
  /**
   * Frontend page that completes a reset. The emailed link is `<base>?token=<token>`, so
   * the base has no query string or fragment. Required with HTTPS in production;
   * elsewhere it defaults to the local frontend.
   */
  passwordResetUrlBase: string;
  invitationTtlSeconds: number;
  outboxPollIntervalSeconds: number;
  outboxMaxAttempts: number;
  /**
   * Base URL of the realtime server on the private network, called to evict users who lost access.
   * Required in production; elsewhere it defaults to the local realtime server.
   */
  realtimeInternalUrl: string;
  internalServiceSecret: string;
  /** HS256 signing key of access tokens. Never log or return it. */
  jwtSecret: string;
  /**
   * AES-256 key (32 bytes) that seals invitation tokens inside outbox payloads, so the raw
   * token is never persisted in plaintext. Never log or return it.
   */
  invitationTokenKey: Buffer;
  allowedOrigins: string[];
  s3Bucket: string;
  s3Region: string;
  /** Set only for S3-compatible services such as MinIO; undefined means AWS S3. */
  s3Endpoint: string | undefined;
  s3ForcePathStyle: boolean;
  /** Undefined means the SDK default provider chain (the EC2 instance role in production). */
  s3Credentials: { accessKeyId: string; secretAccessKey: string } | undefined;
  /** Default lifetime of signed download URLs. */
  storageSignedUrlTtlSeconds: number;
  /** How long past its expiry (or rotation/use) an auth row is kept before it is pruned. */
  authDataRetentionSeconds: number;
  /** Pause between two auth data cleanup runs. */
  authCleanupIntervalSeconds: number;
  /** Maximum rows removed by one cleanup DELETE statement. */
  authCleanupBatchSize: number;
}

/** Upper bound for the refresh reuse grace window: a longer one defeats reuse detection. */
export const MAX_REFRESH_REUSE_GRACE_SECONDS = 300;

/** Upper bound for any signed download URL lifetime, configured or requested. */
export const MAX_SIGNED_URL_TTL_SECONDS = 3600;

/** Upper bound for the password reset link lifetime: a reset link is a bearer credential. */
export const MAX_PASSWORD_RESET_TTL_SECONDS = 86400;

/** Upper bound for the cleanup batch size: keeps each DELETE statement short. */
export const MAX_AUTH_CLEANUP_BATCH_SIZE = 10000;

/**
 * Upper bound for the cleanup interval. Well below Node's 2^31-1 ms timer limit (~24.8d),
 * beyond which `setInterval` clamps the delay to 1 ms and would loop the cleanup.
 */
export const MAX_AUTH_CLEANUP_INTERVAL_SECONDS = 7 * 86400;

/** Defaults of the auth cleanup settings, in seconds (the env schema spells them as durations). */
export const DEFAULT_AUTH_DATA_RETENTION_SECONDS = 30 * 86400;
export const DEFAULT_AUTH_CLEANUP_INTERVAL_SECONDS = 86400;
export const DEFAULT_AUTH_CLEANUP_BATCH_SIZE = 1000;

/** Local realtime server, used when `REALTIME_INTERNAL_URL` is unset outside production. */
export const DEFAULT_REALTIME_INTERNAL_URL = 'http://localhost:2567';

/** Local frontend reset page, used when `PASSWORD_RESET_URL_BASE` is unset outside production. */
export const DEFAULT_PASSWORD_RESET_URL_BASE = 'http://localhost:5173/reset-password';

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

const INVITATION_TOKEN_KEY_MESSAGE =
  'must be a 32-byte key encoded as 64 hexadecimal characters or as base64';

const BUCKET_MESSAGE =
  'must be a bucket name of 3-63 lowercase letters, digits, dots or hyphens, starting and ending with a letter or digit';
const REGION_MESSAGE = 'must be an AWS region name such as sa-east-1';
const ENDPOINT_MESSAGE =
  'must be an http(s) origin without path, e.g. http://localhost:9000 (leave unset for AWS S3)';
const REUSE_GRACE_MESSAGE = 'must be a duration between 0s and 5m, such as 30s (0s disables it)';
const PASSWORD_RESET_TTL_MESSAGE = 'must be a duration between 1s and 24h, such as 1h';
const PASSWORD_RESET_URL_MESSAGE =
  'must be an absolute http(s) URL without credentials, query string or fragment, e.g. https://app.example.com/reset-password';
const SIGNED_URL_TTL_MESSAGE = 'must be a duration between 1s and 1h, such as 5m';

const AUTH_CLEANUP_INTERVAL_MESSAGE = 'must be a duration between 1s and 7d, such as 24h';
const BATCH_SIZE_MESSAGE = `must be an integer between 1 and ${MAX_AUTH_CLEANUP_BATCH_SIZE}`;

const required = { error: 'is required' };

const duration = (
  fallback: string,
  maxSeconds?: number,
  maxMessage = DURATION_MESSAGE,
  minSeconds = 1,
) =>
  z
    .string()
    .default(fallback)
    .pipe(
      z
        .string()
        .regex(/^\d+[smhd]$/, DURATION_MESSAGE)
        .transform((value) => Number.parseInt(value, 10) * SECONDS_PER_UNIT[value.slice(-1)])
        .pipe(
          z
            .number()
            .min(minSeconds, DURATION_MESSAGE)
            .max(maxSeconds ?? Infinity, maxMessage),
        ),
    );

/** Decodes a 32-byte key written as 64 hex characters or as base64; undefined otherwise. */
const decodeKey32 = (value: string): Buffer | undefined => {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  if (/^[A-Za-z0-9+/]{43}=?$/.test(value)) {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 ? decoded : undefined;
  }
  return undefined;
};

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

const isHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const isResetUrlBase = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      !value.includes('?') &&
      !value.includes('#')
    );
  } catch {
    return false;
  }
};

const envSchema = z
  .object({
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
    REFRESH_REUSE_GRACE: duration('30s', MAX_REFRESH_REUSE_GRACE_SECONDS, REUSE_GRACE_MESSAGE, 0),
    PASSWORD_RESET_TTL: duration('1h', MAX_PASSWORD_RESET_TTL_SECONDS, PASSWORD_RESET_TTL_MESSAGE),
    // A rejected value is never echoed (it could carry credentials), only the variable name.
    PASSWORD_RESET_URL_BASE: z
      .string()
      .refine(isResetUrlBase, PASSWORD_RESET_URL_MESSAGE)
      .optional(),
    INVITATION_TTL: duration('7d'),
    // A rejected value is never echoed, only the variable name.
    REALTIME_INTERNAL_URL: z
      .string()
      .refine(isHttpUrl, 'must be an absolute http:// or https:// URL')
      .optional(),
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
    AUTH_DATA_RETENTION: duration('30d'),
    AUTH_CLEANUP_INTERVAL: duration(
      '24h',
      MAX_AUTH_CLEANUP_INTERVAL_SECONDS,
      AUTH_CLEANUP_INTERVAL_MESSAGE,
    ),
    AUTH_CLEANUP_BATCH_SIZE: z
      .string()
      .default('1000')
      .pipe(
        z
          .string()
          .regex(/^\d+$/, BATCH_SIZE_MESSAGE)
          .transform(Number)
          .pipe(
            z
              .number()
              .min(1, BATCH_SIZE_MESSAGE)
              .max(MAX_AUTH_CLEANUP_BATCH_SIZE, BATCH_SIZE_MESSAGE),
          ),
      ),
    INTERNAL_SERVICE_SECRET: z.string(required).min(32, 'must be at least 32 characters'),
    JWT_SECRET: z.string(required).min(32, 'must be at least 32 characters'),
    INVITATION_TOKEN_KEY: z.string(required).transform((value, ctx) => {
      const key = decodeKey32(value);
      if (key === undefined) {
        ctx.addIssue({ code: 'custom', message: INVITATION_TOKEN_KEY_MESSAGE });
        return z.NEVER;
      }
      return key;
    }),
    ALLOWED_ORIGINS: z
      .string(required)
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .refine((origins) => origins.length > 0 && origins.every(isHttpOrigin), ORIGINS_MESSAGE),
    S3_BUCKET: z.string(required).regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, BUCKET_MESSAGE),
    S3_REGION: z
      .string()
      .default('sa-east-1')
      .pipe(z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d+$/, REGION_MESSAGE)),
    S3_ENDPOINT: z.string().refine(isHttpOrigin, ENDPOINT_MESSAGE).optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'], { error: 'must be true or false' })
      .default('false')
      .transform((value) => value === 'true'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    STORAGE_SIGNED_URL_TTL: duration('5m', MAX_SIGNED_URL_TTL_SECONDS, SIGNED_URL_TTL_MESSAGE),
  })
  .superRefine((env, ctx) => {
    // A production link must point at the real frontend, never silently at localhost.
    if (env.NODE_ENV === 'production' && env.PASSWORD_RESET_URL_BASE === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_RESET_URL_BASE'],
        message: 'is required in production',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      env.PASSWORD_RESET_URL_BASE !== undefined &&
      isResetUrlBase(env.PASSWORD_RESET_URL_BASE) &&
      new URL(env.PASSWORD_RESET_URL_BASE).protocol !== 'https:'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_RESET_URL_BASE'],
        message: 'must use HTTPS in production',
      });
    }
    // Evictions must go to the real realtime server, never silently to a local default.
    if (env.NODE_ENV === 'production' && env.REALTIME_INTERNAL_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['REALTIME_INTERNAL_URL'],
        message: 'is required in production',
      });
    }
    // Pruning rotated tokens of a still-live session would break refresh reuse detection.
    if (
      typeof env.AUTH_DATA_RETENTION === 'number' &&
      typeof env.REFRESH_TOKEN_TTL === 'number' &&
      env.AUTH_DATA_RETENTION < env.REFRESH_TOKEN_TTL
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DATA_RETENTION'],
        message:
          'must not be shorter than REFRESH_TOKEN_TTL, or rotated tokens of live sessions would be pruned',
      });
    }
    // Both keys or neither: with neither, the SDK resolves the instance role.
    if ((env.S3_ACCESS_KEY_ID === undefined) !== (env.S3_SECRET_ACCESS_KEY === undefined)) {
      const missing =
        env.S3_ACCESS_KEY_ID === undefined ? 'S3_ACCESS_KEY_ID' : 'S3_SECRET_ACCESS_KEY';
      ctx.addIssue({
        code: 'custom',
        path: [missing],
        message: 'is required when the other S3 credential variable is set',
      });
    }
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
    refreshReuseGraceSeconds: values.REFRESH_REUSE_GRACE,
    passwordResetTtlSeconds: values.PASSWORD_RESET_TTL,
    passwordResetUrlBase: values.PASSWORD_RESET_URL_BASE ?? DEFAULT_PASSWORD_RESET_URL_BASE,
    invitationTtlSeconds: values.INVITATION_TTL,
    outboxPollIntervalSeconds: values.OUTBOX_POLL_INTERVAL,
    outboxMaxAttempts: values.OUTBOX_MAX_ATTEMPTS,
    realtimeInternalUrl: values.REALTIME_INTERNAL_URL ?? DEFAULT_REALTIME_INTERNAL_URL,
    internalServiceSecret: values.INTERNAL_SERVICE_SECRET,
    jwtSecret: values.JWT_SECRET,
    invitationTokenKey: values.INVITATION_TOKEN_KEY,
    allowedOrigins: values.ALLOWED_ORIGINS,
    s3Bucket: values.S3_BUCKET,
    s3Region: values.S3_REGION,
    s3Endpoint: values.S3_ENDPOINT,
    s3ForcePathStyle: values.S3_FORCE_PATH_STYLE,
    s3Credentials:
      values.S3_ACCESS_KEY_ID !== undefined && values.S3_SECRET_ACCESS_KEY !== undefined
        ? { accessKeyId: values.S3_ACCESS_KEY_ID, secretAccessKey: values.S3_SECRET_ACCESS_KEY }
        : undefined,
    storageSignedUrlTtlSeconds: values.STORAGE_SIGNED_URL_TTL,
    authDataRetentionSeconds: values.AUTH_DATA_RETENTION,
    authCleanupIntervalSeconds: values.AUTH_CLEANUP_INTERVAL,
    authCleanupBatchSize: values.AUTH_CLEANUP_BATCH_SIZE,
  };
}
