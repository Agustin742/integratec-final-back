import type { ApiConfig } from '../../config/api-config';

// Same approach as prisma.spec.ts: the database URL comes from the environment (CI sets it).
const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;
const TEST_DATABASE_URL =
  env?.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public';

/** Synthetic, clearly non-secret configuration for auth integration specs. */
export const AUTH_TEST_JWT_SECRET = 'synthetic-jwt-secret-for-auth-specs-only-0000';

export const authTestConfig = (overrides: Partial<ApiConfig> = {}): ApiConfig => ({
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: TEST_DATABASE_URL,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604800,
  refreshReuseGraceSeconds: 30,
  passwordResetTtlSeconds: 3600,
  passwordResetUrlBase: 'https://app.example.test/reset-password',
  invitationTtlSeconds: 604800,
  outboxPollIntervalSeconds: 5,
  outboxMaxAttempts: 5,
  internalServiceSecret: 'synthetic-internal-secret-for-auth-specs-0000',
  jwtSecret: AUTH_TEST_JWT_SECRET,
  allowedOrigins: ['http://localhost:5173'],
  s3Bucket: 'synthetic-bucket',
  s3Region: 'sa-east-1',
  s3Endpoint: undefined,
  s3ForcePathStyle: false,
  s3Credentials: undefined,
  storageSignedUrlTtlSeconds: 300,
  ...overrides,
});
