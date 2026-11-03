import { z } from 'zod';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

/** Typed, validated configuration of the realtime server. */
export interface RealtimeConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  apiInternalUrl: string;
  internalServiceSecret: string;
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

const PORT_MESSAGE = 'must be an integer between 1 and 65535';
const required = { error: 'is required' };

const isHttpUrl = (value: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
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
    .default('2567')
    .pipe(
      z
        .string()
        .regex(/^\d+$/, PORT_MESSAGE)
        .transform(Number)
        .pipe(z.number().min(1, PORT_MESSAGE).max(65535, PORT_MESSAGE)),
    ),
  API_INTERNAL_URL: z
    .string(required)
    .refine(isHttpUrl, 'must be an absolute http:// or https:// URL'),
  INTERNAL_SERVICE_SECRET: z.string(required).min(32, 'must be at least 32 characters'),
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
export function loadRealtimeConfig(env: Env): RealtimeConfig {
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
    apiInternalUrl: values.API_INTERNAL_URL,
    internalServiceSecret: values.INTERNAL_SERVICE_SECRET,
  };
}
